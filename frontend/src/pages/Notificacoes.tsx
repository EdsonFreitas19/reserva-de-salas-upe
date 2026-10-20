import { useEffect, useState } from 'react';
import { api, fmtDataHora } from '../api';
import { useMe } from '../App';
import { IconeLixeira } from './MinhasReservas';

interface N { id: number; mensagem: string; lida: boolean; criado_em: string }

// RF15
export default function Notificacoes() {
  const [lista, setLista] = useState<N[] | null>(null);
  const { refresh } = useMe();
  useEffect(() => {
    api<N[]>('/api/notificacoes').then(async (l) => {
      setLista(l);
      if (l.some((n) => !n.lida)) { await api('/api/notificacoes/lidas', { body: {} }); refresh(); }
    });
  }, [refresh]);

  const excluir = async (id: number) => {
    if (!confirm('Excluir esta notificação? Essa ação não pode ser desfeita.')) return;
    await api(`/api/notificacoes/${id}`, { method: 'DELETE' });
    setLista((l) => l && l.filter((n) => n.id !== id));
  };

  return (
    <>
      <h1 className="page-title">Notificações</h1>
      {lista?.length === 0 && <p className="muted">Nenhuma notificação.</p>}
      <div className="stack">
        {lista?.map((n) => (
          <div key={n.id} className={`card notif ${n.lida ? '' : 'notif-nova'}`}>
            <div className="card-head">
              <p>{n.mensagem}</p>
              <button className="trash" title="Excluir notificação" aria-label="Excluir notificação" onClick={() => excluir(n.id)}><IconeLixeira /></button>
            </div>
            <span className="muted small">{fmtDataHora(n.criado_em)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
