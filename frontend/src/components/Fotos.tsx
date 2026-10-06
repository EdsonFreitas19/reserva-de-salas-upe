import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { api, apiUpload } from '../api';
import { useDesfazer, useMe } from '../App';

interface Foto { id: number }

/** Reduz a foto no navegador (lado maior 1600 px, JPEG) antes de enviar: upload rápido e pouco espaço no servidor. */
async function reduzir(file: File): Promise<Blob> {
  const img = await createImageBitmap(file).catch(() => { throw new Error(`"${file.name}" não é uma imagem que o navegador consiga abrir (use JPG, PNG ou WebP)`); });
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Falha ao preparar a imagem'))), 'image/jpeg', 0.85));
}

// Fotos do ambiente: todos veem; só o administrador anexa e remove.
export default function Fotos({ ambienteId }: { ambienteId: number }) {
  const { me } = useMe();
  const registrar = useDesfazer();
  const admin = me.papeis.includes('ADMIN');
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [aberta, setAberta] = useState<number | null>(null); // índice na lista
  const [msg, setMsg] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => { api<Foto[]>(`/api/ambientes/${ambienteId}/fotos`).then(setFotos).catch(() => setFotos([])); }, [ambienteId]);
  useEffect(carregar, [carregar]);

  useEffect(() => {
    if (aberta === null) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberta(null);
      if (e.key === 'ArrowRight') setAberta((i) => (i === null ? i : (i + 1) % fotos.length));
      if (e.key === 'ArrowLeft') setAberta((i) => (i === null ? i : (i - 1 + fotos.length) % fotos.length));
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aberta, fotos.length]);

  const enviar = async (e: ChangeEvent<HTMLInputElement>) => {
    const arquivos = [...(e.target.files ?? [])]; e.target.value = '';
    if (!arquivos.length) return;
    setMsg(''); setEnviando(true);
    try { for (const f of arquivos) await apiUpload(`/api/ambientes/${ambienteId}/fotos`, await reduzir(f)); }
    catch (err) { setMsg((err as Error).message); }
    finally { setEnviando(false); carregar(); }
  };
  const remover = async (f: Foto) => {
    if (!confirm('Remover esta foto?')) return;
    setMsg('');
    try {
      const copia = await (await fetch(`/api/fotos/${f.id}`, { credentials: 'same-origin' })).blob(); // guarda a imagem para poder desfazer
      await api(`/api/fotos/${f.id}`, { method: 'DELETE' });
      registrar('Foto removida', async () => { await apiUpload(`/api/ambientes/${ambienteId}/fotos`, copia); carregar(); });
      setAberta(null); carregar();
    }
    catch (err) { setMsg((err as Error).message); }
  };

  if (!admin && fotos.length === 0) return null;
  return (
    <section className="fotos">
      <div className="fotos-head">
        <h3>Fotos do ambiente</h3>
        {admin && (
          <label className={`btn btn-outline${enviando ? ' disabled' : ''}`}>
            {enviando ? 'Enviando…' : '＋ Anexar fotos'}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={enviando} onChange={enviar} />
          </label>
        )}
      </div>
      {msg && <div className="alert alert-err">{msg}</div>}
      {fotos.length === 0 && <p className="muted small">Nenhuma foto ainda. Anexe fotos para os usuários verem como é o ambiente (até 10).</p>}
      <div className="fotos-grid">
        {fotos.map((f, i) => (
          <div className="foto" key={f.id}>
            <button className="foto-img" onClick={() => setAberta(i)} title="Ampliar">
              <img src={`/api/fotos/${f.id}`} alt={`Foto ${i + 1} do ambiente`} loading="lazy" />
            </button>
            {admin && <button className="foto-x" title="Remover foto" onClick={() => remover(f)}>×</button>}
          </div>
        ))}
      </div>
      {aberta !== null && fotos[aberta] && (
        <div className="modal" onClick={() => setAberta(null)} role="dialog" aria-label="Foto ampliada">
          <img src={`/api/fotos/${fotos[aberta].id}`} alt="" onClick={(e) => e.stopPropagation()} />
          {fotos.length > 1 && <>
            <button className="modal-nav prev" onClick={(e) => { e.stopPropagation(); setAberta((aberta - 1 + fotos.length) % fotos.length); }} aria-label="Anterior">‹</button>
            <button className="modal-nav next" onClick={(e) => { e.stopPropagation(); setAberta((aberta + 1) % fotos.length); }} aria-label="Próxima">›</button>
          </>}
          <button className="modal-close" onClick={() => setAberta(null)} aria-label="Fechar">×</button>
          <span className="modal-count">{aberta + 1} / {fotos.length}</span>
        </div>
      )}
    </section>
  );
}
