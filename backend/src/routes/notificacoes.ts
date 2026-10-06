import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';

// RF15
export async function notificacaoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/notificacoes', async (req) => {
    const { rows } = await pool.query(
      'SELECT id, reserva_id, mensagem, lida, criado_em FROM notificacao WHERE usuario_id = $1 ORDER BY id DESC LIMIT 50',
      [req.auth.id],
    );
    return rows;
  });

  app.post('/api/notificacoes/lidas', async (req) => {
    await pool.query('UPDATE notificacao SET lida = true WHERE usuario_id = $1 AND NOT lida', [req.auth.id]);
    return { ok: true };
  });
}
