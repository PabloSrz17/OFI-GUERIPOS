import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Anchos observados: listas a todo el ancho con 24px de margen; detalle y formularios centrados ≈ 912px;
 * dashboard centrado ≈ 910px.
 */
export function Page({ width = 'full', className, children }: { width?: 'full' | 'narrow'; className?: string; children: React.ReactNode }) {
  return <div className={cn('px-6 pb-10', width === 'narrow' && 'mx-auto max-w-[960px]', className)}>{children}</div>;
}

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: boolean | string;
  className?: string;
}

/** Título (Manrope 20/700) a la izquierda, acciones a la derecha; botón ← cuadrado de 44px opcional. */
export function PageHeader({ title, description, actions, back, className }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-4 py-6', className)}>
      <div className="flex min-w-0 items-center gap-4">
        {back && (
          <Button variant="secondary" size="back" aria-label="Regresar" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}>
            <ArrowLeft />
          </Button>
        )}
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold text-gray-900">{title}</h2>
          {description && <p className="mt-1 max-w-md text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-4">{actions}</div>}
    </div>
  );
}

/** Barra inferior fija de los formularios de página completa (Cancelar · Guardar Borrador · Primario). */
export function StickyFooter({ children }: { children: React.ReactNode }) {
  return <div className="sticky bottom-0 z-10 -mx-6 mt-8 flex justify-end gap-4 border-t border-gray-200 bg-white px-6 py-4">{children}</div>;
}

/** Barra inferior fija a todo el ancho del main, con los botones alineados al contenido centrado (editor de producto). */
export function PageFooterBar({ children, width = 'narrow' }: { children: React.ReactNode; width?: 'full' | 'narrow' }) {
  return (
    <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white py-4">
      <div className={cn('flex justify-end gap-4 px-6', width === 'narrow' && 'mx-auto max-w-[960px]')}>{children}</div>
    </div>
  );
}
