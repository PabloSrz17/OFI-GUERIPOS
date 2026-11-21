import * as React from 'react';
import { cn } from '@/lib/utils';

// Alto 38, borde gray-300, radio 6, texto 14; foco: borde + ring sky-500 de 1px.
export const inputClasses =
  'h-control w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => <input ref={ref} type={type} className={cn(inputClasses, className)} {...props} />,
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 2, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(inputClasses.replace('h-control ', ''), 'py-2', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

/** Input con prefijo ("$") y/o sufijo ("por Unidad") dentro del borde, como en Pulpos. */
export interface InputGroupProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  icon?: React.ReactNode;
}

export const InputGroup = React.forwardRef<HTMLInputElement, InputGroupProps>(
  ({ prefix, suffix, icon, className, ...props }, ref) => (
    <div className="relative flex items-center">
      {(icon || prefix) && (
        <span className="pointer-events-none absolute left-3 flex items-center text-sm text-gray-500 [&_svg]:size-5 [&_svg]:text-gray-400">
          {icon ?? prefix}
        </span>
      )}
      <input
        ref={ref}
        className={cn(inputClasses, icon ? 'pl-10' : prefix ? 'pl-9' : '', suffix ? 'pr-24' : '', className)}
        {...props}
      />
      {suffix && <span className="pointer-events-none absolute right-3 text-sm text-gray-500">{suffix}</span>}
    </div>
  ),
);
InputGroup.displayName = 'InputGroup';
