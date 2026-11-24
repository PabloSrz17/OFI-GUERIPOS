import * as React from 'react';
import type { Database, Tx } from './database';

const DbContext = React.createContext<Database | null>(null);

/** Abre la base local antes de mostrar la app; si falla, lo dice en pantalla en lugar de trabajar sin datos. */
export function DbProvider({ open, fallback, children }: { open: () => Promise<Database>; fallback?: (error: unknown) => React.ReactNode; children: React.ReactNode }) {
  const [db, setDb] = React.useState<Database | null>(null);
  const [failure, setFailure] = React.useState<{ error: unknown } | null>(null);
  React.useEffect(() => {
    open().then(setDb, (e: unknown) => setFailure({ error: e }));
  }, [open]);
  const custom = failure && fallback?.(failure.error);
  if (custom) return <>{custom}</>;
  const error = failure && (failure.error instanceof Error ? failure.error.message : String(failure.error));
  if (error)
    return (
      <div role="alert" className="flex h-screen flex-col items-center justify-center gap-2 bg-gray-100 text-center">
        <h1 className="font-display text-xl font-bold text-gray-900">No se pudo abrir la base de datos local</h1>
        <p className="max-w-md text-sm text-gray-500">{error}</p>
      </div>
    );
  if (!db) return <div className="h-screen bg-gray-100" aria-busy="true" />;
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb() {
  const db = React.useContext(DbContext);
  if (!db) throw new Error('useDb fuera de DbProvider');
  return db;
}

/**
 * Consulta que se vuelve a ejecutar cuando cambian sus dependencias o cuando se confirma cualquier transacción.
 * Devuelve `undefined` mientras carga la primera vez (conserva el último resultado en recargas).
 */
export function useLiveQuery<T>(fn: (q: Tx) => T, deps: React.DependencyList): T | undefined {
  const db = useDb();
  const [state, setState] = React.useState<{ value: T } | undefined>(undefined);
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => db.subscribe(() => setVersion((v) => v + 1)), [db]);
  React.useEffect(() => {
    let alive = true;
    db.read(fn).then((value) => alive && setState({ value }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, ...deps]);
  return state?.value;
}
