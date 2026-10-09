import { PointerEvent as RPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ListaSalas from '../components/ListaSalas';
import TipoSelect from '../components/TipoSelect';
import { Ambiente, api, MapaArea, MapaDados } from '../api';
import { useMe } from '../App';

type Pt = [number, number];
const SNAP = 2;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
/** Texto branco em cores escuras, escuro em cores claras. */
const textoSobre = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? '#fff' : '#1c2b4a';
};
let proximoIdNovo = -1; // ids provisórios (negativos) das áreas desenhadas e ainda não salvas

// ---------- geometria ----------
const distSeg = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
const dentro = (p: Pt, poly: Pt[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
/** Ponto mais "para dentro" do polígono (onde cabe o texto) e a folga até a borda. */
function centroRotulo(poly: Pt[]): { x: number; y: number; folga: number } {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let melhor = { x: cx, y: cy, folga: 0, nota: -1 };
  for (let x = x0; x <= x1; x += 2) for (let y = y0; y <= y1; y += 2) {
    if (!dentro([x, y], poly)) continue;
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, distSeg([x, y], poly[i], poly[(i + 1) % poly.length]));
    const nota = d - 0.002 * Math.hypot(x - cx, y - cy); // empate => mais perto do meio
    if (nota > melhor.nota) melhor = { x, y, folga: d, nota };
  }
  return melhor;
}
function quebrar(texto: string, maxChars: number, maxLinhas = 3): string[] {
  const linhas: string[] = [];
  let atual = '';
  for (const w of texto.split(/\s+/)) {
    if (atual && (atual + ' ' + w).length > maxChars) { linhas.push(atual); atual = w; } else atual = atual ? atual + ' ' + w : w;
  }
  if (atual) linhas.push(atual);
  return linhas.slice(0, maxLinhas);
}
/** Mexe num vértice mantendo as arestas na horizontal/vertical (salas retangulares e em L continuam retas). */
function moverVertice(orig: Pt[], i: number, nx: number, ny: number): Pt[] {
  const p = orig.map((q) => [...q] as Pt);
  p[i] = [nx, ny];
  for (const j of [(i - 1 + orig.length) % orig.length, (i + 1) % orig.length]) {
    if (orig[j][0] === orig[i][0]) p[j][0] = nx;
    else if (orig[j][1] === orig[i][1]) p[j][1] = ny;
  }
  return p;
}

type Arraste =
  | { tipo: 'mover'; id: number; x: number; y: number; orig: Pt[]; chave: string; moveu?: boolean }
  | { tipo: 'vertice'; id: number; i: number; orig: Pt[]; chave: string; moveu?: boolean }
  | { tipo: 'nova'; x: number; y: number; id?: number; chave: string };
let contaArrastes = 0;
const novaChave = () => `arraste-${++contaArrastes}`;
/** O que importa para saber se o mapa mudou em relação ao servidor. */
const semCor = (a: MapaArea) => a.tipo === 'Sem tipo' || (!a.ambiente_id && !a.criar_ambiente);
const chaveArea = (a: MapaArea) => [a.id, a.numero, a.rotulo, a.tipo, a.pontos, a.ambiente_id, !!a.criar_ambiente];

// Mapa 2D: todos clicam na sala para abrir a página dela; o administrador também edita as áreas.
export default function Mapa() {
  const { me } = useMe();
  const admin = me.papeis.includes('ADMIN');
  const nav = useNavigate();
  const [busca] = useSearchParams();
  const destaque = Number(busca.get('sala')) || null;
  const [dados, setDados] = useState<MapaDados | null>(null);      // como está salvo no servidor
  const [hist, setHist] = useState<MapaArea[][]>([]);                // rascunho do editor + histórico (Ctrl+Z / Ctrl+Y)
  const [pos, setPos] = useState(0);
  const [ambientes, setAmbientes] = useState<Ambiente[]>([]);
  const [edit, setEdit] = useState(false);
  const [modoNova, setModoNova] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
  const [passando, setPassando] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const arraste = useRef<Arraste | null>(null);
  const ultimaChave = useRef<{ chave: string; t: number } | null>(null);

  const areas = hist[pos] ?? dados?.areas ?? [];
  const area = areas.find((a) => a.id === sel) ?? null;
  const cores = useMemo(() => new Map((dados?.tipos ?? []).map((t) => [t.nome, t.cor])), [dados]);
  const corDe = (tipo: string) => cores.get(tipo) ?? '#eeeeee';
  const sujo = !!dados && JSON.stringify(areas.map(chaveArea)) !== JSON.stringify(dados.areas.map(chaveArea));

  const reiniciar = useCallback((d: MapaDados) => { setDados(d); setHist([d.areas]); setPos(0); ultimaChave.current = null; }, []);
  const carregar = useCallback(async () => {
    reiniciar(await api<MapaDados>('/api/mapa'));
    if (admin) setAmbientes(await api<Ambiente[]>('/api/ambientes?todos=1'));
  }, [admin, reiniciar]);
  useEffect(() => { carregar().catch((e) => setMsg({ tipo: 'err', texto: e.message })); }, [carregar]);

  /** Aplica uma mudança no rascunho. Mudanças seguidas com a mesma `chave` (um arraste, digitar num campo) viram UM passo do histórico. */
  const aplicar = useCallback((f: (as: MapaArea[]) => MapaArea[], chave?: string) => {
    const agora = Date.now();
    const junta = !!chave && ultimaChave.current?.chave === chave && (chave.startsWith('arraste') || agora - ultimaChave.current.t < 1500);
    ultimaChave.current = chave ? { chave, t: agora } : null;
    setHist((h) => {
      const atual = h[pos]; const prox = f(atual);
      return junta ? [...h.slice(0, pos), prox] : [...h.slice(0, pos + 1), prox];
    });
    if (!junta) setPos((p) => p + 1);
  }, [pos]);
  const mudarArea = (id: number, f: (a: MapaArea) => MapaArea, chave?: string) => aplicar((as) => as.map((a) => (a.id === id ? f(a) : a)), chave);

  const desfazer = useCallback(() => { ultimaChave.current = null; setPos((p) => Math.max(0, p - 1)); }, []);
  const refazer = useCallback(() => { ultimaChave.current = null; setPos((p) => Math.min(hist.length - 1, p + 1)); }, [hist.length]);

  // Ctrl+Z / Ctrl+Y no editor (vale até com o cursor nos campos do painel: o histórico do mapa inclui o que se digita lá)
  useEffect(() => {
    if (!edit) return;
    document.body.dataset.undoLocal = '1';
    const tecla = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
      const emCampo = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); desfazer(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); refazer(); }
      else if ((k === 'delete' || k === 'backspace') && sel !== null && !emCampo) { e.preventDefault(); aplicar((as) => as.filter((a) => a.id !== sel)); setSel(null); }
      else if (k === 'escape') { setSel(null); setModoNova(false); }
    };
    window.addEventListener('keydown', tecla);
    return () => { window.removeEventListener('keydown', tecla); delete document.body.dataset.undoLocal; };
  }, [edit, sel, desfazer, refazer, aplicar]);
  // avisa antes de fechar a página com alterações não salvas
  useEffect(() => {
    if (!sujo) return;
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [sujo]);

  // rótulos (posição e quebra de linhas) só são recalculados quando a forma muda
  const rotulos = useMemo(() => new Map(areas.map((a) => [a.id, centroRotulo(a.pontos)])), [areas]);

  const ponto = (e: { clientX: number; clientY: number }): Pt => {
    const s = svg.current!;
    const pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(s.getScreenCTM()!.inverse());
    return [snap(Math.max(0, Math.min(dados!.largura, p.x))), snap(Math.max(0, Math.min(dados!.altura, p.y)))];
  };
  const capturar = (e: RPointerEvent) => svg.current?.setPointerCapture(e.pointerId);

  const aoMover = (e: RPointerEvent) => {
    const a = arraste.current; if (!a || !dados) return;
    const [x, y] = ponto(e);
    if (a.tipo === 'mover') {
      const xs = a.orig.map((p) => p[0]), ys = a.orig.map((p) => p[1]);
      const dx = Math.max(-Math.min(...xs), Math.min(dados.largura - Math.max(...xs), x - a.x));
      const dy = Math.max(-Math.min(...ys), Math.min(dados.altura - Math.max(...ys), y - a.y));
      if (dx || dy || a.moveu) { a.moveu = true; mudarArea(a.id, (r) => ({ ...r, pontos: a.orig.map((p) => [p[0] + dx, p[1] + dy] as Pt) }), a.chave); }
    } else if (a.tipo === 'vertice') {
      a.moveu = true; mudarArea(a.id, (r) => ({ ...r, pontos: moverVertice(a.orig, a.i, x, y) }), a.chave);
    } else {
      const [x0, x1, y0, y1] = [Math.min(a.x, x), Math.max(a.x, x), Math.min(a.y, y), Math.max(a.y, y)];
      if (x1 - x0 < 4 && y1 - y0 < 4) return;
      const pontos: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      if (!a.id) {
        a.id = proximoIdNovo--;
        const nova: MapaArea = { id: a.id, numero: null, rotulo: 'Nova área', tipo: dados.tipos[0]?.nome ?? '', pontos, ambiente_id: null, ambiente_nome: null, ambiente_ativo: null, fotos: 0 };
        aplicar((as) => [...as, nova], a.chave); setSel(a.id);
      } else mudarArea(a.id, (r) => ({ ...r, pontos }), a.chave);
    }
  };
  const aoSoltar = () => {
    const a = arraste.current; arraste.current = null;
    if (!a) return;
    if (a.tipo === 'nova') {
      setModoNova(false);
      if (a.id) { // ficou pequena demais: desfaz o desenho
        const n = areas.find((r) => r.id === a.id);
        if (n) { const xs = n.pontos.map((p) => p[0]), ys = n.pontos.map((p) => p[1]); if (Math.max(...xs) - Math.min(...xs) < 10 || Math.max(...ys) - Math.min(...ys) < 10) { desfazer(); setSel(null); } }
      }
    }
    ultimaChave.current = null;
  };

  const clicarArea = (a: MapaArea) => {
    if (edit) { if (!modoNova) setSel(a.id); return; }
    if (a.ambiente_id && a.ambiente_ativo) nav(`/ambientes/${a.ambiente_id}`);
  };

  // ---------- ações do administrador ----------
  const falha = (e: unknown) => setMsg({ tipo: 'err', texto: (e as Error).message });
  const salvarTudo = async () => {
    setMsg(null);
    try {
      const corpo = { areas: areas.map((a) => ({ id: a.id > 0 ? a.id : undefined, numero: a.numero, rotulo: a.rotulo, tipo: a.tipo, pontos: a.pontos, ambiente_id: a.ambiente_id, criar_ambiente: a.criar_ambiente && !a.ambiente_id ? true : undefined })) };
      const d = await api<MapaDados>('/api/mapa', { method: 'PUT', body: corpo });
      reiniciar(d); setSel(null);
      if (admin) setAmbientes(await api<Ambiente[]>('/api/ambientes?todos=1'));
      setMsg({ tipo: 'ok', texto: 'Mapa salvo.' });
    } catch (e) { falha(e); }
  };
  const descartar = () => { if (!sujo || confirm('Descartar todas as alterações não salvas do mapa?')) { setHist(dados ? [dados.areas] : []); setPos(0); setSel(null); setMsg(null); } };
  const excluir = () => { if (area) { aplicar((as) => as.filter((a) => a.id !== area.id)); setSel(null); } };
  /** Recoloca no rascunho as áreas do desenho original que não existem mais (pelo número). Não mexe nas demais. */
  const restaurarAusentes = async () => {
    setMsg(null);
    try {
      const padrao = await api<{ numero: number; rotulo: string; tipo: string; pontos: Pt[] }[]>('/api/mapa/padrao');
      const faltam = padrao.filter((p) => !areas.some((a) => a.numero === p.numero));
      if (!faltam.length) { setMsg({ tipo: 'ok', texto: 'Nenhuma área ausente: o mapa já tem todas as áreas do desenho original.' }); return; }
      const usadosIds = new Set(areas.map((a) => a.ambiente_id).filter(Boolean));
      const novas: MapaArea[] = faltam.map((p) => {
        const amb = ambientes.find((x) => x.nome.toLowerCase() === p.rotulo.toLowerCase() && !usadosIds.has(x.id));
        if (amb) usadosIds.add(amb.id);
        return { id: proximoIdNovo--, numero: p.numero, rotulo: p.rotulo, tipo: amb?.tipo ?? p.tipo, pontos: p.pontos, ambiente_id: amb?.id ?? null, ambiente_nome: amb?.nome ?? null, ambiente_ativo: amb?.ativo ?? null, fotos: 0 };
      });
      aplicar((as) => [...as, ...novas]);
      setMsg({ tipo: 'ok', texto: `${novas.length} área(s) restaurada(s): ${novas.map((n) => n.rotulo).join(', ')}. Clique em “Salvar alterações” para gravar (ou Ctrl+Z para desfazer).` });
    } catch (e) { falha(e); }
  };
  const sair = () => {
    if (edit && sujo && !confirm('Há alterações não salvas no mapa. Sair mesmo assim?')) return;
    setEdit(!edit); setModoNova(false); setSel(null); setMsg(null);
    if (edit) { setHist(dados ? [dados.areas] : []); setPos(0); }
  };

  if (!dados) return <p className="muted">{msg ? msg.texto : 'Carregando…'}</p>;
  const usados = new Map(areas.filter((a) => a.ambiente_id).map((a) => [a.ambiente_id!, a.id]));

  return (
    <>
      <div className="card-head">
        <h1 className="page-title">Reserva de ambientes</h1>
        {admin && (
          <div className="inline-form">
            {edit && <>
              <button className="btn btn-outline" onClick={restaurarAusentes}>Restaurar áreas ausentes</button>
              <button className={`btn ${modoNova ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setModoNova(!modoNova); setSel(null); }}>＋ Nova área</button>
              <button className="btn btn-primary" disabled={!sujo} onClick={salvarTudo}>Salvar alterações</button>
              <button className="btn btn-outline" disabled={!sujo} onClick={descartar}>Descartar</button>
            </>}
            <button className={`btn ${edit ? 'btn-outline' : 'btn-outline'}`} onClick={sair}>{edit ? 'Concluir edição' : '✎ Editar mapa'}</button>
          </div>
        )}
      </div>
      <p className="muted small">
        {edit
          ? (modoNova ? 'Arraste sobre o mapa para desenhar a nova área.' : 'Clique numa área para editar; arraste para mover e use os pontos azuis para mudar o tamanho. Nada vale até clicar em “Salvar alterações”; Ctrl+Z desfaz.')
          : 'Clique numa sala do mapa ou escolha uma na lista abaixo para ver a agenda e solicitar a reserva.'}
      </p>
      {msg && <div className={`alert alert-${msg.tipo}`}>{msg.texto}</div>}

      <div className={edit ? 'mapa-layout' : undefined}>
        <div className="mapa-wrap">
          <svg ref={svg} className={`mapa${edit ? ' editando' : ''}${modoNova ? ' desenhando' : ''}`} viewBox={`0 0 ${dados.largura} ${dados.altura}`}
            onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar} role="img" aria-label="Mapa 2D do campus">
            <defs>
              <pattern id="sem-vinculo" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="#f4f4f4" /><line x1="0" y1="0" x2="0" y2="8" stroke="#d6d6d6" strokeWidth="3" />
              </pattern>
            </defs>
            <rect x="0" y="0" width={dados.largura} height={dados.altura} fill="#fff"
              onPointerDown={(e) => { if (edit && modoNova) { capturar(e); const [x, y] = ponto(e); arraste.current = { tipo: 'nova', x, y, chave: novaChave() }; } else if (edit) setSel(null); }} />
            {areas.map((a) => {
              const c = rotulos.get(a.id)!;
              const clicavel = !edit && !!a.ambiente_id && !!a.ambiente_ativo; // só ambiente ativo abre a agenda
              const nome = (a.ambiente_id ? a.ambiente_nome : null) ?? a.rotulo;
              const linhas = quebrar(nome, Math.max(4, Math.floor((2 * c.folga - 4) / 6.2)));
              const y0 = c.y - ((linhas.length * 12 + 15) / 2) + 12;
              // Só destaca ao passar o mouse quem é clicável (ou, no editor, qualquer área, para poder selecioná-la)
              const ativoHover = (passando === a.id && (clicavel || edit)) || (destaque === a.ambiente_id && !!destaque);
              return (
                <g key={a.id} className={`area${clicavel ? ' clicavel' : ''}${a.id === sel ? ' sel' : ''}${ativoHover ? ' hover' : ''}${destaque && destaque === a.ambiente_id ? ' pulsa' : ''}`}
                  onPointerEnter={() => setPassando(a.id)} onPointerLeave={() => setPassando(null)}
                  onClick={() => clicarArea(a)} tabIndex={clicavel ? 0 : undefined} role={clicavel ? 'link' : undefined}
                  onKeyDown={(e) => { if (e.key === 'Enter') clicarArea(a); }}>
                  <title>{!a.ambiente_id ? `${nome} — ainda sem ambiente cadastrado` : !a.ambiente_ativo && !edit ? `${nome} — indisponível para reserva` : `${nome} — ${a.tipo}${a.fotos ? ` · ${a.fotos} foto(s)` : ''}`}</title>
                  <polygon points={a.pontos.map((p) => p.join(',')).join(' ')} fill={!semCor(a) ? corDe(a.tipo) : 'url(#sem-vinculo)'}
                    onPointerDown={(e) => {
                      if (!edit) return;
                      e.stopPropagation(); capturar(e); const [x, y] = ponto(e);
                      if (modoNova) arraste.current = { tipo: 'nova', x, y, chave: novaChave() };
                      else { setSel(a.id); arraste.current = { tipo: 'mover', id: a.id, x, y, orig: a.pontos, chave: novaChave() }; }
                    }} />
                  <g className="rotulo" pointerEvents="none" style={{ ['--txt' as string]: !semCor(a) ? textoSobre(corDe(a.tipo)) : '#1c2b4a' }}>
                    {a.numero !== null && <text className="num" x={c.x} y={y0} textAnchor="middle">{a.numero}</text>}
                    {linhas.map((l, i) => <text key={i} className="nome" x={c.x} y={y0 + 13.5 + i * 12} textAnchor="middle">{l}</text>)}
                  </g>
                </g>
              );
            })}
            {/* Entradas/saídas do prédio: marcação fixa (não editável), nos dois vãos entre os blocos */}
            <g className="entrada" pointerEvents="none">
              {[70, 181].map((y) => (
                <g key={y}>
                  <text x="607" y={y - 11} textAnchor="middle" className="ent-seta">↔</text>
                  <text x="607" y={y + 4} textAnchor="middle" className="ent-txt">Entrada</text>
                  <text x="607" y={y + 16} textAnchor="middle" className="ent-txt">e saída</text>
                </g>
              ))}
            </g>
            {edit && area && area.pontos.map((p, i) => (
              <circle key={i} className="vertice" cx={p[0]} cy={p[1]} r="4.5"
                onPointerDown={(e) => { e.stopPropagation(); capturar(e); arraste.current = { tipo: 'vertice', id: area.id, i, orig: area.pontos, chave: novaChave() }; }} />
            ))}
          </svg>
          <ul className="legenda">
            {dados.tipos.filter((t) => t.nome !== 'Sem tipo').map((t) => <li key={t.nome}><span style={{ background: t.cor }} />{t.nome}</li>)}
            {areas.some(semCor) && <li><span className="hachura" />Sem tipo / sem ambiente cadastrado</li>}
          </ul>
        </div>

        {edit && (
          <aside className="card painel-area">
            {!area ? <p className="muted">Selecione uma área no mapa, ou use “＋ Nova área”.{sujo && <><br /><br /><b>Há alterações não salvas.</b></>}</p> : <>
              <h3>{area.id < 0 ? 'Nova área' : `Área ${area.numero ?? ''} — ${area.rotulo}`}</h3>
              <div className="form">
                <div className="row">
                  <label>Número<input type="number" min={0} max={999} value={area.numero ?? ''} onChange={(e) => mudarArea(area.id, (a) => ({ ...a, numero: e.target.value === '' ? null : Number(e.target.value) }), `num-${area.id}`)} /></label>
                  <label>Tipo
                    <TipoSelect value={area.tipo} tipos={dados.tipos} onChange={(t) => mudarArea(area.id, (a) => ({ ...a, tipo: t }))}
                      onAdicionar={(t) => setDados((d) => d && { ...d, tipos: [...d.tipos, t] })} />
                  </label>
                </div>
                <label>Nome da área<input value={area.rotulo} maxLength={80} onChange={(e) => mudarArea(area.id, (a) => ({ ...a, rotulo: e.target.value }), `nome-${area.id}`)} /></label>
                <label>Ambiente ligado a esta área
                  <select value={area.ambiente_id ?? ''} onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : null;
                    const amb = ambientes.find((x) => x.id === v);
                    mudarArea(area.id, (a) => ({ ...a, ambiente_id: v, criar_ambiente: v ? false : a.criar_ambiente, ambiente_nome: amb?.nome ?? null, tipo: amb?.tipo ?? a.tipo }));
                  }}>
                    <option value="">— nenhum —</option>
                    {ambientes.map((x) => {
                      const outra = usados.get(x.id);
                      return <option key={x.id} value={x.id} disabled={outra !== undefined && outra !== area.id}>
                        {x.nome}{x.ativo ? '' : ' (desativado)'}{outra !== undefined && outra !== area.id ? ' — já em outra área' : ''}
                      </option>;
                    })}
                  </select>
                </label>
                {!area.ambiente_id && (
                  <label className="dia"><input type="checkbox" checked={!!area.criar_ambiente} onChange={(e) => mudarArea(area.id, (a) => ({ ...a, criar_ambiente: e.target.checked }))} />
                    {' '}Criar o ambiente “{area.rotulo}” ao salvar
                  </label>
                )}
                <button type="button" className="btn btn-danger" onClick={excluir}>Excluir área</button>
                <p className="muted small">Mudanças só valem ao clicar em “Salvar alterações” (no alto). Ctrl+Z desfaz.{area.ambiente_id ? ' O tipo escolhido aqui vale também para o ambiente ligado.' : ''}</p>
              </div>
            </>}
          </aside>
        )}
      </div>

      {/* Salas para reservar (some no editor do mapa, para não poluir) */}
      {!edit && <ListaSalas cores={cores} onPassar={(id) => setPassando(id ? areas.find((a) => a.ambiente_id === id)?.id ?? null : null)} />}
    </>
  );
}
