import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { DbProvider } from './db/hooks';
import { getDb } from './db/client';
import { ToastProvider } from './components/ui/feedback';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DbProvider open={getDb}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DbProvider>
  </React.StrictMode>,
);
