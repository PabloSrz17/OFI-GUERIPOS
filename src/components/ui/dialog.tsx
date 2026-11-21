import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const sizes = { sm: 'max-w-md', md: 'max-w-[480px]', lg: 'max-w-[660px]', xl: 'max-w-3xl' } as const;

interface DialogContentProps extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: keyof typeof sizes;
  footer?: React.ReactNode;
  /** Franja fija entre el cuerpo y el pie ("Ir al Editor Completo"). */
  beforeFooter?: React.ReactNode;
  /** Cuerpo gris con tarjetas blancas (Crear Producto Rápido, Filtros) o blanco (Crear Categoría). */
  bodyTone?: 'white' | 'gray';
  bodyClassName?: string;
}

/**
 * Modal observado en Pulpos: encabezado (título 18/500 + ✕) con borde inferior,
 * cuerpo con scroll propio y pie con borde superior y botones a la derecha.
 */
export const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ title, description, size = 'md', footer, beforeFooter, bodyTone = 'white', bodyClassName, className, children, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-gray-500/75" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-white shadow-xl focus:outline-none',
          sizes[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-6">
          <div>
            <DialogPrimitive.Title className="text-lg font-medium text-gray-900">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-gray-500">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : ''}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" aria-label="Cerrar">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className={cn('flex-1 overflow-y-auto', bodyTone === 'gray' ? 'bg-gray-50 p-6' : 'px-6 py-6', bodyClassName)}>{children}</div>
        {beforeFooter && <div className="border-t border-gray-200 px-4 py-4">{beforeFooter}</div>}
        {footer && <div className="flex items-center justify-end gap-4 border-t border-gray-200 px-6 py-4">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
DialogContent.displayName = 'DialogContent';
