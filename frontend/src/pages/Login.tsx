import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Cfg { googleClientId: string }
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
  const [erro, setErro] = useState('');
  const btn = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Cfg>('/api/config').then(setCfg).catch(() => setErro('Não foi possível falar com o servidor. O back-end está rodando?'));
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

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo-upe.png" alt="UPE — Campus Caruaru" className="login-logo" />
        <h1>Reserva de Ambientes</h1>
        <p className="muted">Reserve salas, laboratórios e demais ambientes da UPE Campus Caruaru. Acesso exclusivo para professores e funcionários, com a conta Google institucional.</p>
        {erro && <div className="alert alert-err">{erro}</div>}
        {cfg?.googleClientId && <div ref={btn} className="google-btn" />}
        {cfg && !cfg.googleClientId && <div className="alert alert-err">Login Google não configurado.</div>}
      </div>
    </div>
  );
}
