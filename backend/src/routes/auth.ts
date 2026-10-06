import type { FastifyInstance, FastifyReply } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { config } from '../config.js';
import { emailPermitido, mensagemNaoAutorizado } from '../allowlist.js';
import { pool, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError } from '../app.js';

const google = new OAuth2Client(config.googleClientId || undefined);

async function upsertUsuario(nome: string, email: string, googleId: string) {
  return tx(async (c) => {
    const r = await c.query(
      `INSERT INTO usuario (nome, email, google_id) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome,
         google_id = CASE WHEN usuario.google_id LIKE 'pre-%' THEN EXCLUDED.google_id ELSE usuario.google_id END
       RETURNING id, ativo`,
      [nome, email, googleId],
    );
    const { id, ativo } = r.rows[0];
    await c.query("INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1,'USUARIO') ON CONFLICT DO NOTHING", [id]);
    if (config.adminEmails.includes(email.toLowerCase()))
      await c.query("INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1,'ADMIN') ON CONFLICT DO NOTHING", [id]);
    else // quem saiu de ADMIN_EMAILS deixa de ser administrador
      await c.query("DELETE FROM usuario_papel WHERE usuario_id = $1 AND papel = 'ADMIN'", [id]);
    await c.query("DELETE FROM ambiente_autoridade WHERE usuario_id IN (SELECT usuario_id FROM usuario_papel WHERE papel = 'ADMIN' AND usuario_id = $1)", [id]);
    await c.query("DELETE FROM usuario_papel WHERE usuario_id = $1 AND papel = 'AUTORIDADE' AND EXISTS (SELECT 1 FROM usuario_papel WHERE usuario_id = $1 AND papel = 'ADMIN')", [id]);
    return { id: id as number, ativo: ativo as boolean };
  });
}

function startSession(app: FastifyInstance, reply: FastifyReply, id: number) {
  const token = app.jwt.sign({ sub: id }, { expiresIn: '8h' });
  reply.setCookie('token', token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: 8 * 3600,
  });
}

export async function authRoutes(app: FastifyInstance) {
  // Config pública para o front (id do Google e se o login de teste está ativo)
  app.get('/api/config', async () => ({ googleClientId: config.googleClientId, devLogin: config.devLogin }));

  // RF01 + RNF01: o front envia o ID token do Google; o servidor valida assinatura, audiência e domínio.
  app.post('/api/auth/google', async (req, reply) => {
    if (!config.googleClientId) throw new HttpError(503, 'Login Google não configurado');
    const { credential } = z.object({ credential: z.string().min(10) }).parse(req.body);
    let payload;
    try {
      const ticket = await google.verifyIdToken({ idToken: credential, audience: config.googleClientId });
      payload = ticket.getPayload();
    } catch {
      throw new HttpError(401, 'Token do Google inválido');
    }
    if (!payload?.email || !payload.email_verified) throw new HttpError(401, 'E-mail não verificado');
    const email = payload.email.toLowerCase();
    // Só entra e-mail do domínio permitido (@upe.br), administrador ou exceção do arquivo emails-autorizados.txt
    if (!emailPermitido(email)) throw new HttpError(403, mensagemNaoAutorizado());
    const u = await upsertUsuario(payload.name ?? email, email, payload.sub);
    if (!u.ativo) throw new HttpError(403, 'Acesso desativado');
    startSession(app, reply, u.id);
    return { ok: true };
  });

  // Login de desenvolvimento (somente com DEV_LOGIN=true)
  app.get('/api/auth/dev-users', async () => {
    if (!config.devLogin) throw new HttpError(404, 'Indisponível');
    const { rows } = await pool.query("SELECT nome, email FROM usuario WHERE google_id LIKE 'dev-%' AND ativo ORDER BY id");
    return rows;
  });
  app.post('/api/auth/dev-login', async (req, reply) => {
    if (!config.devLogin) throw new HttpError(404, 'Indisponível');
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const { rows } = await pool.query("SELECT id FROM usuario WHERE email = $1 AND google_id LIKE 'dev-%' AND ativo", [email]);
    if (!rows[0]) throw new HttpError(404, 'Usuário de teste não encontrado (rode npm run seed)');
    startSession(app, reply, rows[0].id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notificacao WHERE usuario_id = $1 AND NOT lida`, [req.auth.id]);
    // Ambientes pelos quais esta pessoa é responsável (é "autoridade" deles): qualquer usuário pode ser
    const resp = await pool.query(
      `SELECT a.id, a.nome FROM ambiente_autoridade aa JOIN ambiente a ON a.id = aa.ambiente_id
        WHERE aa.usuario_id = $1 ORDER BY a.nome`, [req.auth.id]);
    return { ...req.auth, naoLidas: rows[0].n, responsavelPor: resp.rows };
  });
}
