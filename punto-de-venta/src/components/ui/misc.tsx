import * as React from 'react';
import { cn } from '@/lib/utils';

/** Tecla de atajo (Ctrl, Shift, K…) como en el POS. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-gray-300 bg-white px-1 font-sans text-xs font-normal text-gray-600', className)}
      {...props}
    />
  );
}

export function Shortcut({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}

/** Chip de alternancia de los modales de filtros (Producto / Servicio / Kit…). */
export function ToggleChip({ active, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-control items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
        active ? 'border-sky-600 bg-sky-50 text-sky-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
        className,
      )}
      {...props}
    />
  );
}

/** Pestañas tipo pill con contador (Todas · Pagos Pendientes 130 · No Entregadas 166). */
export function PillTabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string; count?: number }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex flex-wrap gap-1', className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
              active ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-gray-600 ring-1 ring-gray-200">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Miniatura de producto 40×40 con placeholder. */
export function Thumb({ src, alt = '', size = 40, className }: { src?: string; alt?: string; size?: number; className?: string }) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-white text-gray-400', className)}
    >
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <svg viewBox="0 0 24 24" className="size-1/2" fill="currentColor" aria-hidden="true">
          <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm4 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM6 18h12l-4-5.5-3 4-2-2.5L6 18Z" />
        </svg>
      )}
    </span>
  );
}

/** Estado vacío centrado (título Manrope + texto + acciones). */
export function EmptyState({ title, description, actions, className, muted }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string; muted?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <h3 className={cn('font-display text-xl font-extrabold', muted ? 'text-gray-400' : 'text-gray-900')}>{title}</h3>
      {description && <p className="mt-2 max-w-md text-sm text-gray-500">{description}</p>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}
