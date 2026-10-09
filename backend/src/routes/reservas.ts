import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { isExclusionViolation, pool, tx } from '../db.js';
import { isAdmin, podeDecidir, requireAdmin, requireAuth } from '../auth.js';
import { regras } from '../config.js';
import { lerRegrasReserva } from './configuracao.js';
import { HttpError } from '../app.js';

const idParam = z.object({ id: z.coerce.number().int() });
const iso = z.string().datetime({ offset: true, message: 'Data/hora inválida' });
const fmt = (d: Date | string) =>
  new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' });

async function registrarHistorico(
  c: PoolClient, reservaId: number, anterior: string | null, novo: string, autorId: number, motivo?: string | null,
) {
  await c.query(
    'INSERT INTO historico_status (reserva_id, status_anterior, status_novo, autor_id, motivo) VALUES ($1,$2,$3,$4,$5)',
    [reservaId, anterior, novo, autorId, motivo ?? null],
  );
}
async function notificar(c: PoolClient, usuarioId: number, reservaId: number, mensagem: string) {
  await c.query('INSERT INTO notificacao (usuario_id, reserva_id, mensagem) VALUES ($1,$2,$3)', [usuarioId, reservaId, mensagem]);
}

export async function reservaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // RF05, RF06, RF07
  app.post('/api/reservas', async (req, reply) => {
    const b = z.object({
      ambiente_id: z.number().int(),
      inicio: iso,
      fim: iso,
      finalidade: z.string().trim().min(3, 'Informe a finalidade').max(300),
    }).parse(req.body);
    const inicio = new Date(b.inicio), fim = new Date(b.fim);

    if (fim <= inicio) throw new HttpError(400, 'O horário final deve ser depois do inicial');
    if (inicio.getTime() < Date.now() + regras.antecedenciaMinimaMin * 60_000) throw new HttpError(400, 'O horário deve estar no futuro');
    // Limites definidos pelo administrador: duração máxima e até quando se pode reservar
    const lim = await lerRegrasReserva();
    if ((fim.getTime() - inicio.getTime()) / 3_600_000 > lim.duracao_max_horas)
      throw new HttpError(400, `Duração máxima: ${lim.duracao_max_horas} ${lim.duracao_max_horas === 1 ? 'hora' : 'horas'}`);

    // Dia e hora contam no horário local (Recife): reserva no mesmo dia (qualquer dia da semana, inclusive fim de semana)
    const loc = (await pool.query(
      `SELECT (a AT TIME ZONE $3)::date::text AS dia, (b AT TIME ZONE $3)::date::text AS dia_fim
         FROM (SELECT $1::timestamptz AS a, $2::timestamptz AS b) x`,
      [b.inicio, b.fim, regras.fuso],
    )).rows[0];
    if (loc.dia !== loc.dia_fim) throw new HttpError(400, 'A reserva deve começar e terminar no mesmo dia');
    if (loc.dia > lim.limite) // datas 'AAAA-MM-DD' se comparam como texto
      throw new HttpError(400, `Só é possível reservar até ${lim.limite.split('-').reverse().join('/')}`);

    const amb = await pool.query('SELECT nome, ativo FROM ambiente WHERE id = $1', [b.ambiente_id]);
    if (!amb.rows[0]) throw new HttpError(404, 'Ambiente não encontrado');
    if (!amb.rows[0].ativo) throw new HttpError(400, 'Ambiente desativado'); // RN12
    // ambiente sem responsável não recebe aviso de solicitação (só o administrador poderia decidir)
    const resp = await pool.query('SELECT 1 FROM ambiente_autoridade WHERE ambiente_id = $1 LIMIT 1', [b.ambiente_id]);
    if (!resp.rowCount) throw new HttpError(400, 'Este ambiente ainda não tem um responsável para aprovar reservas. Fale com o administrador.');

    // Horário marcado pelo administrador como ocupado (aula, manutenção...)
    const ocupado = (await pool.query('SELECT bloqueio_conflitante($1, $2, $3) AS descricao', [b.ambiente_id, b.inicio, b.fim])).rows[0].descricao;
    if (ocupado) throw new HttpError(409, `Horário indisponível: ${ocupado}. Escolha outro horário.`);

    // RF06: feedback rápido na aplicação (a garantia real está na constraint do banco)
    const conflito = await pool.query(
      `SELECT 1 FROM reserva WHERE ambiente_id = $1 AND status = 'APROVADA' AND inicio < $3 AND fim > $2 LIMIT 1`,
      [b.ambiente_id, b.inicio, b.fim],
    );
    if (conflito.rowCount) throw new HttpError(409, 'Já existe uma reserva aprovada nesse horário');

    const id = await tx(async (c) => {
      // criado_em vem do DEFAULT now() do banco (RN09) — nunca do cliente
      const r = await c.query(
        `INSERT INTO reserva (ambiente_id, solicitante_id, inicio, fim, finalidade) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [b.ambiente_id, req.auth.id, b.inicio, b.fim, b.finalidade],
      );
      const rid: number = r.rows[0].id;
      await registrarHistorico(c, rid, null, 'PENDENTE', req.auth.id);
      const auts = await c.query('SELECT usuario_id FROM ambiente_autoridade WHERE ambiente_id = $1', [b.ambiente_id]);
      for (const a of auts.rows)
        await notificar(c, a.usuario_id, rid, `Nova solicitação para ${amb.rows[0].nome} (${fmt(inicio)}) de ${req.auth.nome}`);
      return rid;
    });
    return reply.code(201).send({ id });
  });

  // RF08
  app.get('/api/reservas/minhas', async (req) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.ambiente_id, r.ambiente_nome, r.inicio, r.fim, r.finalidade, r.status,
              r.criado_em, r.decidido_em, r.justificativa_recusa,
              r.cancelado_em, r.motivo_cancelamento, cu.nome AS cancelado_por_nome,
              (r.cancelado_por_id IS NOT NULL AND r.cancelado_por_id <> r.solicitante_id) AS cancelada_pela_autoridade
         FROM reserva r LEFT JOIN ambiente a ON a.id = r.ambiente_id
         LEFT JOIN usuario cu ON cu.id = r.cancelado_por_id
        WHERE r.solicitante_id = $1 ORDER BY r.inicio DESC`,
      [req.auth.id],
    );
    return rows;
  });

  app.get('/api/reservas/:id/historico', async (req) => {
    const { id } = idParam.parse(req.params);
    const r = await pool.query('SELECT solicitante_id, ambiente_id FROM reserva WHERE id = $1', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'Reserva não encontrada');
    const ok = r.rows[0].solicitante_id === req.auth.id || isAdmin(req.auth) || (await podeDecidir(req.auth, r.rows[0].ambiente_id));
    if (!ok) throw new HttpError(403, 'Sem permissão');
    const { rows } = await pool.query(
      `SELECT h.status_anterior, h.status_novo, h.motivo, h.criado_em, u.nome AS autor_nome
         FROM historico_status h JOIN usuario u ON u.id = h.autor_id
        WHERE h.reserva_id = $1 ORDER BY h.id`,
      [id],
    );
    return rows;
  });

  // RF09
  app.post('/api/reservas/:id/cancelar', async (req) => {
    const { id } = idParam.parse(req.params);
    await tx(async (c) => {
      const r = await c.query(
        `SELECT r.* FROM reserva r WHERE r.id = $1 FOR UPDATE OF r`, [id]);
      const res = r.rows[0];
      if (!res) throw new HttpError(404, 'Reserva não encontrada');
      if (res.solicitante_id !== req.auth.id) throw new HttpError(403, 'Você só pode cancelar as suas reservas');
      if (!['PENDENTE', 'APROVADA'].includes(res.status)) throw new HttpError(409, 'Esta reserva não pode mais ser cancelada');
      if (res.status === 'APROVADA' && new Date(res.inicio) <= new Date()) throw new HttpError(409, 'A reserva já começou');
      await c.query("UPDATE reserva SET status = 'CANCELADA', cancelado_por_id = $2, cancelado_em = now() WHERE id = $1", [id, req.auth.id]);
      await registrarHistorico(c, id, res.status, 'CANCELADA', req.auth.id);
      if (res.status === 'APROVADA') {
        const auts = await c.query('SELECT usuario_id FROM ambiente_autoridade WHERE ambiente_id = $1', [res.ambiente_id]);
        for (const a of auts.rows)
          await notificar(c, a.usuario_id, id, `${req.auth.nome} cancelou a reserva de ${res.ambiente_nome} (${fmt(res.inicio)})`);
      }
    });
    return { ok: true };
  });

  // Reservas APROVADAS que ainda não começaram, nos ambientes do responsável (para ele poder cancelar, se precisar)
  app.get('/api/reservas/aprovadas', async (req) => {
    if (!req.auth.papeis.includes('AUTORIDADE') && !isAdmin(req.auth)) throw new HttpError(403, 'Apenas autoridades');
    const { rows } = await pool.query(
      `SELECT r.id, r.ambiente_id, r.ambiente_nome, u.nome AS solicitante_nome, r.inicio, r.fim, r.finalidade
         FROM reserva r LEFT JOIN ambiente a ON a.id = r.ambiente_id JOIN usuario u ON u.id = r.solicitante_id
        WHERE r.status = 'APROVADA' AND r.inicio > now()
          AND ($2 OR EXISTS (SELECT 1 FROM ambiente_autoridade aa WHERE aa.ambiente_id = r.ambiente_id AND aa.usuario_id = $1))
        ORDER BY r.inicio`,
      [req.auth.id, isAdmin(req.auth)], // o administrador vê as de todos os ambientes
    );
    return rows;
  });

  // A autoridade do ambiente (ou o administrador) cancela uma reserva JÁ APROVADA, a qualquer momento antes de ela começar.
  // O motivo é obrigatório e vai numa notificação para quem solicitou. (Pendentes se recusam, com justificativa.)
  app.post('/api/reservas/:id/cancelar-pela-autoridade', async (req) => {
    const { id } = idParam.parse(req.params);
    const { motivo } = z.object({
      motivo: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(300),
    }).parse(req.body);
    await tx(async (c) => {
      const r = await c.query(
        `SELECT r.* FROM reserva r WHERE r.id = $1 FOR UPDATE OF r`, [id]);
      const res = r.rows[0];
      if (!res) throw new HttpError(404, 'Reserva não encontrada');
      if (!(await podeDecidir(req.auth, res.ambiente_id))) throw new HttpError(403, 'Você não é autoridade deste ambiente');
      if (res.status !== 'APROVADA') throw new HttpError(409, res.status === 'PENDENTE'
        ? 'Esta solicitação ainda está pendente: use "Recusar", com justificativa.'
        : 'Esta reserva não está mais aprovada.');
      if (new Date(res.inicio) <= new Date()) throw new HttpError(409, 'A reserva já começou e não pode mais ser cancelada');
      await c.query(
        `UPDATE reserva SET status = 'CANCELADA', cancelado_por_id = $2, cancelado_em = now(), motivo_cancelamento = $3 WHERE id = $1`,
        [id, req.auth.id, motivo]);
      await registrarHistorico(c, id, 'APROVADA', 'CANCELADA', req.auth.id, motivo);
      await notificar(c, res.solicitante_id, id,
        `Sua reserva de ${res.ambiente_nome} (${fmt(res.inicio)}) foi CANCELADA por ${req.auth.nome}: ${motivo}`);
    });
    return { ok: true };
  });

  // RF10: pendentes dos ambientes sob responsabilidade da autoridade
  app.get('/api/reservas/pendentes', async (req) => {
    if (!req.auth.papeis.includes('AUTORIDADE') && !isAdmin(req.auth)) throw new HttpError(403, 'Apenas autoridades');
    const { rows } = await pool.query(
      `SELECT r.id, r.ambiente_id, r.ambiente_nome, u.nome AS solicitante_nome, r.inicio, r.fim,
              r.finalidade, r.criado_em,
              EXISTS (SELECT 1 FROM reserva x WHERE x.ambiente_id = r.ambiente_id AND x.status = 'APROVADA'
                        AND x.inicio < r.fim AND x.fim > r.inicio) AS conflita_com_aprovada,
              bloqueio_conflitante(r.ambiente_id, r.inicio, r.fim) AS bloqueio_conflitante,
              (SELECT COUNT(*)::int FROM reserva x WHERE x.ambiente_id = r.ambiente_id AND x.status = 'PENDENTE'
                  AND x.id <> r.id AND x.criado_em < r.criado_em AND x.inicio < r.fim AND x.fim > r.inicio) AS pendentes_anteriores
         FROM reserva r LEFT JOIN ambiente a ON a.id = r.ambiente_id JOIN usuario u ON u.id = r.solicitante_id
        WHERE r.status = 'PENDENTE'
          AND ($2 OR EXISTS (SELECT 1 FROM ambiente_autoridade aa WHERE aa.ambiente_id = r.ambiente_id AND aa.usuario_id = $1))
        ORDER BY r.criado_em`,
      [req.auth.id, isAdmin(req.auth)], // o administrador vê as de todos os ambientes
    );
    return rows;
  });

  // RF11: aprovar — o banco recusa qualquer sobreposição (RNF04).
  // Basta UM responsável do ambiente aprovar. Ao aprovar, as pendentes que colidem são recusadas automaticamente.
  app.post('/api/reservas/:id/aprovar', async (req) => {
    const { id } = idParam.parse(req.params);
    try {
      await tx(async (c) => {
        // Uma aprovação por vez em cada ambiente: evita corrida entre dois responsáveis e deadlock
        // entre as recusas automáticas. (A constraint do banco continua sendo a garantia final.)
        const pre = await c.query('SELECT ambiente_id FROM reserva WHERE id = $1', [id]);
        if (!pre.rows[0]) throw new HttpError(404, 'Reserva não encontrada');
        await c.query('SELECT pg_advisory_xact_lock(7001, $1::int)', [pre.rows[0].ambiente_id]);

        const r = await c.query(
          `SELECT r.* FROM reserva r WHERE r.id = $1 FOR UPDATE OF r`, [id]);
        const res = r.rows[0];
        if (!(await podeDecidir(req.auth, res.ambiente_id))) throw new HttpError(403, 'Você não é autoridade deste ambiente');
        if (res.status !== 'PENDENTE') throw new HttpError(409, 'Só é possível decidir solicitações pendentes');
        if (new Date(res.fim) <= new Date()) throw new HttpError(409, 'O horário desta solicitação já passou');
        const ocupado = (await c.query('SELECT bloqueio_conflitante($1, $2, $3) AS descricao', [res.ambiente_id, res.inicio, res.fim])).rows[0].descricao;
        if (ocupado) throw new HttpError(409, `Este horário está ocupado: ${ocupado}. Só é possível recusar.`);

        await c.query(
          "UPDATE reserva SET status = 'APROVADA', decidido_por_id = $2, decidido_em = now() WHERE id = $1", [id, req.auth.id]);
        await registrarHistorico(c, id, 'PENDENTE', 'APROVADA', req.auth.id);
        await notificar(c, res.solicitante_id, id, `Sua reserva de ${res.ambiente_nome} (${fmt(res.inicio)}) foi APROVADA`);

        // Recusa automática das pendentes do mesmo ambiente que colidem com a aprovada
        const motivo = 'Recusada automaticamente: outra solicitação foi aprovada para este horário';
        const outras = await c.query(
          `UPDATE reserva SET status = 'RECUSADA', decidido_por_id = $2, decidido_em = now(), justificativa_recusa = $3
            WHERE ambiente_id = $1 AND status = 'PENDENTE' AND id <> $6 AND inicio < $5 AND fim > $4
        RETURNING id, solicitante_id, inicio`,
          [res.ambiente_id, req.auth.id, motivo, res.inicio, res.fim, id],
        );
        for (const o of outras.rows) {
          await registrarHistorico(c, o.id, 'PENDENTE', 'RECUSADA', req.auth.id, motivo);
          await notificar(c, o.solicitante_id, o.id,
            `Sua reserva de ${res.ambiente_nome} (${fmt(o.inicio)}) foi RECUSADA automaticamente: outra solicitação foi aprovada para esse horário`);
        }
      });
    } catch (e) {
      if (isExclusionViolation(e)) throw new HttpError(409, 'Conflito: já existe uma reserva aprovada nesse horário');
      throw e;
    }
    return { ok: true };
  });

  app.post('/api/reservas/:id/recusar', async (req) => {
    const { id } = idParam.parse(req.params);
    const { justificativa } = z.object({
      justificativa: z.string().trim().min(3, 'A justificativa é obrigatória').max(300), // RN07
    }).parse(req.body);
    await tx(async (c) => {
      const r = await c.query(
        `SELECT r.* FROM reserva r WHERE r.id = $1 FOR UPDATE OF r`, [id]);
      const res = r.rows[0];
      if (!res) throw new HttpError(404, 'Reserva não encontrada');
      if (!(await podeDecidir(req.auth, res.ambiente_id))) throw new HttpError(403, 'Você não é autoridade deste ambiente');
      if (res.status !== 'PENDENTE') throw new HttpError(409, 'Só é possível decidir solicitações pendentes');
      await c.query(
        "UPDATE reserva SET status = 'RECUSADA', decidido_por_id = $2, decidido_em = now(), justificativa_recusa = $3 WHERE id = $1",
        [id, req.auth.id, justificativa]);
      await registrarHistorico(c, id, 'PENDENTE', 'RECUSADA', req.auth.id, justificativa);
      await notificar(c, res.solicitante_id, id, `Sua reserva de ${res.ambiente_nome} (${fmt(res.inicio)}) foi RECUSADA: ${justificativa}`);
    });
    return { ok: true };
  });

  // RF14
  app.get('/api/reservas', { preHandler: requireAdmin }, async (req) => {
    const { status } = z.object({ status: z.enum(['PENDENTE', 'APROVADA', 'RECUSADA', 'CANCELADA']).optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT r.id, r.ambiente_nome, u.nome AS solicitante_nome, r.inicio, r.fim, r.finalidade, r.status, r.criado_em
         FROM reserva r LEFT JOIN ambiente a ON a.id = r.ambiente_id JOIN usuario u ON u.id = r.solicitante_id
        WHERE ($1::status_reserva IS NULL OR r.status = $1::status_reserva)
        ORDER BY r.inicio DESC LIMIT 500`,
      [status ?? null],
    );
    return rows;
  });
}
