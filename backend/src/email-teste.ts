import nodemailer from 'nodemailer';
import { config } from './config.js';

// Uso: npm run email:teste -- destino@exemplo.com   (manda um e-mail de teste e mostra o erro exato, se houver)
const destino = process.argv[2] || config.smtp.user;
if (!config.smtp.host) { console.log('SMTP_HOST está vazio no backend/.env — e-mails desligados.'); process.exit(1); }
console.log(`Enviando de ${config.smtp.from} para ${destino} via ${config.smtp.host}:${config.smtp.port} ...`);
const t = nodemailer.createTransport({
  host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
});
try {
  const r = await t.sendMail({ from: config.smtp.from, to: destino, subject: '[Reserva UPE] Teste de e-mail', text: 'Se você está lendo isto, o envio de e-mails está funcionando.' });
  console.log('✔ Enviado:', r.response);
} catch (e) {
  console.error('✘ Falhou:', (e as Error).message);
  process.exit(1);
}
