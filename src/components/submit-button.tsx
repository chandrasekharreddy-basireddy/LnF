'use client';

import { useFormStatus } from 'react-dom';

export function SubmitButton({
  children,
  pendingLabel,
  className = 'btn',
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
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
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? pendingLabel ?? 'Working…' : children}
    </button>
  );
}
