import * as React from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

/** Reduce la imagen (lado mayor ≤ max px, JPEG) para guardarla en la base local sin inflarla. */
export async function resizeImage(file: File, max = 600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo leer la imagen'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Zona punteada "Añadir imagen" (icono en cuadro sky-50 + texto sky-600), con vista previa y "Quitar". */
export function ImagePicker({ value, onChange, label = 'Añadir imagen', className, onError }: { value: string | null; onChange: (v: string | null) => void; label?: string; className?: string; onError?: (e: unknown) => void }) {
  const input = React.useRef<HTMLInputElement>(null);
  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      onChange(await resizeImage(file));
    } catch (e) {
      onError?.(e);
    }
  }
  return (
    <div className={cn('relative flex items-center justify-center rounded-md border border-dashed border-gray-300 bg-white', className)}>
      <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target.files?.[0])} />
      {value ? (
        <div className="flex flex-col items-center gap-3 p-4">
          <img src={value} alt="" className="max-h-48 max-w-full rounded-md object-contain" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => input.current?.click()}>
              Cambiar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              <Trash2 />
              Quitar
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files?.[0]);
          }}
          className="flex size-full flex-col items-center justify-center gap-3 rounded-md p-6 text-sm font-medium text-sky-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <span className="flex size-12 items-center justify-center rounded-lg bg-sky-50">
            <ImagePlus className="size-5" />
          </span>
          {label}
        </button>
      )}
    </div>
  );
}
