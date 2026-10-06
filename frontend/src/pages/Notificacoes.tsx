import { useEffect, useState } from 'react';
import { api, fmtDataHora } from '../api';
import { useMe } from '../App';

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

  return (
    <>
      <h1 className="page-title">Notificações</h1>
      {lista?.length === 0 && <p className="muted">Nenhuma notificação.</p>}
      <div className="stack">
        {lista?.map((n) => (
          <div key={n.id} className={`card notif ${n.lida ? '' : 'notif-nova'}`}>
            <p>{n.mensagem}</p>
            <span className="muted small">{fmtDataHora(n.criado_em)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
