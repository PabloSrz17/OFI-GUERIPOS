import * as React from 'react';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  help?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  labelAddon?: React.ReactNode;
  children: React.ReactNode;
}

/** Label 14/500 gray-800 + control + ayuda 12px gray-500 (o error en rojo). */
export function Field({ label, htmlFor, required, help, error, className, labelAddon, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-gray-800">
          {label}
          {required && <span>*</span>}
        </label>
        {labelAddon}
      </div>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : help ? <p className="text-xs text-gray-500">{help}</p> : null}
    </div>
  );
}
