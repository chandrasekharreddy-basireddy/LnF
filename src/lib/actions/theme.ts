'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { str } from '@/lib/validation';

/**
 * The theme is a cookie set by the server, so `<html data-theme>` is correct in
 * the first byte of HTML: no flash, no inline script, no CSP exception.
 */
export async function setTheme(formData: FormData): Promise<void> {
  const value = str(formData.get('theme'));
  const store = await cookies();

  if (value === 'light' || value === 'dark') {
    store.set('lnf-theme', value, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
    });
  } else {
    store.delete('lnf-theme');
  }

  revalidatePath('/');
}
