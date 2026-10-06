import { defineConfig } from 'vitest/config';
import 'dotenv/config';

const base = process.env.DATABASE_URL ?? 'postgres://reserva:reserva@localhost:5432/reserva_upe';
const testUrl = base.replace(/\/[^/]+$/, '/reserva_upe_test');

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: { DATABASE_URL: testUrl, NODE_ENV: 'test', DEV_LOGIN: 'true', JWT_SECRET: 'test', ALLOWED_DOMAINS: 'upe.br,teste.local', ADMIN_EMAILS: '', AUTHORIZED_EMAILS_FILE: 'test/nao-existe.txt', UPLOADS_DIR: 'test/uploads-tmp', GOOGLE_CLIENT_ID: '' },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
