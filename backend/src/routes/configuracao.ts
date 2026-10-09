import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { regras } from '../config.js';

export interface RegrasReserva {
  periodo_max_meses: number;
  duracao_max_horas: number;
  /** Hoje, no fuso de Recife ('AAAA-MM-DD'). */
  hoje: string;
  /** Último dia em que ainda se pode reservar (hoje + período), 'AAAA-MM-DD'. */
  limite: string;
}

/** Regras ajustáveis pelo administrador (tabela `configuracao`) + as datas já calculadas no fuso de Recife. */
export async function lerRegrasReserva(): Promise<RegrasReserva> {
  const { rows } = await pool.query(
    `SELECT periodo_max_meses, duracao_max_horas,
            (now() AT TIME ZONE $1)::date::text AS hoje,
            ((now() AT TIME ZONE $1)::date + make_interval(months => periodo_max_meses))::date::text AS limite
       FROM configuracao WHERE id = 1`,
    [regras.fuso],
  );
  return rows[0];
}

export async function configuracaoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Todos precisam saber o limite para a agenda não mostrar dias que não podem ser reservados
  app.get('/api/configuracao', async () => lerRegrasReserva());

  // O administrador decide o período máximo de reserva (em meses) e a duração máxima de cada reserva (em horas)
  app.put('/api/configuracao', { preHandler: requireAdmin }, async (req) => {
    const b = z.object({
      periodo_max_meses: z.number({ invalid_type_error: 'Informe o período em meses' })
        .int('O período deve ser um número inteiro de meses').min(1, 'O período mínimo é 1 mês').max(24, 'O período máximo é 24 meses'),
      duracao_max_horas: z.number({ invalid_type_error: 'Informe a duração em horas' })
        .int('A duração deve ser um número inteiro de horas').min(1, 'A duração mínima é 1 hora').max(24, 'A duração máxima é 24 horas'),
    }).parse(req.body);
    await pool.query('UPDATE configuracao SET periodo_max_meses = $1, duracao_max_horas = $2 WHERE id = 1', [b.periodo_max_meses, b.duracao_max_horas]);
    return lerRegrasReserva();
  });
}
