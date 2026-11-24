import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Medidas: alto 38px, texto 14/500, padding 8×16, radio 6 (design-system.md §5).
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'border-primary bg-primary text-white hover:border-primary-hover hover:bg-primary-hover active:bg-primary-active',
        secondary: 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
        soft: 'border-transparent bg-sky-50 text-sky-600 hover:bg-sky-100',
        ghost: 'border-transparent bg-transparent text-gray-700 hover:bg-gray-100',
        link: 'h-auto border-transparent bg-transparent p-0 text-sky-600 hover:text-sky-700 hover:underline',
        danger: 'border-red-600 bg-red-600 text-white hover:bg-red-700',
      },
      size: {
        default: 'h-control px-4 py-2',
        sm: 'h-8 px-3 py-1.5',
        lg: 'h-14 px-6 text-lg font-semibold [&_svg]:size-5',
        icon: 'size-control p-0',
        back: 'size-11 p-0 [&_svg]:size-5',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0 py-0' }],
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
);

// Estado deshabilitado observado: fondo gray-100, texto gray-500, sin borde visible.
const disabledClasses = 'disabled:border-transparent disabled:bg-gray-100 disabled:text-gray-500';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size }), variant !== 'link' && variant !== 'ghost' && disabledClasses, className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
