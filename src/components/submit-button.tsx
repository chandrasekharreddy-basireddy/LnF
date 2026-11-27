'use client';

import { useFormStatus } from 'react-dom';

export function SubmitButton({
  children,
  pendingLabel,
  className = 'btn',
  disabled = false,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending ? pendingLabel ?? 'Working…' : children}
    </button>
  );
}
