import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface FieldProps {
  children: ReactNode;
  className?: string;
  error?: string;
  help?: string;
  label: string;
}

export function Field({ children, className, error, help, label }: FieldProps) {
  const helpId = useId();
  const errorId = useId();
  return (
    <label className={cn('ui-field', className)}>
      <span className="ui-field__label">{label}</span>
      <span
        aria-describedby={[help === undefined ? null : helpId, error === undefined ? null : errorId].filter(Boolean).join(' ') || undefined}
        aria-invalid={error === undefined ? undefined : true}
        className="ui-field__control"
      >
        {children}
      </span>
      {help === undefined ? null : <span className="ui-field__help" id={helpId}>{help}</span>}
      {error === undefined ? null : <span className="ui-field__error" id={errorId} role="alert">{error}</span>}
    </label>
  );
}
