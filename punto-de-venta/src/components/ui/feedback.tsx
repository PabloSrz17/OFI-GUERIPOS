import * as React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from './button';
import { Dialog, DialogClose, DialogContent } from './dialog';
import { cn } from '@/lib/utils';

// ---------- Avisos (diseño propio: en Pulpos no se registró el aviso tras guardar) ----------

type Toast = { id: number; tone: 'success' | 'error'; text: string };
const ToastContext = React.createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="pointer-events-auto flex items-center gap-3 rounded-lg bg-white px-4 py-3 text-sm font-medium text-gray-900 shadow-lg ring-1 ring-black/5">
            {t.tone === 'success' ? <CheckCircle2 className="size-5 text-green-500" /> : <XCircle className="size-5 text-red-500" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = React.useContext(ToastContext);
  return React.useMemo(
    () => ({
      success: (text: string) => push({ tone: 'success', text }),
      error: (err: unknown) => push({ tone: 'error', text: err instanceof Error ? err.message : String(err) }),
    }),
    [push],
  );
}

// ---------- Confirmación ----------

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void | Promise<void>;
}

/** Modal chico de confirmación, con el mismo esqueleto que "Tienes cambios sin guardar". */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel = 'Cancelar', tone = 'danger', onConfirm }: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        size="sm"
        footer={
          <>
            <DialogClose asChild>
              <Button>{cancelLabel}</Button>
            </DialogClose>
            <Button
              variant={tone}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  onOpenChange(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className={cn('text-sm text-gray-600')}>{description}</div>
      </DialogContent>
    </Dialog>
  );
}
