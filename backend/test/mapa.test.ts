import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';

const app = buildApp();
const ADM = 'mapa-adm@teste.local', USR = 'mapa-usr@teste.local';
const cookies: Record<string, string> = {};
async function criar(email: string, papeis: string[]) {
  const r = await pool.query(`INSERT INTO usuario (nome, email, google_id) VALUES ($1,$1,$2) RETURNING id`, [email, `dev-${email}`]);
  for (const p of papeis) await pool.query('INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1,$2)', [r.rows[0].id, p]);
  const login = await app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { email } });
  cookies[email] = `token=${login.cookies[0].value}`;
}
const call = (email: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { cookie: cookies[email] } });
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const enviarFoto = (email: string, amb: number, corpo: Buffer, tipo = 'image/png') =>
  app.inject({ method: 'POST', url: `/api/ambientes/${amb}/fotos`, payload: corpo, headers: { cookie: cookies[email], 'content-type': tipo } });
const ret = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

let amb: number, amb2: number;
beforeAll(async () => {
  await migrate(); await app.ready();
  await criar(ADM, ['USUARIO', 'ADMIN']); await criar(USR, ['USUARIO']);
  amb = (await call(ADM, 'POST', '/api/ambientes', { nome: 'Sala Mapa', tipo: 'Sala de aula' })).json().id;
  amb2 = (await call(ADM, 'POST', '/api/ambientes', { nome: 'Sala Mapa 2', tipo: 'Sala de aula' })).json().id;
});
afterAll(() => rmSync(config.uploadsDir, { recursive: true, force: true }));

describe('mapa 2D', () => {
  it('todos veem as 18 áreas padrão; só o admin edita', async () => {
    const m = (await call(USR, 'GET', '/api/mapa')).json();
    expect(m.areas.filter((a: { numero: number }) => a.numero >= 1 && a.numero <= 18).length).toBe(18);
    const corpo = { rotulo: 'Nova', tipo: 'Laboratório', pontos: ret(10, 10, 50, 50) };
    expect((await call(USR, 'POST', '/api/mapa/areas', corpo)).statusCode).toBe(403);
    expect((await call(ADM, 'POST', '/api/mapa/areas', { ...corpo, pontos: [[1, 1], [2, 2]] })).statusCode).toBe(400);
    expect((await call(ADM, 'POST', '/api/mapa/areas', { ...corpo, pontos: ret(10, 10, 5000, 50) })).statusCode).toBe(400);
    expect((await call(ADM, 'POST', '/api/mapa/areas', { ...corpo, tipo: 'Outro' })).statusCode).toBe(400);
  });

  it('admin cria, move, vincula, desvincula e remove uma área; um ambiente só pode estar em uma área', async () => {
    const criada = await call(ADM, 'POST', '/api/mapa/areas', { rotulo: 'Área X', tipo: 'Sala de aula', pontos: ret(10, 10, 50, 50), ambiente_id: amb });
    expect(criada.statusCode).toBe(201);
    const id = criada.json().id;
    const dup = await call(ADM, 'POST', '/api/mapa/areas', { rotulo: 'Área Y', tipo: 'Sala de aula', pontos: ret(70, 10, 50, 50), ambiente_id: amb });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toMatch(/Área X/);
    expect((await call(ADM, 'PUT', `/api/mapa/areas/${id}`, { rotulo: 'Área X', tipo: 'Sala de aula', pontos: ret(20, 20, 60, 60), ambiente_id: amb2 })).statusCode).toBe(200);
    const a = (await call(USR, 'GET', '/api/mapa')).json().areas.find((x: { id: number }) => x.id === id);
    expect(a.ambiente_id).toBe(amb2); expect(a.ambiente_nome).toBe('Sala Mapa 2'); expect(a.pontos[0]).toEqual([20, 20]);
    expect((await call(ADM, 'PUT', `/api/mapa/areas/${id}`, { rotulo: 'Área X', tipo: 'Sala de aula', pontos: ret(20, 20, 60, 60), ambiente_id: 999999 })).statusCode).toBe(404);
    expect((await call(ADM, 'PUT', `/api/mapa/areas/${id}`, { rotulo: 'Área X', tipo: 'Sala de aula', pontos: ret(20, 20, 60, 60), ambiente_id: null })).statusCode).toBe(200);
    expect((await call(USR, 'DELETE', `/api/mapa/areas/${id}`)).statusCode).toBe(403);
    expect((await call(ADM, 'DELETE', `/api/mapa/areas/${id}`)).statusCode).toBe(200);
    expect((await call(ADM, 'DELETE', `/api/mapa/areas/${id}`)).statusCode).toBe(404);
  });

  it('salvar o mapa em lote: move, troca ambientes entre áreas, cria ambiente, exclui e é tudo-ou-nada', async () => {
    const m0 = (await call(ADM, 'GET', '/api/mapa')).json().areas as { id: number; numero: number; rotulo: string; tipo: string; pontos: number[][]; ambiente_id: number | null }[];
    const corpo = (a: (typeof m0)[number]) => ({ id: a.id, numero: a.numero, rotulo: a.rotulo, tipo: a.tipo, pontos: a.pontos, ambiente_id: a.ambiente_id });
    const [x, y, z] = m0;
    // troca de ambientes entre x e y + move z + nova área que cria ambiente
    const novoAmb = (await call(ADM, 'POST', '/api/ambientes', { nome: 'Ambiente Troca', tipo: 'Sala de aula' })).json().id;
    await call(ADM, 'PUT', '/api/mapa', { areas: m0.map((a) => corpo(a)).map((a) => (a.id === x.id ? { ...a, ambiente_id: null } : a)) });
    const dep = (await call(ADM, 'PUT', '/api/mapa', {
      areas: [
        { ...corpo(x), ambiente_id: novoAmb }, { ...corpo(y), pontos: ret(500, 200, 40, 40) }, corpo(z),
        { rotulo: 'Área Criada Em Lote', tipo: 'Laboratório', pontos: ret(600, 200, 40, 40), criar_ambiente: true },
      ],
    }));
    expect(dep.statusCode).toBe(200);
    const m1 = dep.json().areas as { rotulo: string; ambiente_id: number | null; ambiente_nome: string | null; id: number; pontos: number[][] }[];
    expect(m1).toHaveLength(4);                                        // as outras áreas foram excluídas
    expect(m1.find((a) => a.id === x.id)!.ambiente_id).toBe(novoAmb);
    expect(m1.find((a) => a.id === y.id)!.pontos[0]).toEqual([500, 200]);
    expect(m1.find((a) => a.rotulo === 'Área Criada Em Lote')!.ambiente_nome).toBe('Área Criada Em Lote');
    // dois ambientes iguais => 409 e NADA muda
    const dup = await call(ADM, 'PUT', '/api/mapa', { areas: [{ ...corpo(x), ambiente_id: novoAmb }, { ...corpo(y), ambiente_id: novoAmb }] });
    expect(dup.statusCode).toBe(409);
    expect((await call(ADM, 'GET', '/api/mapa')).json().areas).toHaveLength(4);
    expect((await call(USR, 'PUT', '/api/mapa', { areas: [] })).statusCode).toBe(403);
    expect((await call(ADM, 'PUT', '/api/mapa', { areas: [{ ...corpo(x), id: 999999 }] })).statusCode).toBe(404);
    expect((await call(ADM, 'GET', '/api/mapa')).json().areas).toHaveLength(4);
    // devolve as áreas originais para os próximos testes
    await call(ADM, 'PUT', '/api/mapa', { areas: m0.map((a) => ({ ...corpo(a), ambiente_id: null })) });
  });

  it('recriar um ambiente com o mesmo nome religa a área do mapa que ficou sem vínculo', async () => {
    const aid = (await call(ADM, 'POST', '/api/mapa/areas', { rotulo: 'Banheiro Teste', tipo: 'Serviços', pontos: ret(10, 10, 50, 50) })).json().id;
    const criado = (await call(ADM, 'POST', '/api/ambientes', { nome: 'banheiro teste', tipo: 'Laboratório' })).json();
    expect(criado.area_ligada).toBe('Banheiro Teste');
    const a = (await call(USR, 'GET', '/api/mapa')).json().areas.find((x: { id: number }) => x.id === aid);
    expect(a.ambiente_id).toBe(criado.id); expect(a.tipo).toBe('Laboratório');
    // um segundo ambiente com o mesmo nome não toma a área (ela já tem ambiente)
    expect((await call(ADM, 'POST', '/api/ambientes', { nome: 'Banheiro Teste', tipo: 'Serviços' })).json().area_ligada).toBeNull();
    // renomear um ambiente para o nome de uma área solta também liga
    const aid2 = (await call(ADM, 'POST', '/api/mapa/areas', { rotulo: 'Sala Renomeada', tipo: 'Serviços', pontos: ret(70, 10, 50, 50) })).json().id;
    const outro = (await call(ADM, 'POST', '/api/ambientes', { nome: 'Qualquer Nome', tipo: 'Serviços' })).json().id;
    expect((await call(ADM, 'PATCH', `/api/ambientes/${outro}`, { nome: 'Sala Renomeada', tipo: 'Serviços' })).json().area_ligada).toBe('Sala Renomeada');
    expect((await call(USR, 'GET', '/api/mapa')).json().areas.find((x: { id: number }) => x.id === aid2).ambiente_id).toBe(outro);
  });

  it('excluir o ambiente deixa a área no mapa, sem vínculo', async () => {
    const id = (await call(ADM, 'POST', '/api/mapa/areas', { rotulo: 'Área Z', tipo: 'Serviços', pontos: ret(10, 10, 50, 50), ambiente_id: amb2 })).json().id;
    expect((await call(ADM, 'DELETE', `/api/ambientes/${amb2}`)).statusCode).toBe(200);
    const a = (await call(USR, 'GET', '/api/mapa')).json().areas.find((x: { id: number }) => x.id === id);
    expect(a.ambiente_id).toBeNull();
  });
});

describe('tipos de ambiente', () => {
  it('só admin gerencia; nome único; ambiente só aceita tipo do catálogo; renomear propaga; excluir em uso é bloqueado', async () => {
    const lista = (await call(USR, 'GET', '/api/tipos')).json() as { id: number; nome: string; cor: string }[];
    expect(lista.map((t) => t.nome)).toEqual(expect.arrayContaining(['Sala de aula', 'Laboratório', 'Administrativo', 'Espaço de uso comum', 'Serviços']));
    expect((await call(USR, 'POST', '/api/tipos', { nome: 'X', cor: '#112233' })).statusCode).toBe(403);
    expect((await call(ADM, 'POST', '/api/tipos', { nome: 'Pós-graduação', cor: 'vermelho' })).statusCode).toBe(400);
    const novo = await call(ADM, 'POST', '/api/tipos', { nome: 'Pós-graduação', cor: '#AABBCC' });
    expect(novo.statusCode).toBe(201);
    expect((await call(ADM, 'POST', '/api/tipos', { nome: 'pós-graduação', cor: '#aabbcc' })).statusCode).toBe(409);
    // ambiente: tipo livre é recusado; do catálogo é aceito
    expect((await call(ADM, 'POST', '/api/ambientes', { nome: 'Sala Livre', tipo: 'digitado qualquer' })).statusCode).toBe(400);
    const amb3 = (await call(ADM, 'POST', '/api/ambientes', { nome: 'Sala Pós', tipo: 'Pós-graduação' })).json().id;
    // o mapa mostra o tipo/cor do ambiente ligado
    const area = (await call(ADM, 'POST', '/api/mapa/areas', { rotulo: 'Área Pós', tipo: 'Serviços', pontos: ret(10, 10, 50, 50), ambiente_id: amb3 })).json().id;
    const m = (await call(USR, 'GET', '/api/mapa')).json();
    expect(m.areas.find((a: { id: number }) => a.id === area).tipo).toBe('Pós-graduação');
    expect(m.tipos.find((t: { nome: string }) => t.nome === 'Pós-graduação').cor).toBe('#aabbcc');
    // mudar o tipo do ambiente muda também o tipo guardado na área (senão o tipo antigo ficaria "em uso" para sempre)
    expect((await call(ADM, 'PATCH', `/api/ambientes/${amb3}`, { nome: 'Sala Pós', tipo: 'Serviços' })).statusCode).toBe(200);
    expect((await pool.query('SELECT tipo FROM mapa_area WHERE id = $1', [area])).rows[0].tipo).toBe('Serviços');
    expect((await call(ADM, 'PATCH', `/api/ambientes/${amb3}`, { nome: 'Sala Pós', tipo: 'Pós-graduação' })).statusCode).toBe(200);
    // renomear propaga; excluir em uso é bloqueado
    expect((await call(ADM, 'PATCH', `/api/tipos/${novo.json().id}`, { nome: 'Pós', cor: '#aabbcc' })).statusCode).toBe(200);
    expect((await pool.query('SELECT tipo FROM ambiente WHERE id = $1', [amb3])).rows[0].tipo).toBe('Pós');
    expect((await call(ADM, 'DELETE', `/api/tipos/${novo.json().id}`)).statusCode).toBe(409);
    // salvar o mapa em lote com outro tipo na área muda o tipo do ambiente ligado
    const areas = (await call(ADM, 'GET', '/api/mapa')).json().areas as { id: number; numero: number | null; rotulo: string; tipo: string; pontos: number[][]; ambiente_id: number | null }[];
    const corpo = areas.map((a) => ({ id: a.id, numero: a.numero, rotulo: a.rotulo, tipo: a.id === area ? 'Laboratório' : a.tipo, pontos: a.pontos, ambiente_id: a.ambiente_id }));
    expect((await call(ADM, 'PUT', '/api/mapa', { areas: corpo })).statusCode).toBe(200);
    expect((await pool.query('SELECT tipo FROM ambiente WHERE id = $1', [amb3])).rows[0].tipo).toBe('Laboratório');
    expect((await call(ADM, 'PUT', '/api/mapa', { areas: corpo.map((a) => ({ ...a, tipo: 'Inexistente' })) })).statusCode).toBe(400);
    // agora ninguém usa "Pós": excluir funciona
    await call(ADM, 'DELETE', `/api/mapa/areas/${area}`);
    expect((await call(ADM, 'DELETE', `/api/tipos/${novo.json().id}`)).statusCode).toBe(200);
    expect((await call(ADM, 'DELETE', `/api/tipos/${novo.json().id}`)).statusCode).toBe(404);
    // "Sem tipo" existe, aceita ambiente, e não pode ser excluído nem renomeado
    const sem = (await call(ADM, 'GET', '/api/tipos')).json().find((t: { nome: string }) => t.nome === 'Sem tipo');
    expect(sem).toBeTruthy();
    expect((await call(ADM, 'DELETE', `/api/tipos/${sem.id}`)).statusCode).toBe(400);
    expect((await call(ADM, 'PATCH', `/api/tipos/${sem.id}`, { nome: 'Outro', cor: '#ffffff' })).statusCode).toBe(400);
  });

  it('áreas do desenho original: /padrao lista as 18', async () => {
    expect((await call(USR, 'GET', '/api/mapa/padrao')).statusCode).toBe(403);
    expect((await call(ADM, 'GET', '/api/mapa/padrao')).json()).toHaveLength(18);
  });
});

describe('fotos dos ambientes', () => {
  it('admin envia, todos veem, admin remove; valida o tipo e o tamanho', async () => {
    expect((await enviarFoto(USR, amb, png)).statusCode).toBe(403);
    expect((await enviarFoto(ADM, amb, Buffer.from('isto nao e imagem, mas diz que e'), 'image/png')).statusCode).toBe(400);
    expect((await enviarFoto(ADM, 999999, png)).statusCode).toBe(404);
    expect((await enviarFoto(ADM, amb, Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)]))).statusCode).toBe(413);
    const ok = await enviarFoto(ADM, amb, png);
    expect(ok.statusCode).toBe(201);
    const lista = (await call(USR, 'GET', `/api/ambientes/${amb}/fotos`)).json();
    expect(lista).toHaveLength(1);
    const img = await call(USR, 'GET', `/api/fotos/${lista[0].id}`);
    expect(img.statusCode).toBe(200); expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.equals(png)).toBe(true);
    const arq = (await pool.query('SELECT arquivo FROM ambiente_foto WHERE id = $1', [lista[0].id])).rows[0].arquivo;
    expect(existsSync(join(config.uploadsDir, arq))).toBe(true);
    expect((await call(USR, 'DELETE', `/api/fotos/${lista[0].id}`)).statusCode).toBe(403);
    expect((await call(ADM, 'DELETE', `/api/fotos/${lista[0].id}`)).statusCode).toBe(200);
    expect(existsSync(join(config.uploadsDir, arq))).toBe(false);
    expect((await call(ADM, 'DELETE', `/api/fotos/${lista[0].id}`)).statusCode).toBe(404);
  });

  it('limite de 10 fotos por ambiente; excluir o ambiente apaga os arquivos', async () => {
    for (let i = 0; i < 10; i++) expect((await enviarFoto(ADM, amb, png)).statusCode).toBe(201);
    expect((await enviarFoto(ADM, amb, png)).statusCode).toBe(409);
    const arqs = (await pool.query('SELECT arquivo FROM ambiente_foto WHERE ambiente_id = $1', [amb])).rows.map((r) => r.arquivo);
    expect((await call(ADM, 'DELETE', `/api/ambientes/${amb}`)).statusCode).toBe(200);
    expect(arqs.every((a: string) => !existsSync(join(config.uploadsDir, a)))).toBe(true);
    expect((await pool.query('SELECT 1 FROM ambiente_foto WHERE ambiente_id = $1', [amb])).rowCount).toBe(0);
  });
});
