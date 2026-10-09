import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api, Me } from './api';
import Login from './pages/Login';
import Informacoes from './pages/Informacoes';
import AmbienteAgenda from './pages/AmbienteAgenda';
import MinhasReservas from './pages/MinhasReservas';
import Aprovacoes from './pages/Aprovacoes';
import Admin from './pages/Admin';
import Mapa from './pages/Mapa';
import Notificacoes from './pages/Notificacoes';

const MeCtx = createContext<{ me: Me; refresh: () => void }>(null as never);
export const useMe = () => useContext(MeCtx);

/**
 * Desfazer (Ctrl+Z) para ações que dá para reverter: depois de remover um responsável, um usuário, uma foto, etc.
 * aparece um aviso com o botão "Desfazer" e o Ctrl+Z também funciona. (Aprovar, recusar e cancelar reservas NÃO
 * entram aqui: já geraram avisos e histórico, que não podem ser apagados.)
 */
type Desfazer = { rotulo: string; fn: () => Promise<void> };
const UndoCtx = createContext<(rotulo: string, fn: () => Promise<void>) => void>(() => undefined);
export const useDesfazer = () => useContext(UndoCtx);

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const loc = useLocation();
  const [ultima, setUltima] = useState<Desfazer | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const ultimaRef = useRef<Desfazer | null>(null);
  const registrar = useCallback((rotulo: string, fn: () => Promise<void>) => { const d = { rotulo, fn }; ultimaRef.current = d; setUltima(d); setAviso(null); }, []);
  const desfazer = useCallback(async () => {
    const d = ultimaRef.current; if (!d) return;
    ultimaRef.current = null; setUltima(null);
    try { await d.fn(); setAviso('Desfeito.'); } catch (e) { setAviso(`Não foi possível desfazer: ${(e as Error).message}`); }
  }, []);
  useEffect(() => { // some sozinho depois de 10 s
    if (!ultima && !aviso) return;
    const t = setTimeout(() => { if (ultimaRef.current === ultima) { ultimaRef.current = null; setUltima(null); } setAviso(null); }, ultima ? 10000 : 4000);
    return () => clearTimeout(t);
  }, [ultima, aviso]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return; // campos de texto têm o próprio Ctrl+Z
      if (document.body.dataset.undoLocal === '1') return; // o editor do mapa tem o histórico dele
      if (ultimaRef.current) { e.preventDefault(); desfazer(); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [desfazer]);

  const refresh = useCallback(() => {
    api<Me>('/api/me').then(setMe).catch(() => setMe(null));
  }, []);
  useEffect(refresh, [refresh, loc.pathname]);

  if (me === undefined) return <div className="loading">Carregando…</div>;
  if (me === null) return <Login onLogin={refresh} />;

  const sair = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); setMe(null); };

  return (
    <MeCtx.Provider value={{ me, refresh }}>
      <UndoCtx.Provider value={registrar}>
      <div className="topbar">
        <div className="container topbar-in">
          <span className="topbar-title">Sistema de Reserva de Ambientes</span>
          <span className="topbar-user">
            <NavLink to="/notificacoes" className="bell" title="Notificações">
              🔔{me.naoLidas > 0 && <b>{me.naoLidas}</b>}
            </NavLink>
            <span className="user-name">{me.nome}</span>
            {me.responsavelPor.length > 0 && (
              <span className="user-role" title={`Responsável por: ${me.responsavelPor.map((a) => a.nome).join(', ')}`}>
                Responsável por {me.responsavelPor.length} ambiente{me.responsavelPor.length > 1 ? 's' : ''}
              </span>
            )}
            <button className="link-btn" onClick={sair}>Sair</button>
          </span>
        </div>
      </div>
      <header className="navbar">
        <div className="container navbar-in">
          <img src="/logo-upe.png" alt="UPE — Universidade de Pernambuco, Campus Caruaru" className="logo" />
          <nav>
            <NavLink to="/" end>Reserva</NavLink>
            <NavLink to="/minhas">Minhas reservas</NavLink>
            <NavLink to="/aprovacoes">Aprovações</NavLink>
            {me.papeis.includes('ADMIN') && <NavLink to="/admin">Administração</NavLink>}
            <NavLink to="/informacoes">Informações</NavLink>
          </nav>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Mapa />} />
          <Route path="/mapa" element={<Navigate to={`/${loc.search}`} replace />} />
          <Route path="/informacoes" element={<Informacoes />} />
          <Route path="/ambientes/:id" element={<AmbienteAgenda />} />
          <Route path="/minhas" element={<MinhasReservas />} />
          <Route path="/aprovacoes" element={<Aprovacoes />} />
          <Route path="/admin" element={me.papeis.includes('ADMIN') ? <Admin /> : <Navigate to="/" />} />
          <Route path="/notificacoes" element={<Notificacoes />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <footer className="footer">Universidade de Pernambuco — Campus Caruaru</footer>
      {(ultima || aviso) && (
        <div className="toast" role="status">
          <span>{aviso ?? ultima!.rotulo}</span>
          {ultima && !aviso && <button onClick={desfazer}>Desfazer <small>Ctrl+Z</small></button>}
        </div>
      )}
      </UndoCtx.Provider>
    </MeCtx.Provider>
  );
}
