import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Fotos from '../components/Fotos';
import { Ambiente, api } from '../api';
import { useMe } from '../App';

// Consulta das salas (tipo, local, capacidade, responsáveis e fotos). Aqui não se reserva: a reserva é feita em "Reserva".
export default function Informacoes() {
  const { me } = useMe();
  const [params] = useSearchParams();
  const sala = Number(params.get('sala')) || null; // vindo da lista da Reserva: abre já os detalhes dessa sala
  const [lista, setLista] = useState<Ambiente[] | null>(null);
  const [aberta, setAberta] = useState<number | null>(sala);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const alvo = useRef<HTMLDivElement | null>(null);
  useEffect(() => { api<Ambiente[]>('/api/ambientes').then(setLista).catch((e) => setErro(e.message)); }, []);
  useEffect(() => { if (sala && lista) alvo.current?.scrollIntoView({ block: 'center' }); }, [sala, lista]);
  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (lista ?? []).filter((a) => !q || `${a.nome} ${a.tipo} ${a.localizacao ?? ''}`.toLowerCase().includes(q));
  }, [lista, busca]);

  return (
    <>
      <h1 className="page-title">Informações</h1>
      <p className="muted small">Consulte como é cada ambiente: tipo, local, capacidade, responsáveis e fotos.</p>
      <div className="inline-form"><input type="search" placeholder="Buscar ambiente" aria-label="Buscar ambiente" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      {erro && <div className="alert alert-err">{erro}</div>}
      {lista?.length === 0 && <p className="muted">Nenhum ambiente cadastrado.</p>}
      <div className="grid">
        {filtrada.map((a) => (
          <div className={`card${a.id === sala ? ' destaque' : ''}`} key={a.id} ref={a.id === sala ? alvo : undefined}>
            <span className="tag">{a.tipo}</span>
            {me.responsavelPor.some((r) => r.id === a.id) && <span className="tag tag-resp">Você é responsável</span>}
            <h3>{a.nome}</h3>
            <p className="muted small">
              {a.localizacao ?? 'Local não informado'}
              {a.capacidade ? ` · até ${a.capacidade} pessoas` : ''}
            </p>
            {a.autoridades.length > 0 && <p className="muted small">Responsável: {a.autoridades.map((r) => r.nome).join(', ')}</p>}
            <button className="btn btn-outline" onClick={() => setAberta(aberta === a.id ? null : a.id)}>{aberta === a.id ? 'Ocultar fotos' : 'Ver fotos'}</button>
            {aberta === a.id && <Fotos ambienteId={a.id} />}
          </div>
        ))}
      </div>
      {lista && lista.length > 0 && filtrada.length === 0 && <p className="muted">Nenhum ambiente encontrado.</p>}

      <div className="card cta">
        <h3>Quer reservar um ambiente?</h3>
        <p className="muted">Escolha a sala no mapa ou na lista e solicite o horário.</p>
        <Link className="btn btn-primary" to="/">Faça sua reserva aqui</Link>
      </div>
    </>
  );
}
