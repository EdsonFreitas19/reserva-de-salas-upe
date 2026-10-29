import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { config } from './config.js';

/**
 * Envio de e-mails (opcional). Só liga se SMTP_HOST estiver no .env; sem isso o sistema funciona
 * normalmente e os avisos continuam aparecendo apenas dentro do sistema (sininho de notificações).
 * Uma falha de e-mail NUNCA derruba nem desfaz uma reserva: só é registrada no log.
 */
const LOGO = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'logo-upe.png');
const FUSO = 'America/Recife';

export interface EventoEmail {
  notificacaoId: number;
  reservaId: number;
  tipo: 'NOVA' | 'APROVADA' | 'RECUSADA' | 'CANCELADA' | 'CANCELADA_PELO_SOLICITANTE';
  /** Quem fez a ação (quem pediu, aprovou, recusou ou cancelou) */
  autor: string;
  motivo?: string;
}

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

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Dados { ambiente: string; inicio: Date; fim: Date; finalidade: string; solicitante: string; }

const diaCompleto = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
const diaCurto = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
const hora = (d: Date) => d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });

interface Texto {
  assunto: string; faixa: string; cor: string; saudacao: string; intro: string; // intro pode ter <b>
  destaque?: [string, string]; botao: string; caminho: string;
}

/** Textos de cada situação. `quem` = quem recebe: o responsável (NOVA, cancelada pelo solicitante) ou o solicitante. */
function textoDoEvento(e: EventoEmail, d: Dados, nomeDestino: string): Texto {
  const quando = `${d.ambiente} (${diaCurto(d.inicio)}, ${hora(d.inicio)})`;
  const autor = `<b>${esc(e.autor)}</b>`;
  const saud = `Prezado(a) ${esc(nomeDestino)},`;
  switch (e.tipo) {
    case 'NOVA':
      return { assunto: `Nova solicitação de reserva — ${quando}`, faixa: 'Nova solicitação de reserva', cor: '#2f4871',
        saudacao: 'Prezado(a) responsável,',
        intro: `${autor} solicitou a reserva do ambiente sob a sua responsabilidade. A solicitação aguarda a sua análise.`,
        botao: 'Analisar solicitação', caminho: '/aprovacoes' };
    case 'APROVADA':
      return { assunto: `Reserva aprovada — ${quando}`, faixa: 'Reserva aprovada', cor: '#1e8449', saudacao: saud,
        intro: `Informamos que a sua solicitação de reserva foi <b>aprovada</b> por ${autor}.`,
        botao: 'Ver minhas reservas', caminho: '/minhas' };
    case 'RECUSADA':
      return { assunto: `Reserva recusada — ${quando}`, faixa: 'Reserva recusada', cor: '#c4161c', saudacao: saud,
        intro: `Informamos que a sua solicitação de reserva <b>não pôde ser atendida</b>.`,
        destaque: [`Motivo informado${e.motivo && !e.motivo.startsWith('Outra') ? ` por ${esc(e.autor)}` : ''}:`, esc(e.motivo ?? '')],
        botao: 'Fazer nova solicitação', caminho: '/' };
    case 'CANCELADA':
      return { assunto: `Reserva cancelada — ${quando}`, faixa: 'Reserva cancelada', cor: '#6b7280', saudacao: saud,
        intro: `Informamos que a sua reserva, que estava aprovada, foi <b>cancelada</b> por ${autor}.`,
        destaque: ['Motivo do cancelamento:', esc(e.motivo ?? '')],
        botao: 'Fazer nova solicitação', caminho: '/' };
    case 'CANCELADA_PELO_SOLICITANTE':
      return { assunto: `Reserva cancelada pelo solicitante — ${quando}`, faixa: 'Reserva cancelada pelo solicitante', cor: '#6b7280',
        saudacao: 'Prezado(a) responsável,',
        intro: `${autor} cancelou uma reserva que já estava aprovada no ambiente sob a sua responsabilidade. O horário está novamente disponível.`,
        botao: 'Abrir o sistema', caminho: '/aprovacoes' };
  }
}

function montarHtml(t: Texto, d: Dados): string {
  const linhas: [string, string][] = [
    ['Ambiente', d.ambiente], ['Data', diaCompleto(d.inicio)], ['Horário', `${hora(d.inicio)} às ${hora(d.fim)}`],
    ['Finalidade', d.finalidade], ['Solicitante', d.solicitante],
  ];
  const tabela = linhas.map(([k, v]) =>
    `<tr><td style="padding:8px 0;color:#6b7280;width:130px;vertical-align:top">${k}</td><td style="padding:8px 0;color:#111827;font-weight:600">${esc(v)}</td></tr>`).join('');
  const dest = t.destaque
    ? `<div style="margin:18px 0 0;padding:12px 14px;background:#f3f4f6;border-left:4px solid ${t.cor};border-radius:4px;color:#374151"><b>${t.destaque[0]}</b><br>${t.destaque[1]}</div>` : '';
  const botao = config.appUrl
    ? `<p style="margin:24px 0 8px"><a href="${config.appUrl}${t.caminho}" style="display:inline-block;background:#2f4871;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:700">${t.botao}</a></p>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body style="margin:0;background:#eef1f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">
<tr><td style="padding:20px 28px;border-bottom:1px solid #e5e7eb"><table role="presentation" width="100%"><tr>
<td width="84"><img src="cid:logo-upe" width="76" alt="UPE" style="display:block"></td>
<td style="padding-left:14px"><div style="font-size:16px;font-weight:700;color:#2f4871">Universidade de Pernambuco</div>
<div style="font-size:13px;color:#6b7280">Campus Caruaru · Sistema de Reserva de Ambientes</div></td></tr></table></td></tr>
<tr><td style="background:${t.cor};color:#ffffff;padding:12px 28px;font-weight:700;letter-spacing:.4px;font-size:14px;text-transform:uppercase">${t.faixa}</td></tr>
<tr><td style="padding:26px 28px 8px"><p style="margin:0 0 14px">${t.saudacao}</p><p style="margin:0 0 16px">${t.intro}</p>
<table role="presentation" width="100%" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;font-size:14.5px">${tabela}</table>${dest}${botao}</td></tr>
<tr><td style="padding:18px 28px 24px"><p style="margin:0 0 2px;font-size:14px">Atenciosamente,</p>
<p style="margin:0;font-weight:700;color:#2f4871">Sistema de Reserva de Ambientes</p>
<p style="margin:0;font-size:13px;color:#6b7280">Núcleo de Tecnologia da Informação (NTI) · Universidade de Pernambuco, Campus Caruaru</p></td></tr>
<tr><td style="background:#2f4871;padding:12px 28px;color:#c9d3e6;font-size:12px">Mensagem automática. Por favor, não responda a este e-mail.</td></tr>
</table></td></tr></table></body></html>`;
}

const semHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function montarTexto(t: Texto, d: Dados): string {
  return [
    semHtml(t.saudacao), '', semHtml(t.intro), '',
    `Ambiente: ${d.ambiente}`, `Data: ${diaCompleto(d.inicio)}`, `Horário: ${hora(d.inicio)} às ${hora(d.fim)}`,
    `Finalidade: ${d.finalidade}`, `Solicitante: ${d.solicitante}`,
    ...(t.destaque ? ['', semHtml(t.destaque[0]), semHtml(t.destaque[1])] : []),
    ...(config.appUrl ? ['', `${t.botao}: ${config.appUrl}${t.caminho}`] : []),
    '', 'Atenciosamente,', 'Sistema de Reserva de Ambientes',
    'Núcleo de Tecnologia da Informação (NTI) · Universidade de Pernambuco, Campus Caruaru',
    '', 'Mensagem automática. Por favor, não responda a este e-mail.',
  ].join('\n');
}

/** Manda um e-mail formal para cada notificação criada. Nunca lança erro. */
export function enviarEmailsDasNotificacoes(eventos: EventoEmail[]): void {
  if (!eventos.length || !emailAtivo()) return;
  const p = (async () => {
    try {
      const t = obterTransporte();
      if (!t) return;
      for (const e of eventos) {
        let para = '?';
        try {
          const { rows } = await pool.query(
            `SELECT u.email, u.nome AS destino, r.ambiente_nome AS ambiente, r.inicio, r.fim, r.finalidade, s.nome AS solicitante
               FROM notificacao n
               JOIN usuario u ON u.id = n.usuario_id
               JOIN reserva r ON r.id = n.reserva_id
               JOIN usuario s ON s.id = r.solicitante_id
              WHERE n.id = $1`, [e.notificacaoId]);
          const r = rows[0];
          if (!r) continue;
          para = r.email;
          const d: Dados = { ambiente: r.ambiente, inicio: new Date(r.inicio), fim: new Date(r.fim), finalidade: r.finalidade, solicitante: r.solicitante };
          const txt = textoDoEvento(e, d, r.destino);
          await t.sendMail({
            from: config.smtp.from, to: r.email, subject: txt.assunto,
            text: montarTexto(txt, d), html: montarHtml(txt, d),
            attachments: [{ filename: 'logo-upe.png', path: LOGO, cid: 'logo-upe' }],
          });
        } catch (err) { console.error(`[email] falha ao enviar para ${para}:`, (err as Error).message); }
      }
    } catch (err) { console.error('[email] erro:', (err as Error).message); }
  })();
  emVoo.add(p);
  void p.finally(() => emVoo.delete(p));
}

/** Só para os testes: espera os envios em andamento terminarem. */
export const aguardarEmails = async () => { await Promise.all([...emVoo]); };
