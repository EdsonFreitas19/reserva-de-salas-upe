import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Fotos from '../components/Fotos';
import { Ambiente, api, fmtHora, rotuloStatus, Status } from '../api';

interface Item { id: number; inicio: string; fim: string; status: Status; finalidade: string; solicitante_nome: string }
interface Ocupado { id: number; inicio: string; fim: string; descricao: string }
interface Bloco { chave: string; inicio: string; fim: string; classe: string; titulo: string; detalhe: string; dica: string }

const DURACAO_MAXIMA_H = 4; // igual ao limite do servidor
const segunda = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const soma = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const proximoDiaUtil = (d: Date) => { const x = new Date(d); while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1); return x; };
const minutos = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// RF04 (agenda da semana: reservas + horários ocupados) + RF05 (solicitar reserva)
export default function AmbienteAgenda() {
  const { id } = useParams();
  const [amb, setAmb] = useState<Ambiente | null>(null);
  const [semana, setSemana] = useState(() => segunda(new Date()));
  const [reservas, setReservas] = useState<Item[]>([]);
  const [ocupados, setOcupados] = useState<Ocupado[]>([]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
  const [f, setF] = useState(() => ({ data: ymd(proximoDiaUtil(new Date())), ini: '08:00', fim: '10:00', finalidade: '' }));
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { api<Ambiente[]>('/api/ambientes').then((l) => setAmb(l.find((a) => a.id === Number(id)) ?? null)); }, [id]);

  const carregar = useCallback(() => {
    const q = `de=${encodeURIComponent(semana.toISOString())}&ate=${encodeURIComponent(soma(semana, 7).toISOString())}`;
    Promise.all([api<Item[]>(`/api/ambientes/${id}/reservas?${q}`), api<Ocupado[]>(`/api/ambientes/${id}/bloqueios?${q}`)])
      .then(([r, o]) => { setReservas(r); setOcupados(o); })
      .catch((e) => setMsg({ tipo: 'err', texto: e.message }));
  }, [id, semana]);
  useEffect(carregar, [carregar]);

  const dias = useMemo(() => Array.from({ length: 5 }, (_, i) => soma(semana, i)), [semana]); // só segunda a sexta

  const blocos: Bloco[] = useMemo(() => [
    ...reservas.map((i): Bloco => ({
      chave: `r${i.id}`, inicio: i.inicio, fim: i.fim, classe: `slot-${i.status.toLowerCase()}`,
      titulo: rotuloStatus[i.status], detalhe: i.finalidade, dica: `${i.finalidade} — ${i.solicitante_nome}`,
    })),
    ...ocupados.map((o): Bloco => ({
      chave: `o${o.id}-${o.inicio}`, inicio: o.inicio, fim: o.fim, classe: 'slot-ocupado',
      titulo: 'Ocupado', detalhe: o.descricao, dica: o.descricao,
    })),
  ].sort((a, b) => a.inicio.localeCompare(b.inicio)), [reservas, ocupados]);

  // Avisos antes de enviar (o servidor valida de novo)
  const dow = new Date(`${f.data}T12:00`).getDay();
  const duracao = minutos(f.fim) - minutos(f.ini);
  const aviso = dow === 0 || dow === 6 ? 'Reservas só podem ser feitas de segunda a sexta-feira.'
    : duracao <= 0 ? 'O horário final deve ser depois do inicial.'
    : duracao > DURACAO_MAXIMA_H * 60 ? `A duração máxima é de ${DURACAO_MAXIMA_H} horas.` : '';

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null); setEnviando(true);
    try {
      await api('/api/reservas', { body: {
        ambiente_id: Number(id),
        inicio: new Date(`${f.data}T${f.ini}`).toISOString(),
        fim: new Date(`${f.data}T${f.fim}`).toISOString(),
        finalidade: f.finalidade,
      } });
      setMsg({ tipo: 'ok', texto: 'Solicitação enviada! Acompanhe em "Minhas reservas".' });
      setF({ ...f, finalidade: '' });
      carregar();
    } catch (err) { setMsg({ tipo: 'err', texto: (err as Error).message }); }
    finally { setEnviando(false); }
  };

  if (!amb) return <p className="muted">Carregando…</p>;
  const semResponsavel = amb.autoridades.length === 0;

  return (
    <>
      <p><Link to="/">← Ambientes</Link></p>
      <h1 className="page-title">{amb.nome}</h1>
      <p className="muted">{amb.tipo}{amb.localizacao ? ` · ${amb.localizacao}` : ''}{amb.capacidade ? ` · até ${amb.capacidade} pessoas` : ''}</p>
      <p className="small"><Link to={`/mapa?sala=${amb.id}`}>📍 Ver no mapa</Link></p>
      <Fotos ambienteId={amb.id} />
      {semResponsavel
        ? <div className="alert alert-warn">Este ambiente ainda não tem um responsável para aprovar reservas, então ainda não é possível solicitar. Fale com o administrador.</div>
        : <p className="small">{amb.autoridades.length > 1 ? 'Responsáveis pela aprovação' : 'Responsável pela aprovação'}: <b>{amb.autoridades.map((r) => r.nome).join(', ')}</b></p>}

      <div className="two-col">
        <section>
          <div className="week-nav">
            <button className="btn btn-outline" onClick={() => setSemana(soma(semana, -7))}>‹ Anterior</button>
            <strong>{semana.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – {soma(semana, 4).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
            <button className="btn btn-outline" onClick={() => setSemana(soma(semana, 7))}>Próxima ›</button>
          </div>
          <div className="week">
            {dias.map((d) => {
              const doDia = blocos.filter((b) => ymd(new Date(b.inicio)) === ymd(d));
              return (
                <div className="day" key={ymd(d)}>
                  <button className="day-head" onClick={() => setF({ ...f, data: ymd(d) })} title="Usar esta data no formulário">
                    {d.toLocaleDateString('pt-BR', { weekday: 'short' })} <b>{d.getDate()}</b>
                  </button>
                  {doDia.length === 0 && <span className="free">livre</span>}
                  {doDia.map((b) => (
                    <div key={b.chave} className={`slot ${b.classe}`} title={b.dica}>
                      <b>{fmtHora(b.inicio)}–{fmtHora(b.fim)}</b>
                      <span>{b.titulo}</span>
                      <small>{b.detalhe}</small>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="muted small legend">
            <span className="dot dot-aprovada" /> Aprovada
            <span className="dot dot-pendente" /> Pendente (aguardando decisão)
            <span className="dot dot-ocupado" /> Ocupado (aulas e outros usos fixos)
          </p>
        </section>

        <section className="card">
          <h3>Solicitar reserva</h3>
          <p className="muted small">De segunda a sexta, no mesmo dia, com no máximo {DURACAO_MAXIMA_H} horas. Fora dos horários marcados como ocupados.</p>
          <form onSubmit={enviar} className="form">
            <label>Data<input type="date" required value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></label>
            <div className="row">
              <label>Início<input type="time" required value={f.ini} onChange={(e) => setF({ ...f, ini: e.target.value })} /></label>
              <label>Fim<input type="time" required value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} /></label>
            </div>
            <label>Finalidade
              <textarea required minLength={3} maxLength={300} rows={3} value={f.finalidade}
                placeholder="Ex.: Aula de Banco de Dados" onChange={(e) => setF({ ...f, finalidade: e.target.value })} />
            </label>
            {aviso && <div className="alert alert-warn">{aviso}</div>}
            {msg && <div className={`alert alert-${msg.tipo}`}>{msg.texto}</div>}
            <button className="btn btn-primary" disabled={enviando || semResponsavel || !!aviso}>{enviando ? 'Enviando…' : 'Enviar solicitação'}</button>
          </form>
        </section>
      </div>
    </>
  );
}
