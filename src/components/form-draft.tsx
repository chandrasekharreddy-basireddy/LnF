'use client';

import { useEffect, useRef } from 'react';

/**
 * Keeps what a person typed when the server rejects their form.
 *
 * React 19 resets an uncontrolled form as part of submitting it, so a validation
 * error came back as a blank form — and on the report and hand-in forms that
 * included the verification answer, which is stored hashed and cannot be
 * recovered by the person who typed it.
 *
 * This snapshots the fields on submit and puts them back if the action reports
 * failure. File inputs cannot be restored by any browser, so photos are the one
 * thing a person must re-pick.
 */
export function useFormDraft<T extends { ok: boolean }>(state: T) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const snapshot = useRef<Array<[string, string]> | null>(null);

  const onBeforeSubmit = () => {
    const form = formRef.current;
    if (!form) return;
    const entries: Array<[string, string]> = [];
    for (const [name, value] of new FormData(form).entries()) {
      if (typeof value === 'string' && value !== '') entries.push([name, value]);
    }
    snapshot.current = entries;
  };

  useEffect(() => {
    if (state.ok || !snapshot.current) return;
    const form = formRef.current;
    if (!form) return;

    for (const [name, value] of snapshot.current) {
      const field = form.elements.namedItem(name);
      if (field instanceof RadioNodeList) continue;
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        if (field.type === 'file' || field.type === 'hidden') continue;
        if (field.value === '') field.value = value;
      } else if (field instanceof HTMLSelectElement && field.value === '') {
        field.value = value;
      }
    }
    snapshot.current = null;
  }, [state]);

  return { formRef, onBeforeSubmit };
}
