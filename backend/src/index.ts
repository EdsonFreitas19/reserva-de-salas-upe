import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { emailsAutorizados, sincronizarListaAutorizados } from './allowlist.js';
import { pool } from './db.js';

await migrate();
await sincronizarListaAutorizados();
// ADMIN_EMAILS manda: quem está na lista vira administrador, quem saiu dela deixa de ser (contas dev-* ficam de fora)
await pool.query(
  `DELETE FROM usuario_papel WHERE papel = 'ADMIN'
     AND usuario_id IN (SELECT id FROM usuario WHERE google_id NOT LIKE 'dev-%' AND NOT (email = ANY($1::text[])))`,
  [config.adminEmails]);
await pool.query(
  `INSERT INTO usuario_papel (usuario_id, papel) SELECT id, 'ADMIN' FROM usuario WHERE email = ANY($1::text[]) ON CONFLICT DO NOTHING`,
  [config.adminEmails]);
const app = buildApp();
app.listen({ port: config.port, host: '0.0.0.0' }).then(() => {
  console.log(`API rodando em http://localhost:${config.port}`);
  if (config.devLogin) console.log('⚠  DEV_LOGIN ativo (login de teste sem Google).');
  console.log(`✔ Podem entrar: e-mails @${config.allowedDomains.join(', @')}, administradores (${config.adminEmails.join(', ') || 'nenhum'}) e ${emailsAutorizados().size} exceção(ões) em ${config.authorizedEmailsFile}`);
  if (!config.googleClientId) console.log('ℹ  GOOGLE_CLIENT_ID vazio: só o login de desenvolvimento funciona.');
});
