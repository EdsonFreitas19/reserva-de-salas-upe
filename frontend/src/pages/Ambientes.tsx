import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ambiente, api } from '../api';
import { useMe } from '../App';

// RF03
export default function Ambientes() {
  const [lista, setLista] = useState<Ambiente[] | null>(null);
  const [erro, setErro] = useState('');
  const { me } = useMe();
  useEffect(() => { api<Ambiente[]>('/api/ambientes').then(setLista).catch((e) => setErro(e.message)); }, []);

  return (
    <>
      <h1 className="page-title">Ambientes</h1>
      {erro && <div className="alert alert-err">{erro}</div>}
      {lista?.length === 0 && <p className="muted">Nenhum ambiente cadastrado.</p>}
      <div className="grid">
        {lista?.map((a) => (
          <div className="card" key={a.id}>
            <span className="tag">{a.tipo}</span>
            {me.responsavelPor.some((r) => r.id === a.id) && <span className="tag tag-resp">Você é responsável</span>}
            <h3>{a.nome}</h3>
            <p className="muted small">
              {a.localizacao ?? 'Local não informado'}
              {a.capacidade ? ` · até ${a.capacidade} pessoas` : ''}
            </p>
            {a.autoridades.length > 0 && <p className="muted small">Responsável: {a.autoridades.map((r) => r.nome).join(', ')}</p>}
            <Link className="btn btn-primary" to={`/ambientes/${a.id}`}>Ver agenda e reservar</Link>
          </div>
        ))}
      </div>
    </>
  );
}
