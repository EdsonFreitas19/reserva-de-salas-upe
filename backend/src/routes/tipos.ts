import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { pool } from '../db.js';
import { requireAdmin, requireAuth } from '../auth.js';

export const TIPO_PADRAO = 'Sem tipo';
const idParam = z.object({ id: z.coerce.number().int().positive() });
const corpo = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do tipo').max(40, 'O nome do tipo deve ter até 40 letras'),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
});

/** Garante que o tipo existe no catálogo (o tipo de um ambiente nunca é digitado livremente). */
export async function exigirTipo(nome: string) {
  const r = await pool.query('SELECT 1 FROM tipo_ambiente WHERE nome = $1', [nome]);
  if (!r.rowCount) throw new HttpError(400, `Tipo "${nome}" não existe. Escolha um da lista ou adicione um novo.`);
}

export async function tipoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/tipos', async () => {
    const { rows } = await pool.query(
      `SELECT t.id, t.nome, t.cor,
              (SELECT COUNT(*)::int FROM ambiente a WHERE a.tipo = t.nome) AS ambientes,
              (SELECT COUNT(*)::int FROM mapa_area m WHERE m.tipo = t.nome) AS areas
         FROM tipo_ambiente t ORDER BY t.id`);
    return rows;
  });

  const duplicado = async (nome: string, ignorar = 0) =>
    (await pool.query('SELECT 1 FROM tipo_ambiente WHERE lower(nome) = lower($1) AND id <> $2', [nome, ignorar])).rowCount;

  app.post('/api/tipos', { preHandler: requireAdmin }, async (req, reply) => {
    const b = corpo.parse(req.body);
    if (await duplicado(b.nome)) throw new HttpError(409, `Já existe o tipo "${b.nome}"`);
    const r = await pool.query('INSERT INTO tipo_ambiente (nome, cor) VALUES ($1,$2) RETURNING id', [b.nome, b.cor.toLowerCase()]);
    return reply.code(201).send({ id: r.rows[0].id });
  });

  // Renomear atualiza sozinho todos os ambientes e áreas que usam o tipo (chave estrangeira com ON UPDATE CASCADE).
  app.patch('/api/tipos/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = corpo.parse(req.body);
    const atual = await pool.query('SELECT nome FROM tipo_ambiente WHERE id = $1', [id]);
    if (atual.rows[0]?.nome === TIPO_PADRAO && b.nome !== TIPO_PADRAO) throw new HttpError(400, `O tipo "${TIPO_PADRAO}" é padrão do sistema e não pode ser renomeado (a cor pode ser alterada).`);
    if (await duplicado(b.nome, id)) throw new HttpError(409, `Já existe o tipo "${b.nome}"`);
    const r = await pool.query('UPDATE tipo_ambiente SET nome = $2, cor = $3 WHERE id = $1', [id, b.nome, b.cor.toLowerCase()]);
    if (!r.rowCount) throw new HttpError(404, 'Tipo não encontrado');
    return { ok: true };
  });

  app.delete('/api/tipos/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const t = await pool.query('SELECT nome FROM tipo_ambiente WHERE id = $1', [id]);
    if (!t.rowCount) throw new HttpError(404, 'Tipo não encontrado');
    const nome = t.rows[0].nome as string;
    if (nome === TIPO_PADRAO) throw new HttpError(400, `O tipo "${TIPO_PADRAO}" é padrão do sistema e não pode ser excluído.`);
    const emUso = await pool.query('SELECT 1 FROM ambiente WHERE tipo = $1 LIMIT 1', [nome]);
    if (emUso.rowCount) throw new HttpError(409, `O tipo "${nome}" está em uso por ambientes. Troque o tipo deles antes de excluir.`);
    // áreas do mapa sem ambiente que usam o tipo passam para outro tipo do catálogo
    const outro = { rows: [{ nome: TIPO_PADRAO }] };
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('UPDATE mapa_area SET tipo = $2 WHERE tipo = $1', [nome, outro.rows[0].nome]);
      await c.query('DELETE FROM tipo_ambiente WHERE id = $1', [id]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      if ((e as { code?: string }).code === '23503') throw new HttpError(409, `O tipo "${nome}" está em uso. Troque o tipo antes de excluir.`);
      throw e;
    } finally { c.release(); }
    return { ok: true };
  });
}
