import { useState } from 'react';
import { api } from '../api';

export interface Tipo { id?: number; nome: string; cor: string }
const NOVO = '__novo__';

/**
 * Escolha do tipo de ambiente: só dá para SELECIONAR um tipo existente.
 * Para criar um tipo novo (com a cor dele) usa-se a opção "＋ Adicionar novo tipo…".
 */
export default function TipoSelect({ value, tipos, onChange, onAdicionar, required }: {
  value: string; tipos: Tipo[]; onChange: (nome: string) => void; onAdicionar: (t: Tipo) => void; required?: boolean;
}) {
  const [novo, setNovo] = useState<{ nome: string; cor: string } | null>(null);
  const [erro, setErro] = useState('');
  const criar = async () => {
    if (!novo) return; setErro('');
    try {
      const r = await api<{ id: number }>('/api/tipos', { body: novo });
      onAdicionar({ id: r.id, nome: novo.nome.trim(), cor: novo.cor.toLowerCase() });
      onChange(novo.nome.trim()); setNovo(null);
    } catch (e) { setErro((e as Error).message); }
  };
  return (
    <>
      <select required={required} value={novo ? NOVO : value} onChange={(e) => {
        if (e.target.value === NOVO) { setNovo({ nome: '', cor: '#cfe3ff' }); setErro(''); } else { setNovo(null); onChange(e.target.value); }
      }}>
        {!value && <option value="">Escolha o tipo…</option>}
        {tipos.map((t) => <option key={t.nome} value={t.nome}>{t.nome}</option>)}
        <option value={NOVO}>＋ Adicionar novo tipo…</option>
      </select>
      {novo && (
        <div className="tipo-novo">
          <input autoFocus placeholder="Nome do novo tipo" maxLength={40} value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criar(); } }} />
          <label className="cor-campo">Cor no mapa <input type="color" value={novo.cor} onChange={(e) => setNovo({ ...novo, cor: e.target.value })} /></label>
          <div className="inline-form">
            <button type="button" className="btn btn-primary" disabled={!novo.nome.trim()} onClick={criar}>Adicionar</button>
            <button type="button" className="btn btn-outline" onClick={() => { setNovo(null); setErro(''); }}>Cancelar</button>
          </div>
          {erro && <div className="alert alert-err">{erro}</div>}
        </div>
      )}
    </>
  );
}
