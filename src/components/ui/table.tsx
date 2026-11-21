import * as React from 'react';
import { cn } from '@/lib/utils';

/** Contenedor: radio 8 + ring gray-200, scroll horizontal; thead gray-50; filas divididas por gray-200. */
export function Table({ className, wrapperClassName, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-lg ring-1 ring-gray-200', wrapperClassName)}>
      <table className={cn('min-w-full divide-y divide-gray-200', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-gray-50', className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-gray-200 bg-white', className)} {...props} />;
}

export function TR({ className, interactive, ...props }: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return <tr className={cn(interactive && 'hover:bg-gray-50', className)} {...props} />;
}

type Align = 'left' | 'center' | 'right';
const alignClass: Record<Align, string> = { left: 'text-left', center: 'text-center', right: 'text-right' };

export function TH({ className, align = 'left', ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return <th scope="col" className={cn('whitespace-nowrap px-3 py-3.5 text-sm font-semibold text-gray-900', alignClass[align], className)} {...props} />;
}

export function TD({ className, align = 'left', ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return <td className={cn('px-3 py-4 text-sm text-gray-500', alignClass[align], className)} {...props} />;
}

/** Fila de totales (reportes): fondo gray-50. */
export function TotalRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('bg-gray-50 [&>td]:text-gray-700', className)} {...props} />;
}
