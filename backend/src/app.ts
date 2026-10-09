import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { ambienteRoutes } from './routes/ambientes.js';
import { reservaRoutes } from './routes/reservas.js';
import { tipoRoutes } from './routes/tipos.js';
import { mapaRoutes, MAX_BYTES } from './routes/mapa.js';
import { notificacaoRoutes } from './routes/notificacoes.js';
import { configuracaoRoutes } from './routes/configuracao.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.register(cookie);
  app.register(jwt, { secret: config.jwtSecret, cookie: { cookieName: 'token', signed: false } });

  // fotos chegam como corpo binário da requisição
  app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp'], { parseAs: 'buffer', bodyLimit: MAX_BYTES + 1024 }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ erro: err.issues[0]?.message ?? 'Dados inválidos' });
    if ((err as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ erro: 'Imagem grande demais (máximo 8 MB)' });
    if (err instanceof HttpError) return reply.code(err.status).send({ erro: err.message });
    app.log.error(err);
    return reply.code(500).send({ erro: 'Erro interno' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.register(authRoutes);
  app.register(ambienteRoutes);
  app.register(reservaRoutes);
  app.register(notificacaoRoutes);
  app.register(mapaRoutes);
  app.register(tipoRoutes);
  app.register(configuracaoRoutes);
  return app;
}
