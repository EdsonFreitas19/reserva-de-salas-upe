import 'dotenv/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// pasta backend/ (onde fica o arquivo de e-mails autorizados)
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://reserva:reserva@localhost:5432/reserva_upe',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  allowedDomains: list(process.env.ALLOWED_DOMAINS ?? 'upe.br'),
  adminEmails: list(process.env.ADMIN_EMAILS),
  /** Arquivo com os e-mails autorizados a entrar (um por linha). Caminho relativo é contado a partir da pasta backend/. */
  authorizedEmailsFile: resolve(backendRoot, process.env.AUTHORIZED_EMAILS_FILE ?? 'emails-autorizados.txt'),
  /** Pasta das fotos dos ambientes (relativa a backend/). */
  uploadsDir: resolve(backendRoot, process.env.UPLOADS_DIR ?? 'uploads'),
  devLogin: process.env.DEV_LOGIN === 'true',
  isProd: process.env.NODE_ENV === 'production',
};

/**
 * Regras de negócio do sistema. Estão todas aqui para facilitar a mudança.
 * (Definidas com a coordenação; ainda podem ser ajustadas conforme as respostas do NTI.)
 */
export const regras = {
  /** RN03: reserva PENDENTE não bloqueia o horário; só as APROVADAS bloqueiam. (Informativo — o código já segue isto.) */
  pendenteBloqueia: false,
  /** RN04: duração máxima de uma reserva, em horas. */
  duracaoMaximaHoras: 4,
  /** RN05: antecedência mínima para solicitar, em minutos (0 = basta ser no futuro). */
  antecedenciaMinimaMin: 0,
  /** Reservas só em dias de semana. Padrão ISO: 1 = segunda ... 5 = sexta. */
  diasPermitidos: [1, 2, 3, 4, 5],
  /** Fuso em que "dia" e "hora" são contados (reserva e horários ocupados). */
  fuso: 'America/Recife',
  /** RN08: SÓ a autoridade do ambiente aprova/recusa. O admin define os responsáveis e consulta tudo. */
};
