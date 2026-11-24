import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  /** Texto fijo en el botón en lugar del valor elegido (p. ej. "Ordenar"). */
  triggerLabel?: string;
  className?: string;
  'aria-label'?: string;
  id?: string;
}

/**
 * Listbox con aspecto de botón secundario y chevron (Ordenar ▾, Últimos 7 días ▾, Motivo del Ajuste).
 * Opción seleccionada con ✓ a la derecha.
 */
export function Select({ value, defaultValue, onValueChange, options, placeholder, icon, triggerLabel, className, id, ...aria }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={aria['aria-label']}
        className={cn(
          'inline-flex h-control items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 hover:bg-gray-50 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 data-[placeholder]:text-gray-500 [&_svg]:size-4',
          className,
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {icon && <span className="text-gray-700">{icon}</span>}
          {triggerLabel ? <span>{triggerLabel}</span> : <SelectPrimitive.Value placeholder={placeholder} />}
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="text-gray-500" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center py-2 pl-3 pr-9 text-sm text-gray-900 outline-none data-[highlighted]:bg-gray-50"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-3 text-sky-600">
                  <Check className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
