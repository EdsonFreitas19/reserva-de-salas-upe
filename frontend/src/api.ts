export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { erro?: string }).erro ?? `Erro ${res.status}`);
  return data as T;
}

/** Envia um arquivo binário (foto) como corpo da requisição. */
export async function apiUpload<T = unknown>(url: string, blob: Blob): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { erro?: string }).erro ?? `Erro ${res.status}`);
  return data as T;
}

export interface MapaArea {
  id: number; numero: number | null; rotulo: string; tipo: string; pontos: [number, number][];
  ambiente_id: number | null; ambiente_nome: string | null; ambiente_ativo: boolean | null; fotos: number;
  criar_ambiente?: boolean; // só no rascunho do editor: cria o ambiente ao salvar
}
export interface MapaDados { largura: number; altura: number; tipos: { nome: string; cor: string }[]; areas: MapaArea[] }

export type Papel = 'USUARIO' | 'AUTORIDADE' | 'ADMIN';
export type Status = 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'CANCELADA';
export interface Me {
  id: number; nome: string; email: string; papeis: Papel[]; naoLidas: number;
  responsavelPor: { id: number; nome: string }[]; // ambientes que este usuário aprova (vazio para a maioria)
}
export interface Responsavel { id: number; nome: string; email: string }
export interface Ambiente {
  id: number; nome: string; tipo: string; capacidade: number | null; localizacao: string | null;
  ativo: boolean; autoridades: Responsavel[]; // pode haver vários responsáveis; basta um aprovar
}

/** Regras de reserva definidas pelo administrador. `hoje` e `limite` são datas 'AAAA-MM-DD' no horário de Recife. */
export interface RegrasReserva { periodo_max_meses: number; duracao_max_horas: number; hoje: string; limite: string }
export const fmtDia = (d: string) => d.split('-').reverse().join('/');

export const fmtDataHora = (d: string) =>
  new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const fmtHora = (d: string) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const rotuloStatus: Record<Status, string> = {
  PENDENTE: 'Pendente', APROVADA: 'Aprovada', RECUSADA: 'Recusada', CANCELADA: 'Cancelada',
};
