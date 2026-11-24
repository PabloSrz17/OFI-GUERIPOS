import * as React from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof Menu.Content>, React.ComponentPropsWithoutRef<typeof Menu.Content>>(
  ({ className, sideOffset = 6, align = 'end', ...props }, ref) => (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        className={cn('z-50 min-w-[12rem] overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none', className)}
        {...props}
      />
    </Menu.Portal>
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

interface ItemProps extends React.ComponentPropsWithoutRef<typeof Menu.Item> {
  icon?: React.ReactNode;
  description?: React.ReactNode;
  shortcut?: React.ReactNode;
}

/** Ítem simple (texto + atajo) o enriquecido (icono + título + descripción), como "Agregar Producto ▾". */
export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof Menu.Item>, ItemProps>(
  ({ className, icon, description, shortcut, children, ...props }, ref) => (
    <Menu.Item
      ref={ref}
      className={cn(
        'flex cursor-pointer select-none items-start gap-3 px-4 text-sm text-gray-900 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-gray-50 data-[disabled]:opacity-50',
        description ? 'py-3' : 'py-2',
        className,
      )}
      {...props}
    >
      {icon && <span className="mt-0.5 text-gray-400 [&_svg]:size-5">{icon}</span>}
      <span className="flex-1">
        <span className={cn('block', description && 'font-medium')}>{children}</span>
        {description && <span className="mt-0.5 block text-gray-500">{description}</span>}
      </span>
      {shortcut && <span className="ml-4 flex items-center gap-1">{shortcut}</span>}
    </Menu.Item>
  ),
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-0 h-px bg-gray-100" />;
}
