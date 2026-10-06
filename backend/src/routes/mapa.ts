import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { HttpError } from '../app.js';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { AREAS_PADRAO } from '../mapa-padrao.js';

export const MAPA = { largura: 1094, altura: 251 }; // unidades do desenho
const MAX_FOTOS = 10;
export const MAX_BYTES = 8 * 1024 * 1024;

const idParam = z.object({ id: z.coerce.number().int().positive() });
const pontos = z.array(z.tuple([z.number().int().min(0).max(MAPA.largura), z.number().int().min(0).max(MAPA.altura)])).min(3).max(24);
const areaBody = z.object({
  numero: z.number().int().min(0).max(999).nullable().optional(),
  rotulo: z.string().trim().min(1, 'Informe o nome da área').max(80),
  tipo: z.string().trim().min(1, 'Escolha o tipo').max(40),
  pontos,
  ambiente_id: z.number().int().positive().nullable().optional(),
});

/** Descobre o tipo de imagem pelos primeiros bytes (não confia no que o navegador diz). */
export function tipoImagem(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

export async function apagarArquivos(arquivos: string[]) {
  for (const a of arquivos) await unlink(join(config.uploadsDir, a)).catch(() => undefined);
}

const SQL_AREAS = `
  SELECT m.id, m.numero, m.rotulo, COALESCE(a.tipo, m.tipo) AS tipo, m.pontos, m.ambiente_id,
         a.nome AS ambiente_nome, a.ativo AS ambiente_ativo,
         (SELECT COUNT(*)::int FROM ambiente_foto f WHERE f.ambiente_id = m.ambiente_id) AS fotos
    FROM mapa_area m LEFT JOIN ambiente a ON a.id = m.ambiente_id
   ORDER BY m.numero NULLS LAST, m.id`;

const dadosMapa = async () => ({
  ...MAPA,
  tipos: (await pool.query('SELECT nome, cor FROM tipo_ambiente ORDER BY id')).rows as { nome: string; cor: string }[],
  areas: (await pool.query(SQL_AREAS)).rows,
});

export async function mapaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Mapa: todos veem. O desenho é o mesmo para usuários e administradores; só o admin edita.
  app.get('/api/mapa', async () => {
    return dadosMapa();
  });
  // Áreas do desenho original (para o botão "Restaurar áreas ausentes" do editor)
  app.get('/api/mapa/padrao', { preHandler: requireAdmin }, async () => AREAS_PADRAO);

  const salvar = async (id: number | null, b: z.infer<typeof areaBody>) => {
    try {
      if (b.ambiente_id) {
        const a = await pool.query('SELECT 1 FROM ambiente WHERE id = $1', [b.ambiente_id]);
        if (!a.rowCount) throw new HttpError(404, 'Ambiente não encontrado');
      }
      const params = [b.numero ?? null, b.rotulo, b.tipo, JSON.stringify(b.pontos), b.ambiente_id ?? null];
      const r = id
        ? await pool.query('UPDATE mapa_area SET numero=$2, rotulo=$3, tipo=$4, pontos=$5::jsonb, ambiente_id=$6 WHERE id=$1 RETURNING id', [id, ...params])
        : await pool.query('INSERT INTO mapa_area (numero, rotulo, tipo, pontos, ambiente_id) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id', params);
      if (!r.rowCount) throw new HttpError(404, 'Área não encontrada');
      return r.rows[0].id as number;
    } catch (e) {
      if ((e as { code?: string }).code === '23503') throw new HttpError(400, `Tipo "${b.tipo}" não existe`);
      if ((e as { code?: string }).code === '23505') {
        const o = await pool.query('SELECT rotulo FROM mapa_area WHERE ambiente_id = $1', [b.ambiente_id]);
        throw new HttpError(409, `Este ambiente já está na área "${o.rows[0]?.rotulo ?? 'outra'}" do mapa. Desvincule-o de lá primeiro.`);
      }
      throw e;
    }
  };

  app.post('/api/mapa/areas', { preHandler: requireAdmin }, async (req, reply) =>
    reply.code(201).send({ id: await salvar(null, areaBody.parse(req.body)) }));
  app.put('/api/mapa/areas/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    await salvar(id, areaBody.parse(req.body));
    return { ok: true };
  });
  app.delete('/api/mapa/areas/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const r = await pool.query('DELETE FROM mapa_area WHERE id = $1', [id]);
    if (!r.rowCount) throw new HttpError(404, 'Área não encontrada');
    return { ok: true };
  });

  // Salva o mapa INTEIRO de uma vez (o editor trabalha num rascunho com Ctrl+Z e só grava ao clicar em Salvar).
  // Tudo ou nada: áreas que não vierem na lista são excluídas; `criar_ambiente` cria o ambiente (nome = nome da área).
  const mapaBody = z.object({
    areas: z.array(areaBody.extend({ id: z.number().int().positive().optional(), criar_ambiente: z.boolean().optional() })).max(200),
  });
  app.put('/api/mapa', { preHandler: requireAdmin }, async (req) => {
    const { areas } = mapaBody.parse(req.body);
    const vistos = new Map<number, string>();
    for (const a of areas) {
      if (!a.ambiente_id) continue;
      if (vistos.has(a.ambiente_id)) throw new HttpError(409, `O mesmo ambiente está em duas áreas ("${vistos.get(a.ambiente_id)}" e "${a.rotulo}"). Um ambiente só pode ficar em uma área.`);
      vistos.set(a.ambiente_id, a.rotulo);
    }
    await tx(async (c) => {
      const atuais = (await c.query('SELECT id FROM mapa_area')).rows.map((r) => Number(r.id));
      const ids = new Set(atuais);
      for (const a of areas) if (a.id && !ids.has(a.id)) throw new HttpError(404, 'Uma das áreas não existe mais. Recarregue a página.');
      const tipos = new Set((await c.query('SELECT nome FROM tipo_ambiente')).rows.map((r) => r.nome as string));
      for (const a of areas) if (!tipos.has(a.tipo)) throw new HttpError(400, `Tipo "${a.tipo}" não existe (área "${a.rotulo}").`);
      const mantidos = areas.filter((a) => a.id).map((a) => a.id!);
      await c.query('DELETE FROM mapa_area WHERE NOT (id = ANY($1::bigint[]))', [mantidos]);
      await c.query('UPDATE mapa_area SET ambiente_id = NULL WHERE id = ANY($1::bigint[])', [mantidos]); // evita choque entre trocas
      for (const a of areas) {
        let ambId = a.ambiente_id ?? null;
        if (ambId) {
          const ok = await c.query('SELECT 1 FROM ambiente WHERE id = $1', [ambId]);
          if (!ok.rowCount) throw new HttpError(404, `O ambiente da área "${a.rotulo}" não existe mais.`);
        } else if (a.criar_ambiente) {
          ambId = (await c.query('INSERT INTO ambiente (nome, tipo) VALUES ($1,$2) RETURNING id', [a.rotulo, a.tipo])).rows[0].id;
        }
        if (ambId && !a.criar_ambiente) await c.query('UPDATE ambiente SET tipo = $2 WHERE id = $1 AND tipo <> $2', [ambId, a.tipo]); // o tipo da área vale para o ambiente
        const p = [a.numero ?? null, a.rotulo, a.tipo, JSON.stringify(a.pontos), ambId];
        if (a.id) await c.query('UPDATE mapa_area SET numero=$2, rotulo=$3, tipo=$4, pontos=$5::jsonb, ambiente_id=$6 WHERE id=$1', [a.id, ...p]);
        else await c.query('INSERT INTO mapa_area (numero, rotulo, tipo, pontos, ambiente_id) VALUES ($1,$2,$3,$4::jsonb,$5)', p);
      }
    });
    return dadosMapa();
  });

  // ---------- Fotos dos ambientes ----------
  app.get('/api/ambientes/:id/fotos', async (req) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query('SELECT id, tamanho, criado_em FROM ambiente_foto WHERE ambiente_id = $1 ORDER BY id', [id]);
    return rows;
  });

  // O front envia a imagem como corpo da requisição (image/jpeg, image/png ou image/webp).
  app.post('/api/ambientes/:id/fotos', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, 'Envie uma imagem (JPG, PNG ou WebP)');
    if (buf.length > MAX_BYTES) throw new HttpError(413, 'Imagem grande demais (máximo 8 MB)');
    const tipo = tipoImagem(buf);
    if (!tipo) throw new HttpError(400, 'Arquivo não é uma imagem JPG, PNG ou WebP válida');
    const amb = await pool.query('SELECT 1 FROM ambiente WHERE id = $1', [id]);
    if (!amb.rowCount) throw new HttpError(404, 'Ambiente não encontrado');
    const n = await pool.query('SELECT COUNT(*)::int AS n FROM ambiente_foto WHERE ambiente_id = $1', [id]);
    if (n.rows[0].n >= MAX_FOTOS) throw new HttpError(409, `Limite de ${MAX_FOTOS} fotos por ambiente. Remova alguma antes de enviar outra.`);
    const arquivo = `${randomUUID()}.${tipo.ext}`;
    await mkdir(config.uploadsDir, { recursive: true });
    await writeFile(join(config.uploadsDir, arquivo), buf);
    const r = await pool.query(
      'INSERT INTO ambiente_foto (ambiente_id, arquivo, mime, tamanho, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [id, arquivo, tipo.mime, buf.length, req.auth.id]);
    return reply.code(201).send({ id: r.rows[0].id });
  });

  app.get('/api/fotos/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query('SELECT arquivo, mime FROM ambiente_foto WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Foto não encontrada');
    return reply.header('Content-Type', rows[0].mime).header('Cache-Control', 'private, max-age=3600')
      .send(createReadStream(join(config.uploadsDir, rows[0].arquivo)).on('error', () => undefined));
  });

  app.delete('/api/fotos/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const r = await pool.query('DELETE FROM ambiente_foto WHERE id = $1 RETURNING arquivo', [id]);
    if (!r.rowCount) throw new HttpError(404, 'Foto não encontrada');
    await apagarArquivos([r.rows[0].arquivo]);
    return { ok: true };
  });
}
