import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';
import { emailPermitido } from './allowlist.js';

export type Papel = 'USUARIO' | 'AUTORIDADE' | 'ADMIN';
export interface Auth { id: number; nome: string; email: string; papeis: Papel[] }

declare module 'fastify' {
  interface FastifyRequest { auth: Auth }
}
declare module '@fastify/jwt' {
  interface FastifyJWT { payload: { sub: number }; user: { sub: number } }
}

/** RF02: identifica o usuário e seus papéis a cada requisição (mudanças de papel valem na hora). */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ erro: 'Não autenticado' });
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.email, u.google_id,
            COALESCE(array_agg(p.papel::text) FILTER (WHERE p.papel IS NOT NULL), '{}') AS papeis
       FROM usuario u LEFT JOIN usuario_papel p ON p.usuario_id = u.id
      WHERE u.id = $1 AND u.ativo GROUP BY u.id`,
    [req.user.sub],
  );
  if (!rows[0]) return reply.code(401).send({ erro: 'Usuário inativo ou inexistente' });
  // E-mail que deixou de ser permitido (domínio/lista) perde o acesso na hora (contas de teste do DEV_LOGIN ficam de fora)
  if (!/^dev-/.test(rows[0].google_id) && !emailPermitido(rows[0].email))
    return reply.code(401).send({ erro: 'Seu e-mail não está mais autorizado a usar o sistema' });
  const { google_id: _g, ...auth } = rows[0];
  req.auth = auth;
}

export const isAdmin = (a: Auth) => a.papeis.includes('ADMIN');

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!isAdmin(req.auth)) return reply.code(403).send({ erro: 'Apenas administradores' });
}

/**
 * RNF02 + RN08: quem pode aprovar, recusar e cancelar reservas de um ambiente.
 * O administrador pode em TODOS os ambientes (sem ser listado como responsável); a autoridade, só nos dela.
 */
export async function podeDecidir(a: Auth, ambienteId: number): Promise<boolean> {
  if (isAdmin(a)) return true;
  const { rowCount } = await pool.query(
    'SELECT 1 FROM ambiente_autoridade WHERE ambiente_id = $1 AND usuario_id = $2',
    [ambienteId, a.id],
  );
  return !!rowCount;
}
