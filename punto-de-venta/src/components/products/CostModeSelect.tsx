import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import type { CostMode } from '@/domain/catalog';

/** Selector "neto ▾ / bruto" en línea con el label "Costo", texto sky. */
export function CostModeSelect({ value, onChange }: { value: CostMode; onChange: (v: CostMode) => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="inline-flex items-center gap-1 rounded text-sm font-medium text-sky-500 hover:text-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" aria-label={`Tipo de costo: ${value}`}>
        {value}
        <ChevronDown className="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className="z-50 min-w-32 rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5">
          {(['neto', 'bruto'] as const).map((m) => (
            <DropdownMenu.Item key={m} onSelect={() => onChange(m)} className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2 text-sm text-gray-900 outline-none data-[highlighted]:bg-gray-50">
              {m}
              {m === value && <Check className="size-4 text-sky-600" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
