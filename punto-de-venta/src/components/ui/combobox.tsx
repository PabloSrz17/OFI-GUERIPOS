import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Plus, X } from 'lucide-react';
import { inputClasses } from './input';
import { normalizeSearch } from '@/domain/catalog';
import { cn } from '@/lib/utils';

export interface ComboItem {
  id: string;
  name: string;
}

/** Elección: una opción existente, un nombre nuevo (se crea al guardar) o nada. */
export type ComboValue = { id: string; name: string } | { id: null; name: string } | null;

interface CreatableComboboxProps {
  id?: string;
  items: ComboItem[];
  value: ComboValue;
  onChange: (v: ComboValue) => void;
  placeholder: string;
  createLabel: string; // "Crear categoría"
  itemIcon?: React.ReactNode;
  /** Si no hay texto escrito, la opción "+ Crear…" abre este flujo (p. ej. el modal Crear Categoría). */
  onCreateEmpty?: () => void;
  'aria-label'?: string;
}

/**
 * Combobox "Buscar o crear" (E-category-combobox.png): la lista empieza con "+ Crear …" en sky-600
 * y sigue con las opciones filtradas por lo escrito. Teclado: ↑ ↓ Enter Escape.
 */
export function CreatableCombobox({ id, items, value, onChange, placeholder, createLabel, itemIcon, onCreateEmpty, ...aria }: CreatableComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(value?.name ?? '');
  const [active, setActive] = React.useState(0);
  const listId = React.useId();

  React.useEffect(() => setText(value?.name ?? ''), [value?.name]);

  const typed = text.trim();
  const isTyping = typed !== '' && typed !== value?.name;
  const filtered = isTyping ? items.filter((i) => normalizeSearch(i.name).includes(normalizeSearch(typed))) : items;
  const exact = items.find((i) => normalizeSearch(i.name) === normalizeSearch(typed));
  const showCreate = !exact && (typed !== '' || !!onCreateEmpty);
  const options: ({ kind: 'create' } | { kind: 'item'; item: ComboItem })[] = [
    ...(showCreate ? [{ kind: 'create' as const }] : []),
    ...filtered.map((item) => ({ kind: 'item' as const, item })),
  ];

  function choose(i: number) {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'create') {
      if (typed) onChange({ id: null, name: typed });
      else onCreateEmpty?.();
    } else onChange({ id: o.item.id, name: o.item.name });
    setOpen(false);
  }

  function commitOnBlur() {
    // Si lo escrito coincide con una opción existente se toma; si se borró, se quita la elección.
    if (!typed) {
      if (value) onChange(null);
    } else if (exact && exact.id !== value?.id) onChange({ id: exact.id, name: exact.name });
    else if (!exact && typed !== value?.name) setText(value?.name ?? '');
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={aria['aria-label']}
            autoComplete="off"
            className={cn(inputClasses, value ? 'pr-20' : '')}
            placeholder={placeholder}
            value={text}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onBlur={commitOnBlur}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((a) => Math.min(options.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && open) {
                e.preventDefault();
                choose(active);
              } else if (e.key === 'Escape' && open) {
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
          {value && (
            <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {value.id === null && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">Nueva</span>}
              <button
                type="button"
                aria-label="Quitar selección"
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(null);
                  setText('');
                }}
              >
                <X className="size-4" />
              </button>
            </span>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (e.target instanceof Node && document.getElementById(id ?? '')?.contains(e.target)) e.preventDefault();
          }}
          className="z-50 max-h-72 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-y-auto rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          <ul role="listbox" id={listId}>
            {options.map((o, i) => (
              <li
                key={o.kind === 'create' ? '__create' : o.item.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm',
                  o.kind === 'create' ? 'border-b border-gray-100 font-medium text-sky-600' : 'text-gray-900',
                  i === active && 'bg-gray-50',
                )}
              >
                {o.kind === 'create' ? (
                  <>
                    <Plus className="size-4" />
                    {typed ? `${createLabel} "${typed}"` : createLabel}
                  </>
                ) : (
                  <>
                    {itemIcon && <span className="text-gray-500 [&_svg]:size-4">{itemIcon}</span>}
                    {o.item.name}
                  </>
                )}
              </li>
            ))}
            {options.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">Sin resultados</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
