import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Páginas visibles: 1 2 3 … N (con la actual y sus vecinas). */
export function pageItems(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, 2, 3, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Paginación estilo pestañas: borde superior gray-200; la página activa con borde superior 2px sky-600. */
export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;
  const tab = 'inline-flex items-center border-t-2 pt-4 text-sm font-medium';
  return (
    <nav aria-label="Paginación" className={cn('flex items-center justify-between border-t border-gray-200 px-4 sm:px-0', className)}>
      <div className="-mt-px flex w-0 flex-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={cn(tab, 'gap-3 border-transparent pr-1 text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-50')}
        >
          <ArrowLeft className="size-5 text-gray-400" />
          Anterior
        </button>
      </div>
      <div className="-mt-px flex">
        {pageItems(page, totalPages).map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className={cn(tab, 'border-transparent px-4 text-gray-500')}>
              ...
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onPageChange(p)}
              className={cn(tab, 'px-4', p === page ? 'border-sky-600 text-sky-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700')}
            >
              {p}
            </button>
          ),
        )}
      </div>
      <div className="-mt-px flex w-0 flex-1 justify-end">
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className={cn(tab, 'gap-3 border-transparent pl-1 text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-50')}
        >
          Siguiente
          <ArrowRight className="size-5 text-gray-400" />
        </button>
      </div>
    </nav>
  );
}
