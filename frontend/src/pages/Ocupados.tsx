import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useDesfazer } from '../App';

interface Regra { id: number; descricao: string; dias_semana: number[]; hora_inicio: string; hora_fim: string; data_inicio: string; data_fim: string }
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const fmtData = (d: string) => d.split('-').reverse().join('/');
const vazioBloq = { descricao: '', dias: [1, 2, 3, 4, 5] as number[], hora_inicio: '08:00', hora_fim: '10:00', data_inicio: '', data_fim: '' };

/** Horários ocupados de um ambiente (aulas e usos fixos). Usado pelo administrador e pelos responsáveis da sala. */
export default function Ocupados({ amb }: { amb: { id: number } }) {
  const registrar = useDesfazer();
  const [regras, setRegras] = useState<Regra[]>([]);
  const [f, setF] = useState(vazioBloq);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const carregar = useCallback(() => { api<Regra[]>(`/api/ambientes/${amb.id}/bloqueios/regras`).then(setRegras); }, [amb.id]);
  useEffect(carregar, [carregar]);

  const alt = (d: number) => setF((x) => ({ ...x, dias: x.dias.includes(d) ? x.dias.filter((y) => y !== d) : [...x.dias, d] }));
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErro(''); setAviso('');
    try {
      const r = await api<{ id: number; conflitos: number }>(`/api/ambientes/${amb.id}/bloqueios`, {
        body: { descricao: f.descricao, dias_semana: f.dias, hora_inicio: f.hora_inicio, hora_fim: f.hora_fim, data_inicio: f.data_inicio, data_fim: f.data_fim },
      });
      if (r.conflitos > 0) setAviso(`Atenção: ${r.conflitos} reserva(s) pendente(s)/aprovada(s) já existente(s) coincidem com esse horário. Elas não foram alteradas; peça à autoridade para cancelá-las se necessário.`);
      setF(vazioBloq); carregar();
    } catch (err) { setErro((err as Error).message); }
  };
  const del = async (r: Regra) => {
    if (!confirm(`Remover o horário ocupado "${r.descricao}"?`)) return;
    await api(`/api/ambientes/${amb.id}/bloqueios/${r.id}`, { method: 'DELETE' });
    registrar(`Horário ocupado "${r.descricao}" removido`, async () => {
      await api(`/api/ambientes/${amb.id}/bloqueios`, { body: { descricao: r.descricao, dias_semana: r.dias_semana, hora_inicio: r.hora_inicio, hora_fim: r.hora_fim, data_inicio: r.data_inicio, data_fim: r.data_fim } });
      carregar();
    });
    carregar();
  };

  return (
    <div className="bloco">
      <h4>Horários ocupados (aulas e usos fixos)</h4>
      <p className="muted small">Nesses horários o ambiente aparece como "Ocupado" na agenda e não aceita reservas.</p>
      {regras.length > 0 && (
        <ul className="lista-regras">
          {regras.map((r) => (
            <li key={r.id}>
              <b>{r.descricao}</b> — {r.dias_semana.map((d) => DIAS[d - 1]).join(', ')}, {r.hora_inicio}–{r.hora_fim},
              de {fmtData(r.data_inicio)} a {fmtData(r.data_fim)}
              <button className="btn btn-outline-danger" onClick={() => del(r)}>Remover</button>
            </li>
          ))}
        </ul>
      )}
      {regras.length === 0 && <p className="muted small">Nenhum horário ocupado cadastrado.</p>}
      <form className="form" onSubmit={add}>
        <label>Descrição<input required maxLength={120} placeholder="Ex.: Aula de Redes — Prof. Silva" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
        <div className="dias">
          {DIAS.map((n, i) => (
            <label key={n} className="dia"><input type="checkbox" checked={f.dias.includes(i + 1)} onChange={() => alt(i + 1)} /> {n}</label>
          ))}
        </div>
        <div className="row">
          <label>Início<input type="time" required value={f.hora_inicio} onChange={(e) => setF({ ...f, hora_inicio: e.target.value })} /></label>
          <label>Fim<input type="time" required value={f.hora_fim} onChange={(e) => setF({ ...f, hora_fim: e.target.value })} /></label>
        </div>
        <div className="row">
          <label>Vale a partir de<input type="date" required value={f.data_inicio} onChange={(e) => setF({ ...f, data_inicio: e.target.value })} /></label>
          <label>Até<input type="date" required value={f.data_fim} onChange={(e) => setF({ ...f, data_fim: e.target.value })} /></label>
        </div>
        {erro && <div className="alert alert-err">{erro}</div>}
        {aviso && <div className="alert alert-warn">{aviso}</div>}
        <div className="actions"><button className="btn btn-primary" disabled={f.dias.length === 0}>Adicionar horário ocupado</button></div>
      </form>
    </div>
  );
}

