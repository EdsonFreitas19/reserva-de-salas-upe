import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';

const app = buildApp();
const ADMIN = 'admin@teste.local', AUT = 'aut@teste.local', AUT2 = 'aut2@teste.local', OUTRA = 'outra@teste.local';
const A = 'a@teste.local', B = 'b@teste.local';
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
let ambienteId: number;      // "Sala Teste": responsáveis AUT e AUT2
let outroAmbienteId: number; // responsável OUTRA

async function criarUsuario(email: string, papeis: string[]) {
  const r = await pool.query(`INSERT INTO usuario (nome, email, google_id) VALUES ($1,$1,$2) RETURNING id`, [email, `dev-${email}`]);
  ids[email] = r.rows[0].id;
  for (const p of papeis) await pool.query('INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1,$2)', [ids[email], p]);
  const login = await app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { email } });
  if (!login.cookies[0]) throw new Error('login falhou: ' + login.statusCode + ' ' + login.body);
  cookies[email] = `token=${login.cookies[0].value}`;
}
type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const call = (email: string, method: Metodo, url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[email] } });

// --- datas: sempre dias úteis futuros, no horário de Recife (UTC-3, sem horário de verão) ---
const hoje = () => new Date(Date.now() - 3 * 3600_000); // "relógio de parede" de Recife nos campos UTC
const diaUtil = (n: number) => { // n-ésimo dia útil depois de hoje, 'YYYY-MM-DD'
  let d = hoje(), c = 0;
  while (c < n) { d = new Date(d.getTime() + 86_400_000); if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) c++; }
  return d.toISOString().slice(0, 10);
};
const proximoSabado = () => {
  let d = hoje();
  do { d = new Date(d.getTime() + 86_400_000); } while (d.getUTCDay() !== 6);
  return d.toISOString().slice(0, 10);
};
const iso = (dia: string, h: number) => `${dia}T${String(h).padStart(2, '0')}:00:00-03:00`;
const isoDow = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay(); // 1..5 em dia útil

const pedirEm = (amb: number, email: string, n: number, ini: number, fim: number, finalidade = 'Aula de teste') =>
  call(email, 'POST', '/api/reservas', { ambiente_id: amb, inicio: iso(diaUtil(n), ini), fim: iso(diaUtil(n), fim), finalidade });
const pedir = (email: string, n: number, ini: number, fim: number, finalidade?: string) => pedirEm(ambienteId, email, n, ini, fim, finalidade);
const aprovar = (email: string, id: number) => call(email, 'POST', `/api/reservas/${id}/aprovar`);
const notifs = async (email: string) => (await call(email, 'GET', '/api/notificacoes')).json() as { mensagem: string }[];
const statusDe = async (id: number) => (await pool.query('SELECT status FROM reserva WHERE id = $1', [id])).rows[0].status as string;
async function novoAmbiente(nome: string, responsaveis: string[] = []) {
  const r = await call(ADMIN, 'POST', '/api/ambientes', { nome, tipo: 'Sala de aula' });
  expect(r.statusCode).toBe(201);
  for (const e of responsaveis) expect((await call(ADMIN, 'POST', `/api/ambientes/${r.json().id}/autoridades`, { email: e })).statusCode).toBe(201);
  return r.json().id as number;
}

beforeAll(async () => {
  await migrate();
  await criarUsuario(ADMIN, ['USUARIO', 'ADMIN']);
  await criarUsuario(AUT, ['USUARIO', 'AUTORIDADE']);
  await criarUsuario(AUT2, ['USUARIO', 'AUTORIDADE']);
  await criarUsuario(OUTRA, ['USUARIO', 'AUTORIDADE']);
  await criarUsuario(A, ['USUARIO']);
  await criarUsuario(B, ['USUARIO']);
  ambienteId = (await pool.query("INSERT INTO ambiente (nome, tipo) VALUES ('Sala Teste','Sala de aula') RETURNING id")).rows[0].id;
  outroAmbienteId = (await pool.query("INSERT INTO ambiente (nome, tipo) VALUES ('Outra Sala','Sala de aula') RETURNING id")).rows[0].id;
  for (const u of [AUT, AUT2]) await pool.query('INSERT INTO ambiente_autoridade (ambiente_id, usuario_id) VALUES ($1,$2)', [ambienteId, ids[u]]);
  await pool.query('INSERT INTO ambiente_autoridade (ambiente_id, usuario_id) VALUES ($1,$2)', [outroAmbienteId, ids[OUTRA]]);
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('regras de reserva', () => {
  it('exige login', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/ambientes' })).statusCode).toBe(401);
  });

  it('valida horário: fim depois do início, máximo de 4 horas, mesmo dia, só dias úteis', async () => {
    expect((await pedir(A, 4, 12, 10)).statusCode).toBe(400);
    const longa = await pedir(A, 4, 8, 13); // 5 horas
    expect(longa.statusCode).toBe(400);
    expect(longa.json().erro).toMatch(/4 horas/);
    expect((await pedir(A, 4, 8, 12)).statusCode).toBe(201); // exatamente 4 horas é permitido

    const sab = proximoSabado();
    const fds = await call(A, 'POST', '/api/reservas', { ambiente_id: ambienteId, inicio: iso(sab, 8), fim: iso(sab, 10), finalidade: 'Sábado' });
    expect(fds.statusCode).toBe(400);
    expect(fds.json().erro).toMatch(/segunda a sexta/);

    const d = diaUtil(4), d2 = diaUtil(5);
    const viraDia = await call(A, 'POST', '/api/reservas', { ambiente_id: ambienteId, inicio: iso(d, 22), fim: `${d2}T01:00:00-03:00`, finalidade: 'Vira o dia' });
    expect(viraDia.statusCode).toBe(400);
    expect(viraDia.json().erro).toMatch(/mesmo dia/);
  });

  it('fluxo: solicita → responsável aprova → notifica → histórico; conflito e "encostada"', async () => {
    const id = (await pedir(A, 2, 8, 10)).json().id;
    expect((await aprovar(B, id)).statusCode).toBe(403);     // usuário comum
    expect((await aprovar(OUTRA, id)).statusCode).toBe(403); // responsável de outro ambiente
    expect((await call(AUT, 'POST', `/api/reservas/${id}/recusar`, { justificativa: '' })).statusCode).toBe(400); // RN07
    expect((await aprovar(AUT, id)).statusCode).toBe(200);
    expect((await aprovar(AUT, id)).statusCode).toBe(409); // já decidida

    expect((await notifs(A)).some((n) => n.mensagem.includes('APROVADA'))).toBe(true);
    const hist = (await call(A, 'GET', `/api/reservas/${id}/historico`)).json();
    expect(hist.map((h: { status_novo: string }) => h.status_novo)).toEqual(['PENDENTE', 'APROVADA']);

    expect((await pedir(B, 2, 9, 11)).statusCode).toBe(409);  // em cima do aprovado
    expect((await pedir(B, 2, 10, 12)).statusCode).toBe(201); // fim de uma = início da outra não conflita
  });

  it('vários responsáveis: todos são avisados, qualquer um aprova e basta um', async () => {
    const id = (await pedir(A, 3, 8, 10)).json().id;
    expect((await notifs(AUT)).some((n) => n.mensagem.includes('Nova solicitação'))).toBe(true);
    expect((await notifs(AUT2)).some((n) => n.mensagem.includes('Nova solicitação'))).toBe(true);
    expect((await aprovar(AUT2, id)).statusCode).toBe(200);

    const id2 = (await pedir(A, 3, 13, 15)).json().id; // dois responsáveis clicam ao mesmo tempo
    const r = await Promise.all([aprovar(AUT, id2), aprovar(AUT2, id2)]);
    expect(r.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    expect(await statusDe(id2)).toBe('APROVADA');
  });

  it('RN11: cancelada não volta a ficar pendente; o solicitante cancela só a própria', async () => {
    const id = (await pedir(A, 5, 8, 9)).json().id;
    expect((await call(B, 'POST', `/api/reservas/${id}/cancelar`)).statusCode).toBe(403);
    expect((await call(A, 'POST', `/api/reservas/${id}/cancelar`)).statusCode).toBe(200);
    expect((await aprovar(AUT, id)).statusCode).toBe(409);
    const { rows } = await pool.query('SELECT cancelado_por_id FROM reserva WHERE id = $1', [id]);
    expect(rows[0].cancelado_por_id).toBe(ids[A]);
  });

  it('auto-recusa: ao aprovar, as pendentes que colidem são recusadas com aviso; as outras ficam', async () => {
    const x = (await pedir(A, 7, 8, 10)).json().id;
    const y = (await pedir(B, 7, 9, 11)).json().id;   // colide com x
    const z = (await pedir(A, 7, 12, 14)).json().id;  // não colide
    expect((await aprovar(AUT, x)).statusCode).toBe(200);
    expect(await statusDe(y)).toBe('RECUSADA');
    expect(await statusDe(z)).toBe('PENDENTE');
    expect((await notifs(B)).some((n) => n.mensagem.includes('RECUSADA automaticamente'))).toBe(true);
    const hist = (await call(B, 'GET', `/api/reservas/${y}/historico`)).json();
    expect(hist.at(-1).status_novo).toBe('RECUSADA');
    expect(hist.at(-1).motivo).toMatch(/automaticamente/);
    expect((await aprovar(AUT, y)).statusCode).toBe(409); // já foi decidida
  });

  it('RNF04: 10 aprovações simultâneas do mesmo horário — só uma passa, sem erro 500', async () => {
    const ids10: number[] = [];
    for (let i = 0; i < 10; i++) ids10.push((await pedir(i % 2 ? A : B, 6, 8, 10, `Corrida ${i}`)).json().id);
    const res = await Promise.all(ids10.map((id, i) => aprovar(i % 2 ? AUT : AUT2, id)));
    const codes = res.map((r) => r.statusCode);
    expect(codes.every((c) => c === 200 || c === 409)).toBe(true);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    const { rows } = await pool.query('SELECT status, COUNT(*)::int AS n FROM reserva WHERE id = ANY($1) GROUP BY status', [ids10]);
    expect(Object.fromEntries(rows.map((r) => [r.status, r.n]))).toEqual({ APROVADA: 1, RECUSADA: 9 });
  });

  it('a constraint do banco recusa sobreposição mesmo sem passar pela aplicação', async () => {
    await expect(pool.query(
      `INSERT INTO reserva (ambiente_id, solicitante_id, inicio, fim, finalidade, status)
       SELECT ambiente_id, solicitante_id, inicio + interval '10 min', fim, 'burla', 'APROVADA' FROM reserva
        WHERE ambiente_id = $1 AND status = 'APROVADA' LIMIT 1`, [ambienteId]),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('o histórico é imutável', async () => {
    await expect(pool.query("UPDATE historico_status SET motivo = 'x'")).rejects.toThrow(/imutável/);
  });

  it('RN08: o admin NÃO aprova, recusa nem cancela; só consulta', async () => {
    const id = (await pedir(A, 8, 8, 10)).json().id;
    expect((await aprovar(ADMIN, id)).statusCode).toBe(403);
    expect((await call(ADMIN, 'POST', `/api/reservas/${id}/recusar`, { justificativa: 'não pode' })).statusCode).toBe(403);
    expect((await call(ADMIN, 'POST', `/api/reservas/${id}/cancelar-pela-autoridade`, { motivo: 'não pode' })).statusCode).toBe(403);
    expect((await call(ADMIN, 'GET', '/api/reservas/pendentes')).statusCode).toBe(403);
    expect((await call(ADMIN, 'GET', `/api/reservas/${id}/historico`)).statusCode).toBe(200);
    expect((await aprovar(AUT, id)).statusCode).toBe(200);
  });

  it('a autoridade cancela reserva aprovada (antes de começar) com motivo, e o solicitante é avisado', async () => {
    const id = (await pedir(A, 9, 8, 10)).json().id;
    await aprovar(AUT2, id);
    const url = `/api/reservas/${id}/cancelar-pela-autoridade`;

    expect((await call(AUT, 'POST', url, { motivo: '' })).statusCode).toBe(400);            // motivo obrigatório
    expect((await call(B, 'POST', url, { motivo: 'teste' })).statusCode).toBe(403);         // usuário comum
    expect((await call(OUTRA, 'POST', url, { motivo: 'teste' })).statusCode).toBe(403);     // responsável de outro ambiente
    expect((await call(AUT, 'POST', url, { motivo: 'Laboratório em manutenção' })).statusCode).toBe(200);
    expect((await call(AUT, 'POST', url, { motivo: 'de novo' })).statusCode).toBe(409);     // já cancelada

    expect(await statusDe(id)).toBe('CANCELADA');
    const n = (await notifs(A)).find((x) => x.mensagem.includes('CANCELADA'));
    expect(n?.mensagem).toMatch(/Laboratório em manutenção/);
    const minha = (await call(A, 'GET', '/api/reservas/minhas')).json().find((r: { id: number }) => r.id === id);
    expect(minha).toMatchObject({ status: 'CANCELADA', cancelada_pela_autoridade: true, motivo_cancelamento: 'Laboratório em manutenção', cancelado_por_nome: AUT });
    const hist = (await call(A, 'GET', `/api/reservas/${id}/historico`)).json();
    expect(hist.at(-1)).toMatchObject({ status_novo: 'CANCELADA', motivo: 'Laboratório em manutenção' });

    // horário liberado: dá para reservar de novo
    expect((await pedir(B, 9, 8, 10)).statusCode).toBe(201);
  });

  it('cancelamento pela autoridade: pendente deve ser recusada; reserva que já começou não cancela', async () => {
    const pend = (await pedir(A, 10, 8, 9)).json().id;
    const r = await call(AUT, 'POST', `/api/reservas/${pend}/cancelar-pela-autoridade`, { motivo: 'teste' });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toMatch(/Recusar/);

    const ini = await pool.query(
      `INSERT INTO reserva (ambiente_id, solicitante_id, inicio, fim, finalidade, status)
       VALUES ($1,$2, now() - interval '1 hour', now() + interval '1 hour', 'Em andamento', 'APROVADA') RETURNING id`, [ambienteId, ids[A]]);
    const andamento = await call(AUT, 'POST', `/api/reservas/${ini.rows[0].id}/cancelar-pela-autoridade`, { motivo: 'teste' });
    expect(andamento.statusCode).toBe(409);
    expect(andamento.json().erro).toMatch(/já começou/);
  });

  it('a autoridade lista só as aprovadas futuras dos seus ambientes', async () => {
    const id = (await pedir(A, 11, 8, 10)).json().id;
    await aprovar(AUT, id);
    const lista = (await call(AUT2, 'GET', '/api/reservas/aprovadas')).json() as { id: number; finalidade: string }[];
    expect(lista.some((r) => r.id === id)).toBe(true);
    expect(lista.some((r) => r.finalidade === 'Em andamento')).toBe(false); // já começou
    expect((await call(OUTRA, 'GET', '/api/reservas/aprovadas')).json()).toHaveLength(0);
    expect((await call(A, 'GET', '/api/reservas/aprovadas')).statusCode).toBe(403);
  });

  it('pendentes: cada responsável vê as do seu ambiente; usuário e admin não', async () => {
    await pedir(A, 12, 8, 9);
    expect((await call(AUT, 'GET', '/api/reservas/pendentes')).json().length).toBeGreaterThan(0);
    expect((await call(AUT2, 'GET', '/api/reservas/pendentes')).json().length).toBeGreaterThan(0);
    expect((await call(OUTRA, 'GET', '/api/reservas/pendentes')).json()).toHaveLength(0);
    expect((await call(A, 'GET', '/api/reservas/pendentes')).statusCode).toBe(403);
    expect((await call(A, 'GET', '/api/reservas')).statusCode).toBe(403);
    expect((await call(ADMIN, 'GET', '/api/reservas')).statusCode).toBe(200);
  });
});

describe('lista de usuários do admin', () => {
  it('admin cadastra e remove usuário pela tela (arquivo da lista)', async () => {
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { config } = await import('../src/config.js');
    const antes = config.authorizedEmailsFile;
    config.authorizedEmailsFile = join(mkdtempSync(join(tmpdir(), 'lista-')), 'emails.txt');
    try {
      expect((await call(A, 'POST', '/api/usuarios', { email: 'novo@upe.br' })).statusCode).toBe(403);
      expect((await call(ADMIN, 'POST', '/api/usuarios', { email: 'ruim' })).statusCode).toBe(400);
      expect((await call(ADMIN, 'POST', '/api/usuarios', { email: 'Novo.Prof@upe.br', nome: 'Novo Professor' })).statusCode).toBe(201);
      expect(readFileSync(config.authorizedEmailsFile, 'utf8')).toContain('novo.prof@upe.br');
      const u = (await call(ADMIN, 'GET', '/api/usuarios')).json().find((x: { email: string }) => x.email === 'novo.prof@upe.br');
      expect(u.nome).toBe('Novo Professor');
      expect((await call(ADMIN, 'POST', '/api/usuarios', { email: 'novo.prof@upe.br' })).statusCode).toBe(409);
      expect((await call(ADMIN, 'DELETE', `/api/usuarios/${ids[ADMIN]}`)).statusCode).toBe(400);
      expect((await call(ADMIN, 'DELETE', `/api/usuarios/${u.id}`)).statusCode).toBe(200);
      expect(readFileSync(config.authorizedEmailsFile, 'utf8')).not.toContain('novo.prof');
      expect((await call(ADMIN, 'GET', '/api/usuarios')).json().some((x: { email: string }) => x.email === 'novo.prof@upe.br')).toBe(false);
    } finally { config.authorizedEmailsFile = antes; }
  });

  it('mostra os ambientes de cada usuário e só o admin acessa', async () => {
    expect((await call(A, 'GET', '/api/usuarios')).statusCode).toBe(403);
    const lista = (await call(ADMIN, 'GET', '/api/usuarios')).json() as { email: string; responsavel_por: unknown[] }[];
    expect(lista.find((u) => u.email === AUT)!.responsavel_por.length).toBeGreaterThan(0);
    expect(lista.find((u) => u.email === A)!.responsavel_por).toHaveLength(0);
  });
});

describe('responsáveis (vários por ambiente)', () => {
  it('admin adiciona e remove responsáveis por e-mail, inclusive quem nunca entrou', async () => {
    const amb = await novoAmbiente('Sala Vários');
    const url = `/api/ambientes/${amb}/autoridades`;
    expect((await call(A, 'POST', url, { email: A })).statusCode).toBe(403);
    expect((await call(ADMIN, 'POST', url, { email: 'nao-e-email' })).statusCode).toBe(400);
    expect((await call(ADMIN, 'POST', url, { email: 'alguem@gmail.com' })).statusCode).toBe(400); // fora do domínio

    expect((await call(ADMIN, 'POST', url, { email: 'Novo.Responsavel@upe.br' })).statusCode).toBe(201); // pré-cadastro
    const u = await pool.query("SELECT id, nome, google_id FROM usuario WHERE email = 'novo.responsavel@upe.br'");
    expect(u.rows[0]).toMatchObject({ google_id: 'pre-novo.responsavel@upe.br', nome: 'Novo Responsavel' });
    const papeis = await pool.query('SELECT papel FROM usuario_papel WHERE usuario_id = $1 ORDER BY papel', [u.rows[0].id]);
    expect(papeis.rows.map((r) => r.papel)).toEqual(['USUARIO', 'AUTORIDADE']);

    expect((await call(ADMIN, 'POST', url, { email: ADMIN })).statusCode).toBe(400);    // admin não pode ser responsável
    expect((await call(ADMIN, 'POST', url, { usuario_id: ids[AUT] })).statusCode).toBe(201); // por id (tela Usuários)
    expect((await call(ADMIN, 'POST', url, { usuario_id: ids[AUT] })).statusCode).toBe(409);
    await call(ADMIN, 'DELETE', `${url}/${ids[AUT]}`);
    expect((await call(ADMIN, 'POST', url, { email: AUT })).statusCode).toBe(201);      // segundo responsável
    expect((await call(ADMIN, 'POST', url, { email: AUT })).statusCode).toBe(409);      // repetido
    const lista = (await call(A, 'GET', '/api/ambientes')).json().find((x: { id: number }) => x.id === amb);
    expect(lista.autoridades.map((x: { email: string }) => x.email).sort()).toEqual([AUT, 'novo.responsavel@upe.br']);

    expect((await call(A, 'DELETE', `${url}/${u.rows[0].id}`)).statusCode).toBe(403);
    expect((await call(ADMIN, 'DELETE', `${url}/${u.rows[0].id}`)).statusCode).toBe(200);
    expect((await call(ADMIN, 'DELETE', `${url}/${u.rows[0].id}`)).statusCode).toBe(404);
    const sem = await pool.query("SELECT 1 FROM usuario_papel WHERE usuario_id = $1 AND papel = 'AUTORIDADE'", [u.rows[0].id]);
    expect(sem.rowCount).toBe(0); // não é responsável de mais nenhum ambiente
    const mantem = await pool.query("SELECT 1 FROM usuario_papel WHERE usuario_id = $1 AND papel = 'AUTORIDADE'", [ids[AUT]]);
    expect(mantem.rowCount).toBe(1); // AUT segue responsável por outros ambientes
  });

  it('ambiente sem responsável não aceita solicitações (o admin não aprova, ficaria parado)', async () => {
    const amb = await novoAmbiente('Sala Sem Responsável');
    const r = await pedirEm(amb, A, 13, 8, 9);
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toMatch(/responsável/);
  });
});

describe('horários ocupados (aulas fixas, definidos pelo admin)', () => {
  it('bloqueia solicitações no horário ocupado e aparece na agenda', async () => {
    const lab = await novoAmbiente('Lab Aulas', [AUT]);
    const dia = diaUtil(14);
    const corpo = { descricao: 'Aula de Banco de Dados', dias_semana: [isoDow(dia)], hora_inicio: '08:00', hora_fim: '10:00', data_inicio: dia, data_fim: dia };
    const url = `/api/ambientes/${lab}/bloqueios`;

    expect((await call(A, 'POST', url, corpo)).statusCode).toBe(403);
    expect((await call(ADMIN, 'POST', url, { ...corpo, dias_semana: [6] })).statusCode).toBe(400);      // fim de semana
    expect((await call(ADMIN, 'POST', url, { ...corpo, hora_fim: '07:00' })).statusCode).toBe(400);     // fim antes do início
    const criado = await call(ADMIN, 'POST', url, corpo);
    expect(criado.statusCode).toBe(201);
    expect(criado.json().conflitos).toBe(0);

    // agenda: a ocorrência aparece com data e hora reais
    const de = encodeURIComponent(iso(dia, 0)), ate = encodeURIComponent(iso(dia, 23));
    const ag = (await call(A, 'GET', `${url}?de=${de}&ate=${ate}`)).json();
    expect(ag).toHaveLength(1);
    expect(new Date(ag[0].inicio).toISOString()).toBe(`${dia}T11:00:00.000Z`); // 08:00 em Recife
    expect(ag[0].descricao).toBe('Aula de Banco de Dados');

    const dia14 = (ini: number, fim: number) => pedirEm(lab, A, 14, ini, fim);
    const barrada = await dia14(9, 11);
    expect(barrada.statusCode).toBe(409);
    expect(barrada.json().erro).toMatch(/Aula de Banco de Dados/);
    expect((await dia14(8, 10)).statusCode).toBe(409);
    expect((await dia14(10, 12)).statusCode).toBe(201);                   // encostada no fim da aula
    expect((await pedirEm(ambienteId, A, 14, 8, 10)).statusCode).toBe(201); // outro ambiente não é afetado

    // remover o horário ocupado libera de novo
    const regras = (await call(ADMIN, 'GET', `${url}/regras`)).json();
    expect(regras).toHaveLength(1);
    expect((await call(ADMIN, 'DELETE', `${url}/${regras[0].id}`)).statusCode).toBe(200);
    expect((await dia14(8, 10)).statusCode).toBe(201);
  });

  it('avisa se já existem reservas no horário; a aprovação dessas fica impedida', async () => {
    const lab = await novoAmbiente('Lab Conflito', [AUT]);
    const dia = diaUtil(15);
    const pend = (await pedirEm(lab, A, 15, 14, 16)).json().id;
    const criado = await call(ADMIN, 'POST', `/api/ambientes/${lab}/bloqueios`, {
      descricao: 'Manutenção', dias_semana: [isoDow(dia)], hora_inicio: '14:00', hora_fim: '15:00', data_inicio: dia, data_fim: dia });
    expect(criado.json().conflitos).toBe(1);
    const r = await aprovar(AUT, pend);
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toMatch(/ocupado/);
    expect(await statusDe(pend)).toBe('PENDENTE'); // segue pendente: a autoridade deve recusar
  });
});

describe('excluir ambiente', () => {
  it('admin exclui ambiente sem reservas (horários e responsabilidades saem junto); só admin exclui', async () => {
    const amb = await novoAmbiente('Sala Descartável', [OUTRA]);
    const dia = diaUtil(16);
    await call(ADMIN, 'POST', `/api/ambientes/${amb}/bloqueios`, {
      descricao: 'Aula', dias_semana: [isoDow(dia)], hora_inicio: '08:00', hora_fim: '09:00', data_inicio: dia, data_fim: dia });

    expect((await call(A, 'DELETE', `/api/ambientes/${amb}`)).statusCode).toBe(403);
    expect((await call(AUT, 'DELETE', `/api/ambientes/${amb}`)).statusCode).toBe(403);
    expect((await call(ADMIN, 'DELETE', `/api/ambientes/${amb}`)).statusCode).toBe(200);
    const resto = await pool.query(
      `SELECT (SELECT COUNT(*) FROM ambiente WHERE id = $1)::int AS amb, (SELECT COUNT(*) FROM bloqueio WHERE ambiente_id = $1)::int AS blq,
              (SELECT COUNT(*) FROM ambiente_autoridade WHERE ambiente_id = $1)::int AS aut`, [amb]);
    expect(resto.rows[0]).toEqual({ amb: 0, blq: 0, aut: 0 });
    expect((await call(ADMIN, 'DELETE', `/api/ambientes/${amb}`)).statusCode).toBe(404);
    // OUTRA continua responsável por "Outra Sala", então mantém o papel
    const papel = await pool.query("SELECT 1 FROM usuario_papel WHERE usuario_id = $1 AND papel = 'AUTORIDADE'", [ids[OUTRA]]);
    expect(papel.rowCount).toBe(1);
  });

  it('ambiente com histórico pode ser renomeado e excluído; o histórico guarda o nome antigo', async () => {
    const amb = await novoAmbiente('Sala Antiga', [AUT]);
    const id = (await pedirEm(amb, A, 50, 9, 10)).json().id;
    const del = await call(ADMIN, 'DELETE', `/api/ambientes/${amb}`);
    expect(del.statusCode).toBe(409);                       // reserva futura pendente impede a exclusão
    expect((await call(AUT, 'POST', `/api/reservas/${id}/recusar`, { justificativa: 'teste' })).statusCode).toBe(200);
    expect((await call(ADMIN, 'PATCH', `/api/ambientes/${amb}`, { nome: 'Sala Nova', tipo: 'Sala de aula' })).statusCode).toBe(200);
    const nome = async () => (await pool.query('SELECT ambiente_nome, ambiente_id FROM reserva WHERE id = $1', [id])).rows[0];
    expect((await nome()).ambiente_nome).toBe('Sala Antiga');   // recusada = histórico: mantém o nome da época
    expect((await call(ADMIN, 'DELETE', `/api/ambientes/${amb}`)).statusCode).toBe(200);
    expect(await nome()).toEqual({ ambiente_nome: 'Sala Antiga', ambiente_id: null });
    const lista = (await call(A, 'GET', '/api/reservas/minhas')).json() as { id: number; ambiente_nome: string }[];
    expect(lista.find((x) => x.id === id)!.ambiente_nome).toBe('Sala Antiga');
  });
});

describe('usuário que também é responsável (autoridade)', () => {
  it('/api/me lista os ambientes pelos quais a pessoa é responsável; quem não é, recebe lista vazia', async () => {
    const resp = await call(AUT, 'GET', '/api/me');
    expect(resp.json().papeis).toEqual(expect.arrayContaining(['USUARIO', 'AUTORIDADE']));
    expect(resp.json().responsavelPor.map((a: { id: number }) => a.id)).toContain(ambienteId);
    const comum = await call(A, 'GET', '/api/me');
    expect(comum.json().responsavelPor).toEqual([]);
  });
});

describe('área do responsável: horários ocupados e diretório de usuários', () => {
  const dia = diaUtil(40);
  const corpo = () => ({ descricao: 'Aula do responsável', dias_semana: [isoDow(dia)], hora_inicio: '16:00', hora_fim: '17:00', data_inicio: dia, data_fim: dia });
  let bloqueioId: number;

  it('o responsável cadastra, lista e remove horários ocupados da PRÓPRIA sala', async () => {
    const criar = await call(AUT, 'POST', `/api/ambientes/${ambienteId}/bloqueios`, corpo());
    expect(criar.statusCode).toBe(201);
    bloqueioId = criar.json().id;
    const lista = await call(AUT, 'GET', `/api/ambientes/${ambienteId}/bloqueios/regras`);
    expect(lista.json().some((b: { id: number }) => b.id === bloqueioId)).toBe(true);
    const remover = await call(AUT, 'DELETE', `/api/ambientes/${ambienteId}/bloqueios/${bloqueioId}`);
    expect(remover.statusCode).toBe(200);
  });

  it('não mexe em sala de outro responsável nem como usuário comum; o admin continua podendo', async () => {
    expect((await call(AUT, 'POST', `/api/ambientes/${outroAmbienteId}/bloqueios`, corpo())).statusCode).toBe(403); // não é responsável dessa
    expect((await call(A, 'POST', `/api/ambientes/${ambienteId}/bloqueios`, corpo())).statusCode).toBe(403);       // usuário comum
    expect((await call(A, 'GET', `/api/ambientes/${ambienteId}/bloqueios/regras`)).statusCode).toBe(403);
    const adm = await call(ADMIN, 'POST', `/api/ambientes/${ambienteId}/bloqueios`, corpo());
    expect(adm.statusCode).toBe(201);
    await call(ADMIN, 'DELETE', `/api/ambientes/${ambienteId}/bloqueios/${adm.json().id}`);
  });

  it('o responsável não apaga horário de outra sala usando o id da própria', async () => {
    const outro = await call(OUTRA, 'POST', `/api/ambientes/${outroAmbienteId}/bloqueios`, corpo());
    expect(outro.statusCode).toBe(201);
    const tentativa = await call(AUT, 'DELETE', `/api/ambientes/${ambienteId}/bloqueios/${outro.json().id}`);
    expect(tentativa.statusCode).toBe(404);
    await call(OUTRA, 'DELETE', `/api/ambientes/${outroAmbienteId}/bloqueios/${outro.json().id}`);
  });

  it('diretório de usuários: só para responsável (ou admin), com a contagem de reservas nas salas de quem consulta', async () => {
    expect((await call(A, 'GET', '/api/usuarios/diretorio')).statusCode).toBe(403);
    await call(ADMIN, 'PATCH', `/api/ambientes/${ambienteId}`, { nome: 'Sala Teste', tipo: 'Sala de aula', ativo: true }); // o teste anterior a desativou
    const sol = await call(B, 'POST', '/api/reservas', { ambiente_id: ambienteId, inicio: iso(diaUtil(41), 9), fim: iso(diaUtil(41), 10), finalidade: 'Contagem no diretório' });
    expect(sol.statusCode).toBe(201);
    const dir = await call(AUT, 'GET', '/api/usuarios/diretorio');
    expect(dir.statusCode).toBe(200);
    const linhaB = dir.json().find((u: { email: string }) => u.email === B);
    expect(linhaB.pendentes_nas_minhas_salas).toBeGreaterThanOrEqual(1);
    const linhaAut = dir.json().find((u: { email: string }) => u.email === AUT);
    expect(linhaAut.responsavel_por).toContain('Sala Teste');
    expect((await call(ADMIN, 'GET', '/api/usuarios/diretorio')).statusCode).toBe(200);
    await call(B, 'POST', `/api/reservas/${sol.json().id}/cancelar`);
  });
});
