import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Cfg { googleClientId: string; devLogin: boolean }
declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, o: object) => void;
    } } };
  }
}

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [devUsers, setDevUsers] = useState<{ nome: string; email: string }[]>([]);
  const [erro, setErro] = useState('');
  const btn = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Cfg>('/api/config').then((c) => {
      setCfg(c);
      if (c.devLogin) api<{ nome: string; email: string }[]>('/api/auth/dev-users').then(setDevUsers).catch(() => {});
    }).catch(() => setErro('Não foi possível falar com o servidor. O back-end está rodando?'));
  }, []);

  // RF01: botão "Entrar com o Google" (Google Identity Services)
  useEffect(() => {
    if (!cfg?.googleClientId) return;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async ({ credential }) => {
          try { await api('/api/auth/google', { body: { credential } }); onLogin(); }
          catch (e) { setErro((e as Error).message); }
        },
      });
      if (btn.current) window.google?.accounts.id.renderButton(btn.current, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'pt-BR' });
    };
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, [cfg, onLogin]);

  const dev = async (email: string) => {
    try { await api('/api/auth/dev-login', { body: { email } }); onLogin(); }
    catch (e) { setErro((e as Error).message); }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo-upe.png" alt="UPE — Campus Caruaru" className="login-logo" />
        <h1>Reserva de Ambientes</h1>
        <p className="muted">Laboratórios, salas, auditório e LAMIE. Acesso para professores e funcionários autorizados — entre com sua conta Google institucional.</p>
        {erro && <div className="alert alert-err">{erro}</div>}
        {cfg?.googleClientId && <div ref={btn} className="google-btn" />}
        {cfg && !cfg.googleClientId && !cfg.devLogin && <div className="alert alert-err">Login Google não configurado.</div>}
        {cfg?.devLogin && (
          <div className="dev-box">
            <strong>Modo de desenvolvimento</strong>
            <p className="muted small">Entrar como usuário de teste (sem Google):</p>
            {devUsers.map((u) => (
              <button key={u.email} className="btn btn-outline btn-block" onClick={() => dev(u.email)}>
                {u.nome} <span className="muted small">({u.email})</span>
              </button>
            ))}
            {devUsers.length === 0 && <p className="muted small">Nenhum usuário de teste. Rode <code>npm run seed</code> no back-end.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
