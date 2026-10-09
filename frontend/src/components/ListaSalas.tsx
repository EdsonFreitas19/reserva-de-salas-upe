import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ambiente, api } from '../api';

/**
 * Lista de rolagem com as salas que podem ser reservadas (ativas e com responsável). Clicar numa sala abre a agenda e o
 * formulário de reserva — o mesmo que clicar nela no mapa. O link "Informações" leva aos detalhes da sala.
 */
export default function ListaSalas({ cores, onPassar }: { cores: Map<string, string>; onPassar: (ambienteId: number | null) => void }) {
  const [salas, setSalas] = useState<Ambiente[] | null>(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<Ambiente[]>('/api/ambientes').then((l) => setSalas(l.filter((a) => a.autoridades.length > 0))).catch((e) => setErro(e.message));
  }, []);
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (salas ?? []).filter((a) => !q || `${a.nome} ${a.tipo} ${a.localizacao ?? ''}`.toLowerCase().includes(q));
  }, [salas, busca]);

  return (
    <section className="salas">
      <div className="salas-head">
        <h2>Salas disponíveis{salas ? <span className="muted small"> · {salas.length}</span> : null}</h2>
        <input type="search" placeholder="Buscar sala" aria-label="Buscar sala" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {erro && <div className="alert alert-err">{erro}</div>}
      <ul className="salas-lista" onPointerLeave={() => onPassar(null)}>
        {filtradas.map((a) => (
          <li key={a.id} onPointerEnter={() => onPassar(a.id)}>
            <Link className="sala-link" to={`/ambientes/${a.id}`} title="Ver a agenda e reservar">
              <span className="sala-dot" style={{ background: cores.get(a.tipo) ?? '#ddd' }} />
              <span className="sala-nome">{a.nome}</span>
              <span className="muted small sala-meta">{a.tipo}{a.capacidade ? ` · até ${a.capacidade}` : ''}</span>
            </Link>
            <Link className="sala-info" to={`/informacoes?sala=${a.id}`} title="Ver informações desta sala">ℹ Informações</Link>
          </li>
        ))}
        {salas && filtradas.length === 0 && <li className="muted small sala-vazia">{salas.length === 0 ? 'Nenhuma sala disponível para reserva no momento.' : 'Nenhuma sala encontrada.'}</li>}
      </ul>
    </section>
  );
}
