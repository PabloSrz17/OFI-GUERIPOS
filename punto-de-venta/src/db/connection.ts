import * as React from 'react';
import type { ConnectionStatus } from './sync-client';

/** Dónde viven los datos de esta ventana: en el navegador (modo local) o en el Servidor POS (D30). */
export interface ConnectionState {
  mode: 'local' | 'server';
  status: ConnectionStatus;
  /** Usuario con sesión en el Servidor POS (D33); en modo local no hay usuarios. */
  user?: string | null;
  /** Dirección de la Oficina Virtual cuando el POS corre dentro de ella (D37). */
  home?: string | null;
}

let state: ConnectionState = { mode: 'local', status: 'online' };
const listeners = new Set<() => void>();

export function setConnection(patch: Partial<ConnectionState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getConnection() {
  return state;
}

export function useConnection() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
