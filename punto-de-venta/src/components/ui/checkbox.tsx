import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 16×16, radio 4, borde gray-300; marcado sky-600. */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-4 shrink-0 rounded border border-gray-300 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-sky-600 data-[state=checked]:bg-sky-600 data-[state=checked]:text-white',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <Check className="size-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

/** Checkbox + etiqueta + descripción opcional (formularios de producto). */
export function CheckboxField({ id, label, description, ...props }: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { id: string; label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={id} className="mt-0.5" {...props} />
      <div>
        <label htmlFor={id} className="text-sm text-gray-900">
          {label}
        </label>
        {description && <p className="text-xs text-gray-500">{description}</p>}
      </div>
    </div>
  );
}
