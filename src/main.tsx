import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { DbProvider } from './db/hooks';
import { getDb, LoginRequired } from './db/client';
import { LoginPage } from './pages/LoginPage';
import { ToastProvider } from './components/ui/feedback';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DbProvider open={getDb} fallback={(e) => (e instanceof LoginRequired ? <LoginPage auth={e.auth} /> : null)}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DbProvider>
  </React.StrictMode>,
);
