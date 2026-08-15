import { cloneElement, useId, type ReactElement } from 'react';
import { cn } from '../../lib/utils';

export interface FieldProps {
  children: ReactElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
  className?: string;
  error?: string;
  help?: string;
  label: string;
}

export function Field({ children, className, error, help, label }: FieldProps) {
  const helpId = useId();
  const errorId = useId();
  const describedBy = [help === undefined ? null : helpId, error === undefined ? null : errorId].filter(Boolean).join(' ');
  const accessibilityProps: { 'aria-describedby'?: string; 'aria-invalid'?: boolean } = {};
  if (describedBy.length > 0) accessibilityProps['aria-describedby'] = describedBy;
  if (error !== undefined) accessibilityProps['aria-invalid'] = true;
  return (
    <label className={cn('ui-field', className)}>
      <span className="ui-field__label">{label}</span>
      {cloneElement(children, accessibilityProps)}
      {help === undefined ? null : <span className="ui-field__help" id={helpId}>{help}</span>}
      {error === undefined ? null : <span className="ui-field__error" id={errorId} role="alert">{error}</span>}
    </label>
  );
}
