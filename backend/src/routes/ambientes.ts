import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { isAdmin, podeDecidir, requireAdmin, requireAuth } from '../auth.js';
import { HttpError } from '../app.js';
import { regras } from '../config.js';
import { exigirTipo } from './tipos.js';
import { apagarArquivos } from './mapa.js';
import { adicionarEmailNaLista, emailPermitido, removerEmailDaLista, mensagemNaoAutorizado, sincronizarListaAutorizados } from '../allowlist.js';

/** Horários ocupados: o administrador e os responsáveis do ambiente podem gerir. */
async function adminOuResponsavel(req: FastifyRequest, reply: FastifyReply) {
  const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
  if (isAdmin(req.auth) || (await podeDecidir(req.auth, id))) return;
  return reply.code(403).send({ erro: 'Apenas o administrador ou os responsáveis deste ambiente' });
}

const ambienteBody = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(150),
  tipo: z.string().trim().min(1, 'Escolha o tipo').max(40),
  capacidade: z.number().int().positive().nullable().optional(),
  localizacao: z.string().trim().max(150).nullable().optional(),
  ativo: z.boolean().optional(),
});

const hhmm = (msg: string) => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, msg);
const dataValida = (msg: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg).refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, msg);

const bloqueioBody = z.object({
  descricao: z.string().trim().min(1, 'Informe uma descrição (ex.: Aula de Banco de Dados)').max(150),
  dias_semana: z.array(z.number().int().min(1, 'Dia da semana inválido').max(7, 'Dia da semana inválido'))
    .min(1, 'Escolha ao menos um dia da semana'),
  hora_inicio: hhmm('Horário inicial inválido'),
  hora_fim: hhmm('Horário final inválido'),
  data_inicio: dataValida('Data inicial inválida'),
  data_fim: dataValida('Data final inválida'),
}).refine((b) => b.hora_fim > b.hora_inicio, { message: 'O horário final deve ser depois do inicial', path: ['hora_fim'] })
  .refine((b) => b.data_fim >= b.data_inicio, { message: 'A data final deve ser igual ou depois da inicial', path: ['data_fim'] });

const idParam = z.object({ id: z.coerce.number().int() });

/** Quem deixou de ser responsável por qualquer ambiente perde o papel AUTORIDADE. */
async function revogarPapelSeSemAmbiente(c: PoolClient, usuarioId: number) {
  await c.query(
    `DELETE FROM usuario_papel WHERE usuario_id = $1 AND papel = 'AUTORIDADE'
       AND NOT EXISTS (SELECT 1 FROM ambiente_autoridade WHERE usuario_id = $1)`,
    [usuarioId],
  );
}

/** Acha o usuário pelo e-mail; se nunca entrou, faz o pré-cadastro (assume o cadastro no primeiro login Google). */
async function usuarioPorEmail(c: PoolClient, email: string): Promise<number> {
  const u = await c.query('SELECT id, ativo FROM usuario WHERE email = $1', [email]);
  if (u.rows[0]) {
    if (!u.rows[0].ativo) throw new HttpError(400, 'Este usuário está desativado');
    return u.rows[0].id;
  }
  if (!emailPermitido(email)) throw new HttpError(400, mensagemNaoAutorizado());
  const nome = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  const novo = await c.query('INSERT INTO usuario (nome, email, google_id) VALUES ($1,$2,$3) RETURNING id', [nome, email, `pre-${email}`]);
  await c.query("INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1,'USUARIO')", [novo.rows[0].id]);
  return novo.rows[0].id;
}

/** Se já existe uma área do mapa SEM ambiente com o mesmo nome, liga o ambiente a ela (ex.: ambiente excluído e recriado). */
async function ligarAreaPeloNome(c: Pick<PoolClient, 'query'>, ambienteId: number, nome: string, tipo: string): Promise<string | null> {
  const ja = await c.query('SELECT 1 FROM mapa_area WHERE ambiente_id = $1', [ambienteId]);
  if (ja.rowCount) return null;
  const r = await c.query(
    `UPDATE mapa_area SET ambiente_id = $1, tipo = $3
      WHERE id = (SELECT id FROM mapa_area WHERE ambiente_id IS NULL AND lower(rotulo) = lower($2) ORDER BY id LIMIT 1)
      RETURNING rotulo`, [ambienteId, nome, tipo]);
  return r.rows[0]?.rotulo ?? null;
}

export async function ambienteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // RF03 (+ visão completa para o admin). Cada ambiente traz a lista de responsáveis (podem ser vários).
  app.get('/api/ambientes', async (req) => {
    const { todos } = z.object({ todos: z.string().optional() }).parse(req.query);
    const verTodos = todos === '1' && isAdmin(req.auth);
    const { rows } = await pool.query(
      `SELECT a.id, a.nome, a.tipo, a.capacidade, a.localizacao, a.ativo,
              COALESCE(json_agg(json_build_object('id', u.id, 'nome', u.nome, 'email', u.email) ORDER BY u.nome)
                       FILTER (WHERE u.id IS NOT NULL), '[]') AS autoridades
         FROM ambiente a
         LEFT JOIN ambiente_autoridade aa ON aa.ambiente_id = a.id
         LEFT JOIN usuario u ON u.id = aa.usuario_id
        WHERE ($1 OR a.ativo)
        GROUP BY a.id
        ORDER BY a.nome`,
      [verTodos],
    );
    return rows;
  });

  // RF04: reservas (pendentes e aprovadas) de um ambiente numa janela de tempo
  app.get('/api/ambientes/:id/reservas', async (req) => {
    const { id } = idParam.parse(req.params);
    const { de, ate } = z.object({ de: z.string().datetime({ offset: true }), ate: z.string().datetime({ offset: true }) }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT r.id, r.inicio, r.fim, r.status, r.finalidade, u.nome AS solicitante_nome
         FROM reserva r JOIN usuario u ON u.id = r.solicitante_id
        WHERE r.ambiente_id = $1 AND r.status IN ('PENDENTE','APROVADA')
          AND r.inicio < $3 AND r.fim > $2
        ORDER BY r.inicio`,
      [id, de, ate],
    );
    return rows;
  });

  // Horários OCUPADOS (aulas fixas, manutenção...) de um ambiente numa janela — já expandidos em datas reais.
  app.get('/api/ambientes/:id/bloqueios', async (req) => {
    const { id } = idParam.parse(req.params);
    const { de, ate } = z.object({ de: z.string().datetime({ offset: true }), ate: z.string().datetime({ offset: true }) }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT b.id, b.descricao,
              ((d::date + b.hora_inicio) AT TIME ZONE $4) AS inicio,
              ((d::date + b.hora_fim)    AT TIME ZONE $4) AS fim
         FROM bloqueio b
        CROSS JOIN LATERAL generate_series(
              ($2::timestamptz AT TIME ZONE $4)::date::timestamp,
              (($3::timestamptz AT TIME ZONE $4) - interval '1 second')::date::timestamp,
              interval '1 day') AS d
        WHERE b.ambiente_id = $1
          AND d::date BETWEEN b.data_inicio AND b.data_fim
          AND EXTRACT(ISODOW FROM d)::int = ANY (b.dias_semana)
        ORDER BY 3`,
      [id, de, ate, regras.fuso],
    );
    return rows;
  });

  // RF12
  app.post('/api/ambientes', { preHandler: requireAdmin }, async (req, reply) => {
    const b = ambienteBody.parse(req.body);
    await exigirTipo(b.tipo);
    const out = await tx(async (c) => {
      const { rows } = await c.query(
        'INSERT INTO ambiente (nome, tipo, capacidade, localizacao) VALUES ($1,$2,$3,$4) RETURNING id',
        [b.nome, b.tipo, b.capacidade ?? null, b.localizacao ?? null],
      );
      return { id: rows[0].id as number, area_ligada: await ligarAreaPeloNome(c, rows[0].id, b.nome, b.tipo) };
    });
    return reply.code(201).send(out);
  });

  app.patch('/api/ambientes/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = ambienteBody.parse(req.body);
    await exigirTipo(b.tipo);
    let areaLigada: string | null = null;
    await tx(async (c) => {
      const r = await c.query(
        `UPDATE ambiente SET nome=$2, tipo=$3, capacidade=$4, localizacao=$5, ativo=COALESCE($6, ativo) WHERE id=$1`,
        [id, b.nome, b.tipo, b.capacidade ?? null, b.localizacao ?? null, b.ativo ?? null],
      );
      if (!r.rowCount) throw new HttpError(404, 'Ambiente não encontrado');
      await c.query('UPDATE mapa_area SET tipo = $2 WHERE ambiente_id = $1 AND tipo <> $2', [id, b.tipo]); // a área acompanha o tipo do ambiente
      areaLigada = await ligarAreaPeloNome(c, id, b.nome, b.tipo);
      // O histórico mantém o nome antigo; só reservas ainda por acontecer passam a mostrar o nome novo.
      await c.query(
        `UPDATE reserva SET ambiente_nome = $2 WHERE ambiente_id = $1 AND status IN ('PENDENTE','APROVADA') AND fim > now()`,
        [id, b.nome]);
    });
    return { ok: true, area_ligada: areaLigada };
  });

  // RF13: o admin adiciona RESPONSÁVEIS (autoridades) do ambiente pelo e-mail institucional.
  // Pode haver vários: basta UM deles aprovar ou recusar. Quem nunca entrou é pré-cadastrado.
  app.post('/api/ambientes/:id/autoridades', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = z.union([
      z.object({ usuario_id: z.coerce.number().int() }),
      z.object({ email: z.string().trim().toLowerCase().email('E-mail inválido') }),
    ]).parse(req.body);
    await tx(async (c) => {
      const amb = await c.query('SELECT 1 FROM ambiente WHERE id = $1', [id]);
      if (!amb.rowCount) throw new HttpError(404, 'Ambiente não encontrado');
      let usuarioId: number;
      if ('usuario_id' in body) {
        const u = await c.query('SELECT 1 FROM usuario WHERE id = $1 AND ativo', [body.usuario_id]);
        if (!u.rowCount) throw new HttpError(404, 'Usuário não encontrado');
        usuarioId = body.usuario_id;
      } else usuarioId = await usuarioPorEmail(c, body.email);
      const adm = await c.query("SELECT 1 FROM usuario_papel WHERE usuario_id = $1 AND papel = 'ADMIN'", [usuarioId]);
      if (adm.rowCount) throw new HttpError(400, 'O administrador não pode ser responsável por ambiente');
      const ins = await c.query(
        'INSERT INTO ambiente_autoridade (ambiente_id, usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, usuarioId]);
      if (!ins.rowCount) throw new HttpError(409, 'Esta pessoa já é responsável por este ambiente');
      await c.query("INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1,'AUTORIDADE') ON CONFLICT DO NOTHING", [usuarioId]);
    });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/api/ambientes/:id/autoridades/:usuarioId', { preHandler: requireAdmin }, async (req) => {
    const { id, usuarioId } = z.object({ id: z.coerce.number().int(), usuarioId: z.coerce.number().int() }).parse(req.params);
    await tx(async (c) => {
      const r = await c.query('DELETE FROM ambiente_autoridade WHERE ambiente_id = $1 AND usuario_id = $2', [id, usuarioId]);
      if (!r.rowCount) throw new HttpError(404, 'Esta pessoa não é responsável por este ambiente');
      await revogarPapelSeSemAmbiente(c, usuarioId);
    });
    return { ok: true };
  });

  // Horários ocupados: definições cadastradas (admin)
  app.get('/api/ambientes/:id/bloqueios/regras', { preHandler: adminOuResponsavel }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query(
      `SELECT id, descricao, dias_semana, to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fim, 'HH24:MI') AS hora_fim,
              data_inicio::text AS data_inicio, data_fim::text AS data_fim
         FROM bloqueio WHERE ambiente_id = $1 ORDER BY data_inicio, hora_inicio, id`,
      [id],
    );
    return rows;
  });

  // Cadastrar horário ocupado (admin). Avisa quantas reservas já existentes (pendentes/aprovadas) colidem com ele.
  app.post('/api/ambientes/:id/bloqueios', { preHandler: adminOuResponsavel }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = bloqueioBody.parse(req.body);
    const dias = [...new Set(b.dias_semana)].sort();
    const amb = await pool.query('SELECT 1 FROM ambiente WHERE id = $1', [id]);
    if (!amb.rowCount) throw new HttpError(404, 'Ambiente não encontrado');

    const criado = await pool.query(
      `INSERT INTO bloqueio (ambiente_id, descricao, dias_semana, hora_inicio, hora_fim, data_inicio, data_fim, criado_por)
       VALUES ($1,$2,$3::smallint[],$4,$5,$6,$7,$8) RETURNING id`,
      [id, b.descricao, dias, b.hora_inicio, b.hora_fim, b.data_inicio, b.data_fim, req.auth.id],
    );
    const conf = await pool.query(
      `SELECT COUNT(*)::int AS n FROM reserva r
        WHERE r.ambiente_id = $1 AND r.status IN ('PENDENTE','APROVADA') AND r.fim > now()
          AND (r.inicio AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
          AND EXTRACT(ISODOW FROM (r.inicio AT TIME ZONE $2))::int = ANY ($5::smallint[])
          AND $6::time < (r.fim    AT TIME ZONE $2)::time
          AND $7::time > (r.inicio AT TIME ZONE $2)::time`,
      [id, regras.fuso, b.data_inicio, b.data_fim, dias, b.hora_inicio, b.hora_fim],
    );
    return reply.code(201).send({ id: criado.rows[0].id, conflitos: conf.rows[0].n });
  });

  app.delete('/api/ambientes/:id/bloqueios/:bloqueioId', { preHandler: adminOuResponsavel }, async (req) => {
    const { id, bloqueioId } = z.object({ id: z.coerce.number().int(), bloqueioId: z.coerce.number().int() }).parse(req.params);
    const r = await pool.query('DELETE FROM bloqueio WHERE id = $1 AND ambiente_id = $2', [bloqueioId, id]);
    if (!r.rowCount) throw new HttpError(404, 'Horário não encontrado');
    return { ok: true };
  });

  // Excluir ambiente: permitido mesmo com histórico. As reservas passadas continuam com o nome que o ambiente tinha
  // (ambiente_nome). Só não dá para excluir enquanto houver reservas pendentes/aprovadas por acontecer.
  app.delete('/api/ambientes/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    let arquivos: string[] = [];
    await tx(async (c) => {
      const amb = await c.query('SELECT 1 FROM ambiente WHERE id = $1 FOR UPDATE', [id]);
      if (!amb.rowCount) throw new HttpError(404, 'Ambiente não encontrado');
      const { rows } = await c.query(
        "SELECT COUNT(*)::int AS n FROM reserva WHERE ambiente_id = $1 AND status IN ('PENDENTE','APROVADA') AND fim > now()", [id]);
      if (rows[0].n > 0)
        throw new HttpError(409, `Este ambiente tem ${rows[0].n} reserva(s) pendente(s) ou aprovada(s) ainda por acontecer. Recuse ou cancele essas reservas antes de excluir.`);
      const auts = await c.query('DELETE FROM ambiente_autoridade WHERE ambiente_id = $1 RETURNING usuario_id', [id]);
      arquivos = (await c.query('SELECT arquivo FROM ambiente_foto WHERE ambiente_id = $1', [id])).rows.map((r) => r.arquivo as string);
      await c.query('DELETE FROM ambiente WHERE id = $1', [id]);
      for (const { usuario_id: uid } of auts.rows) await revogarPapelSeSemAmbiente(c, uid);
    });
    await apagarArquivos(arquivos); // fotos do ambiente excluído
    return { ok: true };
  });

  // Diretório de usuários para quem é responsável por alguma sala (ou administrador): quem são as pessoas do sistema,
  // pelas salas que cada uma responde e quantas reservas cada uma tem nas salas de quem consulta.
  app.get('/api/usuarios/diretorio', async (req) => {
    if (!req.auth.papeis.includes('AUTORIDADE') && !isAdmin(req.auth)) throw new HttpError(403, 'Apenas responsáveis por ambientes');
    const { rows } = await pool.query(
      `WITH minhas AS (SELECT ambiente_id FROM ambiente_autoridade WHERE usuario_id = $1)
       SELECT u.id, u.nome, u.email,
              EXISTS (SELECT 1 FROM usuario_papel p WHERE p.usuario_id = u.id AND p.papel = 'ADMIN') AS administrador,
              COALESCE((SELECT array_agg(a.nome ORDER BY a.nome) FROM ambiente_autoridade aa
                          JOIN ambiente a ON a.id = aa.ambiente_id WHERE aa.usuario_id = u.id), '{}') AS responsavel_por,
              (SELECT COUNT(*)::int FROM reserva r WHERE r.solicitante_id = u.id AND r.status = 'PENDENTE'
                  AND r.ambiente_id IN (SELECT ambiente_id FROM minhas)) AS pendentes_nas_minhas_salas,
              (SELECT COUNT(*)::int FROM reserva r WHERE r.solicitante_id = u.id AND r.status = 'APROVADA' AND r.fim > now()
                  AND r.ambiente_id IN (SELECT ambiente_id FROM minhas)) AS aprovadas_nas_minhas_salas
         FROM usuario u WHERE u.ativo ORDER BY u.nome`,
      [req.auth.id],
    );
    return rows;
  });

  // O administrador cadastra um novo usuário (professor/funcionário): o e-mail entra na lista de autorizados
  // (arquivo emails-autorizados.txt) e a conta é pré-criada; no primeiro login Google ela é assumida.
  app.post('/api/usuarios', { preHandler: requireAdmin }, async (req, reply) => {
    const { nome, email } = z.object({
      nome: z.string().trim().max(120).optional(),
      email: z.string().trim().toLowerCase().email('E-mail inválido'),
    }).parse(req.body);
    const ja = await pool.query('SELECT 1 FROM usuario WHERE email = $1 AND ativo', [email]);
    if (ja.rowCount && emailPermitido(email)) throw new HttpError(409, 'Este e-mail já está cadastrado');
    adicionarEmailNaLista(email);
    await sincronizarListaAutorizados();
    await pool.query('UPDATE usuario SET ativo = true WHERE email = $1', [email]);
    if (nome) await pool.query('UPDATE usuario SET nome = $1 WHERE email = $2', [nome, email]);
    return reply.code(201).send({ ok: true });
  });

  // Retira o acesso de um usuário (tira o e-mail da lista e remove as responsabilidades dele).
  app.delete('/api/usuarios/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const u = await pool.query(
      "SELECT u.email, EXISTS (SELECT 1 FROM usuario_papel WHERE usuario_id = u.id AND papel = 'ADMIN') AS adm FROM usuario u WHERE u.id = $1", [id]);
    if (!u.rowCount) throw new HttpError(404, 'Usuário não encontrado');
    if (u.rows[0].adm) throw new HttpError(400, 'Não é possível remover um administrador');
    removerEmailDaLista(u.rows[0].email);
    await tx(async (c) => {
      await c.query('DELETE FROM ambiente_autoridade WHERE usuario_id = $1', [id]);
      await revogarPapelSeSemAmbiente(c, id);
      await c.query('UPDATE usuario SET ativo = false WHERE id = $1', [id]);
    });
    return { ok: true };
  });

  // Lista de usuários (admin) para sugerir e-mails ao definir responsáveis
  app.get('/api/usuarios', { preHandler: requireAdmin }, async () => {
    await sincronizarListaAutorizados(); // e-mails novos do arquivo já aparecem nas sugestões
    const { rows } = await pool.query(
      `SELECT u.id, u.nome, u.email, COALESCE(array_agg(DISTINCT p.papel::text) FILTER (WHERE p.papel IS NOT NULL), '{}') AS papeis,
              COALESCE((SELECT json_agg(json_build_object('id', a.id, 'nome', a.nome) ORDER BY a.nome)
                          FROM ambiente_autoridade aa JOIN ambiente a ON a.id = aa.ambiente_id
                         WHERE aa.usuario_id = u.id), '[]'::json) AS responsavel_por
         FROM usuario u LEFT JOIN usuario_papel p ON p.usuario_id = u.id
        WHERE u.ativo GROUP BY u.id ORDER BY u.nome`,
    );
    return rows;
  });
}
