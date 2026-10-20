import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { pool } from './db.js';
import { config } from './config.js';

/**
 * Envio de e-mails (opcional). Só liga se SMTP_HOST estiver no .env; sem isso o sistema funciona
 * normalmente e os avisos continuam aparecendo apenas dentro do sistema (sininho de notificações).
 * Uma falha de e-mail NUNCA derruba nem desfaz uma reserva: só é registrada no log.
 */
let transporte: Transporter | null = null;
let testeAtivo = false;
const emVoo = new Set<Promise<void>>();

function obterTransporte(): Transporter | null {
  if (transporte) return transporte;
  if (!config.smtp.host) return null;
  transporte = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure, // true = porta 465; false = 587 com STARTTLS
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporte;
}

/** Só para os testes: troca o envio real por um transporte que apenas guarda as mensagens. */
export function usarTransporteDeTeste(t: Transporter) { transporte = t; testeAtivo = true; }
export const emailAtivo = () => testeAtivo || !!config.smtp.host;

function html(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const link = config.appUrl ? `<p><a href="${config.appUrl}">Abrir o Sistema de Reserva de Ambientes</a></p>` : '';
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222"><p>${esc}</p>${link}` +
    `<hr><p style="font-size:12px;color:#777">Mensagem automática do Sistema de Reserva de Ambientes da UPE. Não responda a este e-mail.</p></div>`;
}

/** Manda um e-mail para cada notificação (as mesmas mensagens do sininho). Nunca lança erro. */
export function enviarEmailsDasNotificacoes(ids: number[]): void {
  if (!ids.length || !emailAtivo()) return;
  const p = (async () => {
    try {
      const t = obterTransporte();
      if (!t) return;
      const { rows } = await pool.query(
        `SELECT n.mensagem, u.email, u.nome FROM notificacao n JOIN usuario u ON u.id = n.usuario_id WHERE n.id = ANY($1::int[])`, [ids]);
      for (const r of rows) {
        try {
          await t.sendMail({
            from: config.smtp.from, to: r.email,
            subject: `[Reserva UPE] ${r.mensagem.length > 90 ? r.mensagem.slice(0, 87) + '...' : r.mensagem}`,
            text: `${r.mensagem}${config.appUrl ? `\n\n${config.appUrl}` : ''}`,
            html: html(r.mensagem),
          });
        } catch (e) { console.error(`[email] falha ao enviar para ${r.email}:`, (e as Error).message); }
      }
    } catch (e) { console.error('[email] erro:', (e as Error).message); }
  })();
  emVoo.add(p);
  void p.finally(() => emVoo.delete(p));
}

/** Só para os testes: espera os envios em andamento terminarem. */
export const aguardarEmails = async () => { await Promise.all([...emVoo]); };
