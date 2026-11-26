'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { env } from '@/lib/env';
import { isEmail, str } from '@/lib/validation';

export type AuthState = { step: 'email' | 'otp'; email?: string; error?: string; notice?: string };

export async function requestOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = str(formData.get('email')).toLowerCase();
  if (!isEmail(email)) return { step: 'email', error: 'Enter a valid email address, for example name@campus.edu.' };

  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${env.siteUrl}/auth/confirm`,
      },
    });
    if (error) return { step: 'email', email, error: error.message };
    return { step: 'otp', email, notice: `We sent a 6-digit code to ${email}. It expires in 10 minutes.` };
  } catch {
    return { step: 'email', email, error: 'Sign-in is not available right now. Try again in a minute.' };
  }
}

export async function verifyOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = str(formData.get('email')).toLowerCase();
  const token = str(formData.get('token')).replace(/\s+/g, '');
  const rawNext = str(formData.get('next'));
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/account';
  if (!/^\d{6}$/.test(token)) {
    return { step: 'otp', email, error: 'Enter the 6-digit code from the email.' };
  }
  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      return { step: 'otp', email, error: 'That code is wrong or has expired. Request a new one.' };
    }
  } catch {
    return { step: 'otp', email, error: 'Could not verify the code. Try again.' };
  }
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/');
}
