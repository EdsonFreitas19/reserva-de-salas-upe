import { useCallback, useEffect, useState } from 'react';
import { api, fmtDataHora, rotuloStatus, Status } from '../api';

interface Reserva {
  id: number; ambiente_nome: string; inicio: string; fim: string; finalidade: string; status: Status;
  criado_em: string; justificativa_recusa: string | null;
  cancelada_pela_autoridade: boolean; cancelado_por_nome: string | null; motivo_cancelamento: string | null;
}
interface Hist { status_anterior: Status | null; status_novo: Status; autor_nome: string; motivo: string | null; criado_em: string }

export const IconeLixeira = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
  </svg>
);

export const Badge = ({ s }: { s: Status }) => <span className={`badge badge-${s.toLowerCase()}`}>{rotuloStatus[s]}</span>;

// RF08 + RF09
export default function MinhasReservas() {
  const [lista, setLista] = useState<Reserva[] | null>(null);
  const [hist, setHist] = useState<Record<number, Hist[] | null>>({});
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => { api<Reserva[]>('/api/reservas/minhas').then(setLista).catch((e) => setErro(e.message)); }, []);
  useEffect(carregar, [carregar]);

  const cancelar = async (id: number) => {
    if (!confirm('Cancelar esta reserva?')) return;
    try { await api(`/api/reservas/${id}/cancelar`, { body: {} }); carregar(); } catch (e) { setErro((e as Error).message); }
  };
  const excluir = async (id: number) => {
    if (!confirm('Excluir esta reserva da sua lista? Essa ação não pode ser desfeita.')) return;
    try { await api(`/api/reservas/${id}`, { method: 'DELETE' }); carregar(); } catch (e) { setErro((e as Error).message); }
  };
  const alternarHist = async (id: number) => {
    if (hist[id]) return setHist({ ...hist, [id]: null });
    setHist({ ...hist, [id]: await api<Hist[]>(`/api/reservas/${id}/historico`) });
  };

  return (
    <>
      <h1 className="page-title">Minhas reservas</h1>
      {erro && <div className="alert alert-err">{erro}</div>}
      {lista?.length === 0 && <p className="muted">Você ainda não fez nenhuma solicitação.</p>}
      <div className="stack">
        {lista?.map((r) => (
          <div className="card" key={r.id}>
            <div className="card-head">
              <h3>{r.ambiente_nome}</h3>
              <span className="head-right">
                <Badge s={r.status} />
                {(['RECUSADA', 'CANCELADA'].includes(r.status) || new Date(r.fim) <= new Date()) && (
                  <button className="trash" title="Excluir da minha lista" aria-label="Excluir da minha lista" onClick={() => excluir(r.id)}><IconeLixeira /></button>
                )}
              </span>
            </div>
            <p><b>{fmtDataHora(r.inicio)}</b> até <b>{fmtDataHora(r.fim)}</b></p>
            <p className="muted">{r.finalidade}</p>
            {r.justificativa_recusa && <div className="alert alert-err">Motivo da recusa: {r.justificativa_recusa}</div>}
            {r.status === 'CANCELADA' && r.cancelada_pela_autoridade && (
              <div className="alert alert-err">
                Cancelada pela autoridade{r.cancelado_por_nome ? ` (${r.cancelado_por_nome})` : ''}
                {r.motivo_cancelamento ? `. Motivo: ${r.motivo_cancelamento}` : '.'}
              </div>
            )}
            <div className="actions">
              <button className="btn btn-outline" onClick={() => alternarHist(r.id)}>{hist[r.id] ? 'Ocultar histórico' : 'Histórico'}</button>
              {(r.status === 'PENDENTE' || (r.status === 'APROVADA' && new Date(r.inicio) > new Date())) && (
                <button className="btn btn-danger" onClick={() => cancelar(r.id)}>Cancelar</button>
              )}
            </div>
            {hist[r.id] && (
              <ul className="timeline">
                {hist[r.id]!.map((h, i) => (
                  <li key={i}>
                    <b>{rotuloStatus[h.status_novo]}</b> — {fmtDataHora(h.criado_em)} por {h.autor_nome}
                    {h.motivo && <em> ({h.motivo})</em>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
