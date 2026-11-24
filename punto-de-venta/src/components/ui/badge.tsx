import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Pill: 12/16, peso 500, padding 2×10, radio completo.
const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3', {
  variants: {
    tone: {
      success: 'bg-green-100 text-green-800',
      danger: 'bg-red-100 text-red-800',
      warning: 'bg-amber-100 text-amber-800',
      debt: 'bg-pink-100 text-pink-800',
      info: 'bg-sky-100 text-sky-800',
      neutral: 'bg-gray-100 text-gray-700',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Pill de existencias: verde si hay stock, roja si es 0 o negativo (stock negativo permitido, decisions.md D3). */
export function StockBadge({ quantity, label }: { quantity: number; label: string }) {
  return <Badge tone={quantity > 0 ? 'success' : 'danger'}>{label}</Badge>;
}
