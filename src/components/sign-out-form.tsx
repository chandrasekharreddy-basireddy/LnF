'use client';

import { signOut } from '@/lib/actions/auth';

/**
 * Signing out on a shared counter machine must not leave the previous person's
 * offline desk sheet in this browser. The sheet is localStorage only, so the
 * clear has to happen here — a server action cannot reach it.
 */
export function SignOutForm({ sheetKey = 'lnf-desk-sheet' }: { sheetKey?: string }) {
  return (
    <form
      action={signOut}
      onSubmit={() => {
        try {
          window.localStorage.removeItem(sheetKey);
          window.localStorage.removeItem(`${sheetKey}-changed`);
        } catch {
          // a browser with storage disabled has nothing to clear
        }
      }}
    >
      <button className="btn btn-secondary btn-sm" type="submit">
        Sign out
      </button>
    </form>
  );
}
