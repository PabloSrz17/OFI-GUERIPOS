import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  /**
   * "pill": contenedor gris con opción activa blanca y sombra (Venta | Pedido, Cantidad ($) | Porcentaje (%), Todos | Entradas | Salidas).
   * "outline": botones separados con anillo; el activo con anillo sky-600 (Tipo: Producto | Servicio).
   */
  variant?: 'pill' | 'outline';
  fullWidth?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Segmented<T extends string>({ value, onChange, options, variant = 'pill', fullWidth, className, ...aria }: SegmentedProps<T>) {
  if (variant === 'outline') {
    return (
      <div role="radiogroup" aria-label={aria['aria-label']} className={cn('flex gap-2', className)}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={cn(
                'inline-flex h-control items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                active ? 'ring-2 ring-sky-600' : 'ring-1 ring-gray-300 hover:bg-gray-50',
              )}
            >
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label={aria['aria-label']} className={cn('inline-flex rounded-lg bg-gray-100 p-1', fullWidth && 'flex w-full', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&_svg]:size-4',
              fullWidth && 'flex-1',
              active ? 'bg-white text-gray-900 shadow-card' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
