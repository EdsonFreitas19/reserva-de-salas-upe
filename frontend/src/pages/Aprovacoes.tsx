import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtDataHora } from '../api';
import { useMe } from '../App';
import Ocupados from './Ocupados';

interface Pendente {
  id: number; ambiente_nome: string; solicitante_nome: string; inicio: string; fim: string; finalidade: string;
  criado_em: string; conflita_com_aprovada: boolean; bloqueio_conflitante: string | null; pendentes_anteriores: number;
}
interface Aprovada { id: number; ambiente_nome: string; solicitante_nome: string; inicio: string; fim: string; finalidade: string }
interface Pessoa {
  id: number; nome: string; email: string; administrador: boolean; responsavel_por: string[];
  pendentes_nas_minhas_salas: number; aprovadas_nas_minhas_salas: number;
}
type Msg = { tipo: 'ok' | 'err'; texto: string } | null;
type Aba = 'pendentes' | 'aprovadas' | 'salas' | 'usuarios';

/**
 * Área do responsável. Todo usuário vê "Aprovações" no menu; quem não é responsável por nenhuma sala vê só um aviso.
 * Quem é (o administrador é quem indica) vê as solicitações das suas salas, as reservas aprovadas, a administração
 * das próprias salas (horários ocupados) e a lista de usuários.
 */
export default function Aprovacoes() {
  const { me } = useMe();
  const [aba, setAba] = useState<Aba>('pendentes');

  if (me.responsavelPor.length === 0)
    return (
      <>
        <h1 className="page-title">Aprovações</h1>
        <div className="card vazio">
          <h3>Você não é responsável por nenhuma sala</h3>
          <p className="muted">
            Quando o administrador indicar você como responsável por um ambiente, as solicitações de reserva dele
            aparecerão aqui e você poderá aprová-las, recusá-las e administrar a sala.
          </p>
        </div>
      </>
    );

  return (
    <>
      <h1 className="page-title">Aprovações</h1>
      <p className="muted small">Você é responsável por: <b>{me.responsavelPor.map((a) => a.nome).join(', ')}</b></p>
      <div className="tabs">
        {([['pendentes', 'Solicitações pendentes'], ['aprovadas', 'Reservas aprovadas'], ['salas', 'Minhas salas'], ['usuarios', 'Usuários']] as [Aba, string][]).map(([k, t]) => (
          <button key={k} className={aba === k ? 'tab active' : 'tab'} onClick={() => setAba(k)}>{t}</button>
        ))}
      </div>
      {aba === 'pendentes' && <Pendentes />}
      {aba === 'aprovadas' && <Aprovadas />}
      {aba === 'salas' && <MinhasSalas />}
      {aba === 'usuarios' && <Usuarios />}
    </>
  );
}

// RF10 + RF11
function Pendentes() {
  const [pend, setPend] = useState<Pendente[] | null>(null);
  const [recusando, setRecusando] = useState<number | null>(null);
  const [texto, setTexto] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const carregar = useCallback(() => {
    api<Pendente[]>('/api/reservas/pendentes').then(setPend).catch((e) => setMsg({ tipo: 'err', texto: e.message }));
  }, []);
  useEffect(carregar, [carregar]);
  const fechar = () => { setRecusando(null); setTexto(''); };
  const executar = async (url: string, body: object, ok: string) => {
    setMsg(null);
    try { await api(url, { body }); setMsg({ tipo: 'ok', texto: ok }); fechar(); }
    catch (e) { setMsg({ tipo: 'err', texto: (e as Error).message }); }
    carregar();
  };
  return (
    <>
      <p className="muted">
        Ordenadas por ordem de chegada. Se o ambiente tem mais de um responsável, basta um decidir. Ao aprovar, as outras
        solicitações pendentes do mesmo ambiente e horário são recusadas automaticamente, e cada solicitante é avisado.
      </p>
      {msg && <div className={`alert alert-${msg.tipo}`}>{msg.texto}</div>}
      {pend?.length === 0 && <p className="muted">Nenhuma solicitação pendente.</p>}
      <div className="stack">
        {pend?.map((r) => (
          <div className="card" key={r.id}>
            <div className="card-head">
              <h3>{r.ambiente_nome}</h3>
              <span className="muted small">solicitada em {fmtDataHora(r.criado_em)}</span>
            </div>
            <p><b>{fmtDataHora(r.inicio)}</b> até <b>{fmtDataHora(r.fim)}</b></p>
            <p>Solicitante: <b>{r.solicitante_nome}</b></p>
            <p className="muted">{r.finalidade}</p>
            {r.conflita_com_aprovada && <div className="alert alert-err">Conflita com uma reserva já aprovada — só é possível recusar.</div>}
            {r.bloqueio_conflitante && <div className="alert alert-err">Horário ocupado ({r.bloqueio_conflitante}) — só é possível recusar.</div>}
            {r.pendentes_anteriores > 0 && (
              <div className="alert alert-warn">{r.pendentes_anteriores} solicitação(ões) conflitante(s) chegou(aram) antes desta.</div>
            )}
            {recusando === r.id ? (
              <div className="form">
                <label>Justificativa da recusa (obrigatória)
                  <textarea rows={2} maxLength={300} value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
                </label>
                <div className="actions">
                  <button className="btn btn-danger" disabled={texto.trim().length < 3}
                    onClick={() => executar(`/api/reservas/${r.id}/recusar`, { justificativa: texto }, 'Reserva recusada.')}>Confirmar recusa</button>
                  <button className="btn btn-outline" onClick={fechar}>Voltar</button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button className="btn btn-primary" disabled={r.conflita_com_aprovada || !!r.bloqueio_conflitante}
                  onClick={() => executar(`/api/reservas/${r.id}/aprovar`, {}, 'Reserva aprovada.')}>Aprovar</button>
                <button className="btn btn-outline-danger" onClick={() => { fechar(); setRecusando(r.id); }}>Recusar</button>
              </div>
            )}
          </div>
        ))}
      </div>

    </>
  );
}

// Cancelamento de reservas já aprovadas (antes de começarem)
function Aprovadas() {
  const [aprov, setAprov] = useState<Aprovada[] | null>(null);
  const [cancelando, setCancelando] = useState<number | null>(null);
  const [texto, setTexto] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const carregar = useCallback(() => {
    api<Aprovada[]>('/api/reservas/aprovadas').then(setAprov).catch((e) => setMsg({ tipo: 'err', texto: e.message }));
  }, []);
  useEffect(carregar, [carregar]);
  const fechar = () => { setCancelando(null); setTexto(''); };
  const executar = async (url: string, body: object, ok: string) => {
    setMsg(null);
    try { await api(url, { body }); setMsg({ tipo: 'ok', texto: ok }); fechar(); }
    catch (e) { setMsg({ tipo: 'err', texto: (e as Error).message }); }
    carregar();
  };
  return (
    <>
      <p className="muted">Você pode cancelar uma reserva aprovada até o momento em que ela começar. O solicitante recebe uma notificação com o motivo.</p>
      {msg && <div className={`alert alert-${msg.tipo}`}>{msg.texto}</div>}
      {aprov?.length === 0 && <p className="muted">Nenhuma reserva aprovada por vir nos seus ambientes.</p>}
      <div className="stack">
        {aprov?.map((r) => (
          <div className="card" key={r.id}>
            <div className="card-head"><h3>{r.ambiente_nome}</h3><span className="badge badge-aprovada">Aprovada</span></div>
            <p><b>{fmtDataHora(r.inicio)}</b> até <b>{fmtDataHora(r.fim)}</b></p>
            <p>Solicitante: <b>{r.solicitante_nome}</b></p>
            <p className="muted">{r.finalidade}</p>
            {cancelando === r.id ? (
              <div className="form">
                <label>Motivo do cancelamento (obrigatório — será enviado a {r.solicitante_nome})
                  <textarea rows={2} maxLength={300} value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
                </label>
                <div className="actions">
                  <button className="btn btn-danger" disabled={texto.trim().length < 3}
                    onClick={() => executar(`/api/reservas/${r.id}/cancelar-pela-autoridade`, { motivo: texto }, 'Reserva cancelada e o solicitante foi avisado.')}>
                    Confirmar cancelamento</button>
                  <button className="btn btn-outline" onClick={fechar}>Voltar</button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button className="btn btn-outline-danger" onClick={() => { fechar(); setCancelando(r.id); }}>Cancelar reserva</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// Administração das salas de quem é responsável: horários ocupados (aulas e usos fixos)
function MinhasSalas() {
  const { me } = useMe();
  const [aberta, setAberta] = useState<number | null>(null);
  const [todas, setTodas] = useState<{ id: number; nome: string; tipo: string; localizacao: string | null; autoridades: { id: number; nome: string; email: string }[] }[]>([]);
  useEffect(() => { api<typeof todas>('/api/ambientes').then(setTodas).catch(() => setTodas([])); }, []);
  const minhas = todas.filter((a) => me.responsavelPor.some((r) => r.id === a.id));
  return (
    <>
      <p className="muted">
        Aqui você administra as salas pelas quais é responsável: cadastre os horários em que a sala está ocupada (aulas, manutenção)
        e eles aparecem como "Ocupado" na agenda. Quem pode ser responsável por cada sala é definido pelo administrador.
      </p>
      <div className="stack">
        {minhas.map((a) => (
          <div className="card" key={a.id}>
            <div className="card-head"><h3>{a.nome}</h3><span className="tag">{a.tipo}</span></div>
            <p className="muted small">{a.localizacao ?? 'Local não informado'}</p>
            <p className="small">Responsáveis: {a.autoridades.map((r) => <span key={r.id} className="chip" title={r.email}>{r.nome}</span>)}</p>
            <div className="actions">
              <button className="btn btn-outline" onClick={() => setAberta(aberta === a.id ? null : a.id)}>
                {aberta === a.id ? 'Fechar horários ocupados' : 'Horários ocupados'}
              </button>
            </div>
            {aberta === a.id && <Ocupados amb={a} />}
          </div>
        ))}
      </div>
    </>
  );
}

// Lista de usuários do sistema
function Usuarios() {
  const [lista, setLista] = useState<Pessoa[] | null>(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  useEffect(() => { api<Pessoa[]>('/api/usuarios/diretorio').then(setLista).catch((e) => setErro(e.message)); }, []);
  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (lista ?? []).filter((u) => !q || u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [lista, busca]);
  const buscar = (e: FormEvent) => e.preventDefault();
  return (
    <>
      <p className="muted">Professores e funcionários que usam o sistema. A coluna "Nas minhas salas" mostra as reservas de cada pessoa nas salas pelas quais você é responsável.</p>
      {erro && <div className="alert alert-err">{erro}</div>}
      <form className="inline-form" onSubmit={buscar}>
        <input type="search" placeholder="Buscar por nome ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Nas minhas salas</th></tr></thead>
          <tbody>
            {filtrada.map((u) => (
              <tr key={u.id}>
                <td><b>{u.nome}</b></td>
                <td>{u.email}</td>
                <td>
                  {u.administrador && <span className="chip">Administrador</span>}
                  {u.responsavel_por.length > 0 && <span className="small">Responsável por {u.responsavel_por.join(', ')}</span>}
                  {!u.administrador && u.responsavel_por.length === 0 && <span className="muted small">Usuário</span>}
                </td>
                <td className="small">
                  {u.pendentes_nas_minhas_salas + u.aprovadas_nas_minhas_salas === 0
                    ? <span className="muted">—</span>
                    : <>{u.pendentes_nas_minhas_salas} pendente(s) · {u.aprovadas_nas_minhas_salas} aprovada(s) por vir</>}
                </td>
              </tr>
            ))}
            {lista && filtrada.length === 0 && <tr><td colSpan={4} className="muted">Nenhum usuário encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
