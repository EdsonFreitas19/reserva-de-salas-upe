import { FormEvent, Fragment, useCallback, useEffect, useState } from 'react';
import { Ambiente, api, fmtDataHora, Responsavel, Status } from '../api';
import { Badge } from './MinhasReservas';
import Ocupados from './Ocupados';
import { useDesfazer } from '../App';
import TipoSelect, { Tipo } from '../components/TipoSelect';

interface Usuario { id: number; nome: string; email: string; papeis: string[]; responsavel_por?: { id: number; nome: string }[] }
interface Res { id: number; ambiente_nome: string; solicitante_nome: string; inicio: string; fim: string; finalidade: string; status: Status }
const vazio = { nome: '', tipo: '', capacidade: '', localizacao: '' };

export default function Admin() {
  const [aba, setAba] = useState<'ambientes' | 'usuarios' | 'tipos' | 'reservas'>('ambientes');
  return (
    <>
      <h1 className="page-title">Administração</h1>
      <div className="tabs">
        <button className={aba === 'ambientes' ? 'tab active' : 'tab'} onClick={() => setAba('ambientes')}>Ambientes e autoridades</button>
        <button className={aba === 'usuarios' ? 'tab active' : 'tab'} onClick={() => setAba('usuarios')}>Usuários</button>
        <button className={aba === 'tipos' ? 'tab active' : 'tab'} onClick={() => setAba('tipos')}>Tipos de ambiente</button>
        <button className={aba === 'reservas' ? 'tab active' : 'tab'} onClick={() => setAba('reservas')}>Todas as reservas</button>
      </div>
      {aba === 'ambientes' ? <Ambientes /> : aba === 'usuarios' ? <Usuarios /> : aba === 'tipos' ? <Tipos /> : <Reservas />}
    </>
  );
}

// RF12 + RF13 + horários ocupados
// RF12 + RF13 + horários ocupados

function Ambientes() {
  const registrar = useDesfazer();
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [avisoMapa, setAvisoMapa] = useState('');
  useEffect(() => { api<Tipo[]>('/api/tipos').then(setTipos); }, []);
  const [lista, setLista] = useState<Ambiente[]>([]);
  const [f, setF] = useState(vazio);
  const [edit, setEdit] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [erroLista, setErroLista] = useState('');
  const [aberto, setAberto] = useState<number | null>(null); // ambiente com o painel de gestão aberto

  const carregar = useCallback(() => { api<Ambiente[]>('/api/ambientes?todos=1').then(setLista); }, []);
  useEffect(carregar, [carregar]);

  const corpo = () => ({
    nome: f.nome, tipo: f.tipo,
    capacidade: f.capacidade ? Number(f.capacidade) : null,
    localizacao: f.localizacao || null,
  });
  const salvar = async (e: FormEvent) => {
    e.preventDefault(); setMsg('');
    try {
      const r = edit ? await api<{ area_ligada?: string | null }>(`/api/ambientes/${edit}`, { method: 'PATCH', body: corpo() })
        : await api<{ area_ligada?: string | null }>('/api/ambientes', { body: corpo() });
      setF(vazio); setEdit(null); carregar();
      if (r.area_ligada) setErroLista(''), setAvisoMapa(`O ambiente foi ligado automaticamente à área “${r.area_ligada}” do mapa.`); else setAvisoMapa('');
    } catch (err) { setMsg((err as Error).message); }
  };
  const editar = (a: Ambiente) => {
    setEdit(a.id);
    setF({ nome: a.nome, tipo: a.tipo, capacidade: a.capacidade?.toString() ?? '', localizacao: a.localizacao ?? '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const alternar = async (a: Ambiente) => {
    const corpo = (ativo: boolean) => ({ nome: a.nome, tipo: a.tipo, capacidade: a.capacidade, localizacao: a.localizacao, ativo });
    await api(`/api/ambientes/${a.id}`, { method: 'PATCH', body: corpo(!a.ativo) });
    registrar(`"${a.nome}" ${a.ativo ? 'desativado' : 'ativado'}`, async () => { await api(`/api/ambientes/${a.id}`, { method: 'PATCH', body: corpo(a.ativo) }); carregar(); });
    carregar();
  };
  const excluir = async (a: Ambiente) => {
    if (!confirm(`Excluir "${a.nome}" definitivamente?\n\nAs reservas antigas continuam no histórico com o nome atual deste ambiente. (Para só esconder o ambiente, use "Desativar".)`)) return;
    setErroLista('');
    try { await api(`/api/ambientes/${a.id}`, { method: 'DELETE' }); if (edit === a.id) { setEdit(null); setF(vazio); } carregar(); }
    catch (e) { setErroLista((e as Error).message); }
  };

  return (
    <>
      <form className="card form" onSubmit={salvar}>
        <h3>{edit ? 'Editar ambiente' : 'Novo ambiente'}</h3>
        <div className="row">
          <label>Nome<input required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></label>
          <label>Tipo<TipoSelect required value={f.tipo} tipos={tipos} onChange={(t) => setF({ ...f, tipo: t })} onAdicionar={(t) => setTipos((l) => [...l, t])} /></label>
        </div>
        <div className="row">
          <label>Capacidade<input type="number" min={1} value={f.capacidade} onChange={(e) => setF({ ...f, capacidade: e.target.value })} /></label>
          <label>Localização<input value={f.localizacao} onChange={(e) => setF({ ...f, localizacao: e.target.value })} /></label>
        </div>
        {msg && <div className="alert alert-err">{msg}</div>}
        <div className="actions">
          <button className="btn btn-primary">{edit ? 'Salvar' : 'Cadastrar'}</button>
          {edit && <button type="button" className="btn btn-outline" onClick={() => { setEdit(null); setF(vazio); }}>Cancelar</button>}
        </div>
      </form>

      {avisoMapa && <div className="alert alert-ok">{avisoMapa}</div>}
      {erroLista && <div className="alert alert-err">{erroLista}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ambiente</th><th>Tipo</th><th>Responsáveis (qualquer um aprova)</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.map((a) => (
              <Fragment key={a.id}>
                <tr className={a.ativo ? '' : 'inativo'}>
                  <td><b>{a.nome}</b><br /><span className="muted small">{a.localizacao}</span></td>
                  <td>{a.tipo}</td>
                  <td>
                    {a.autoridades.length === 0
                      ? <span className="badge badge-pendente">Sem responsável</span>
                      : a.autoridades.map((r) => <span key={r.id} className="chip" title={r.email}>{r.nome}</span>)}
                  </td>
                  <td>{a.ativo ? 'Ativo' : 'Inativo'}</td>
                  <td className="actions">
                    <button className="btn btn-outline" onClick={() => setAberto(aberto === a.id ? null : a.id)}>{aberto === a.id ? 'Fechar' : 'Responsáveis e horários'}</button>
                    <button className="btn btn-outline" onClick={() => editar(a)}>Editar</button>
                    <button className="btn btn-outline" onClick={() => alternar(a)}>{a.ativo ? 'Desativar' : 'Ativar'}</button>
                    <button className="btn btn-outline-danger" onClick={() => excluir(a)}>Excluir</button>
                  </td>
                </tr>
                {aberto === a.id && (
                  <tr><td colSpan={5} className="painel">
                    <Responsaveis amb={a} onChange={carregar} />
                    <Ocupados amb={a} />
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Responsaveis({ amb, onChange }: { amb: Ambiente; onChange: () => void }) {
  const registrar = useDesfazer();
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState('');
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  useEffect(() => { api<Usuario[]>('/api/usuarios').then(setUsuarios); }, []);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErro('');
    try { await api(`/api/ambientes/${amb.id}/autoridades`, { body: { email } }); setEmail(''); onChange(); }
    catch (err) { setErro((err as Error).message); }
  };
  const remover = async (r: Responsavel) => {
    if (!confirm(`Remover ${r.nome} como responsável por "${amb.nome}"?`)) return;
    setErro('');
    try {
      await api(`/api/ambientes/${amb.id}/autoridades/${r.id}`, { method: 'DELETE' });
      registrar(`${r.nome} deixou de ser responsável por "${amb.nome}"`, async () => { await api(`/api/ambientes/${amb.id}/autoridades`, { body: { usuario_id: r.id } }); onChange(); });
      onChange();
    }
    catch (err) { setErro((err as Error).message); }
  };
  return (
    <div className="bloco">
      <h4>Responsáveis pela aprovação</h4>
      <p className="muted small">Basta um dos responsáveis aprovar. Informe o e-mail institucional; se a pessoa ainda não entrou no sistema, o acesso é liberado no primeiro login.</p>
      <div>
        {amb.autoridades.map((r) => (
          <span key={r.id} className="chip">{r.nome} <span className="muted small">({r.email})</span>
            <button className="chip-x" title="Remover" onClick={() => remover(r)}>×</button></span>
        ))}
        {amb.autoridades.length === 0 && <span className="muted small">Nenhum responsável ainda.</span>}
      </div>
      <form className="inline-form" onSubmit={add}>
        <input type="email" required list={`usr-${amb.id}`} placeholder="nome@upe.br" value={email} onChange={(e) => setEmail(e.target.value)} />
        <datalist id={`usr-${amb.id}`}>{usuarios.map((u) => <option key={u.id} value={u.email}>{u.nome}</option>)}</datalist>
        <button className="btn btn-primary">Adicionar responsável</button>
      </form>
      {erro && <div className="alert alert-err">{erro}</div>}
    </div>
  );
}

// Usuários: o admin designa (ou retira) a responsabilidade de cada pessoa sobre ambientes.
// O administrador não aprova reservas e não pode ser responsável.
function Usuarios() {
  const registrar = useDesfazer();
  const [lista, setLista] = useState<Usuario[]>([]);
  const [ambs, setAmbs] = useState<Ambiente[]>([]);
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<Record<number, string>>({});
  const [erro, setErro] = useState('');
  const [novo, setNovo] = useState({ nome: '', email: '' });
  const carregar = useCallback(() => {
    api<Usuario[]>('/api/usuarios').then(setLista);
    api<Ambiente[]>('/api/ambientes').then(setAmbs);
  }, []);
  useEffect(carregar, [carregar]);
  const add = async (u: Usuario) => {
    const amb = sel[u.id]; if (!amb) return; setErro('');
    try { await api(`/api/ambientes/${amb}/autoridades`, { body: { usuario_id: u.id } }); setSel({ ...sel, [u.id]: '' }); carregar(); }
    catch (err) { setErro((err as Error).message); }
  };
  const remover = async (u: Usuario, a: { id: number; nome: string }) => {
    if (!confirm(`Retirar ${u.nome} da responsabilidade por "${a.nome}"?`)) return;
    setErro('');
    try {
      await api(`/api/ambientes/${a.id}/autoridades/${u.id}`, { method: 'DELETE' });
      registrar(`${u.nome} deixou de ser responsável por "${a.nome}"`, async () => { await api(`/api/ambientes/${a.id}/autoridades`, { body: { usuario_id: u.id } }); carregar(); });
      carregar();
    }
    catch (err) { setErro((err as Error).message); }
  };
  const cadastrar = async (e: FormEvent) => {
    e.preventDefault(); setErro('');
    try { await api('/api/usuarios', { body: novo }); setNovo({ nome: '', email: '' }); carregar(); }
    catch (err) { setErro((err as Error).message); }
  };
  const removerUsuario = async (u: Usuario) => {
    if (!confirm(`Remover o acesso de ${u.nome}? Ele deixa de entrar no sistema e perde as responsabilidades por salas.`)) return;
    setErro('');
    const meus = u.responsavel_por ?? [];
    try {
      await api(`/api/usuarios/${u.id}`, { method: 'DELETE' });
      registrar(`Acesso de ${u.nome} removido`, async () => {
        await api('/api/usuarios', { body: { email: u.email, nome: u.nome } });
        for (const a of meus) await api(`/api/ambientes/${a.id}/autoridades`, { body: { usuario_id: u.id } });
        carregar();
      });
      carregar();
    }
    catch (err) { setErro((err as Error).message); }
  };
  const q = busca.trim().toLowerCase();
  const filtrada = lista.filter((u) => !q || u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  return (
    <>
      <p className="muted small">Escolha em quais ambientes cada pessoa é responsável. Quem é responsável aprova ou recusa as reservas do ambiente; o administrador apenas designa e não aprova reservas.</p>
      <form className="inline-form" onSubmit={cadastrar}>
        <input placeholder="Nome (opcional)" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
        <input type="email" required placeholder="E-mail do novo usuário (professor ou funcionário)" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
        <button className="btn btn-primary">Cadastrar usuário</button>
      </form>
      <input placeholder="Buscar por nome ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {erro && <div className="alert alert-err">{erro}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Responsável por</th><th>Designar ambiente</th><th></th></tr></thead>
          <tbody>
            {filtrada.map((u) => {
              const admin = u.papeis.includes('ADMIN');
              const meus = u.responsavel_por ?? [];
              const livres = ambs.filter((a) => !meus.some((m) => m.id === a.id));
              return (
                <tr key={u.id}>
                  <td>{u.nome}</td><td>{u.email}</td>
                  <td>
                    {admin ? <span className="muted small">Administrador — não é responsável por salas e não aprova reservas</span> : <>
                      {meus.map((a) => (
                        <span key={a.id} className="chip">{a.nome}<button className="chip-x" title="Retirar" onClick={() => remover(u, a)}>×</button></span>
                      ))}
                      {meus.length === 0 && <span className="muted small">—</span>}
                    </>}
                  </td>
                  <td>
                    {!admin && (
                      <div className="inline-form">
                        <select value={sel[u.id] ?? ''} onChange={(e) => setSel({ ...sel, [u.id]: e.target.value })}>
                          <option value="">Escolha o ambiente…</option>
                          {livres.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                        </select>
                        <button className="btn btn-primary" disabled={!sel[u.id]} onClick={() => add(u)}>Adicionar</button>
                      </div>
                    )}
                  </td>
                  <td>{!admin && <button className="btn btn-danger" title="Remover acesso" onClick={() => removerUsuario(u)}>Remover</button>}</td>
                </tr>
              );
            })}
            {filtrada.length === 0 && <tr><td colSpan={5} className="muted">Nenhum usuário encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Tipos de ambiente: nome e cor (a cor é a do mapa). Renomear atualiza todos os ambientes que usam o tipo.
function Tipos() {
  const [lista, setLista] = useState<(Tipo & { ambientes: number; areas: number })[]>([]);
  const [novo, setNovo] = useState({ nome: '', cor: '#cfe3ff' });
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => { api<(Tipo & { ambientes: number; areas: number })[]>('/api/tipos').then(setLista); }, []);
  useEffect(carregar, [carregar]);
  const tentar = async (f: () => Promise<unknown>) => { setErro(''); try { await f(); carregar(); } catch (e) { setErro((e as Error).message); } };
  const editar = (id: number, campo: 'nome' | 'cor', v: string) => setLista((l) => l.map((t) => (t.id === id ? { ...t, [campo]: v } : t)));
  return (
    <>
      <p className="muted small">Os tipos aparecem na lista ao cadastrar ambientes e no mapa, com a cor escolhida aqui. Para criar um tipo novo basta preencher abaixo (ou usar “＋ Adicionar novo tipo…” na lista de tipos).</p>
      {erro && <div className="alert alert-err">{erro}</div>}
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); tentar(async () => { await api('/api/tipos', { body: novo }); setNovo({ nome: '', cor: '#cfe3ff' }); }); }}>
        <input required maxLength={40} placeholder="Nome do novo tipo" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
        <input type="color" title="Cor no mapa" value={novo.cor} onChange={(e) => setNovo({ ...novo, cor: e.target.value })} />
        <button className="btn btn-primary">Adicionar tipo</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Cor</th><th>Nome</th><th>Em uso</th><th /></tr></thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id}>
                <td><input type="color" value={t.cor} onChange={(e) => editar(t.id!, 'cor', e.target.value)} /></td>
                <td><input value={t.nome} maxLength={40} disabled={t.nome === 'Sem tipo'} title={t.nome === 'Sem tipo' ? 'Tipo padrão do sistema: só a cor pode mudar' : undefined} onChange={(e) => editar(t.id!, 'nome', e.target.value)} /></td>
                <td className="muted small">{t.ambientes} ambiente(s) · {t.areas} área(s) no mapa</td>
                <td>
                  <button className="btn btn-primary" onClick={() => tentar(() => api(`/api/tipos/${t.id}`, { method: 'PATCH', body: { nome: t.nome, cor: t.cor } }))}>Salvar</button>{' '}
                  {t.nome !== 'Sem tipo' && <button className="btn btn-outline-danger" onClick={() => { if (confirm(`Excluir o tipo "${t.nome}"?`)) tentar(() => api(`/api/tipos/${t.id}`, { method: 'DELETE' })); }}>Excluir</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// RF14
function Reservas() {
  const [lista, setLista] = useState<Res[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => { api<Res[]>(`/api/reservas${status ? `?status=${status}` : ''}`).then(setLista); }, [status]);
  return (
    <>
      <label className="inline">Filtrar por status:{' '}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option><option value="PENDENTE">Pendente</option><option value="APROVADA">Aprovada</option>
          <option value="RECUSADA">Recusada</option><option value="CANCELADA">Cancelada</option>
        </select>
      </label>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ambiente</th><th>Período</th><th>Solicitante</th><th>Finalidade</th><th>Status</th></tr></thead>
          <tbody>
            {lista.map((r) => (
              <tr key={r.id}>
                <td>{r.ambiente_nome}</td>
                <td>{fmtDataHora(r.inicio)} → {fmtDataHora(r.fim)}</td>
                <td>{r.solicitante_nome}</td>
                <td>{r.finalidade}</td>
                <td><Badge s={r.status} /></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={5} className="muted">Nada encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
