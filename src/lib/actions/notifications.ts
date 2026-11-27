'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { normaliseSubscription, subscriptionForRpc } from '@/lib/push';

export type PushActionResult = { ok: boolean; error?: string; message?: string; devices?: number };

type RpcResult = { ok?: boolean; error?: string; devices?: number; removed?: number };

/**
 * The browser posts back what `pushManager.subscribe()` gave it. The identity
 * is never part of that payload: `register_push_subscription()` reads
 * `auth.uid()`, so a crafted call can only ever attach a device to the caller's
 * own account. This action validates the shape first, so a malformed
 * subscription is refused before it reaches Postgres.
 */
export async function enablePush(subscription: unknown): Promise<PushActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: errorText('SIGN_IN_REQUIRED') };

  const parsed = normaliseSubscription(subscription);
  if (!parsed.ok) return { ok: false, error: errorText(parsed.error) };

  let userAgent: string | null = null;
  try {
    userAgent = (await headers()).get('user-agent');
  } catch {
    userAgent = null;
  }

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('register_push_subscription', subscriptionForRpc(parsed.value, userAgent));
    if (error) return { ok: false, error: 'Could not save this device. Try again.' };
    const result = (data ?? {}) as RpcResult;
    if (!result.ok) return { ok: false, error: errorText(result.error) };
    revalidatePath('/account');
    return {
      ok: true,
      devices: Number(result.devices ?? 1),
      message: 'Notifications are on for this browser.',
    };
  } catch {
    return { ok: false, error: 'Could not reach the database.' };
  }
}

/** Removes one device. Used when the browser's own subscription was lost. */
export async function removePushDevice(endpoint: string): Promise<PushActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: errorText('SIGN_IN_REQUIRED') };
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    return { ok: false, error: errorText('BAD_ENDPOINT') };
  }

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('unregister_push_subscription', { p_endpoint: endpoint });
    if (error) return { ok: false, error: 'Could not remove this device.' };
    const result = (data ?? {}) as RpcResult;
    if (!result.ok) return { ok: false, error: errorText(result.error) };
    revalidatePath('/account');
    return { ok: true, devices: Number(result.devices ?? 0), message: 'Device removed.' };
  } catch {
    return { ok: false, error: 'Could not reach the database.' };
  }
}

/**
 * The master switch. Off deletes every device row in the same call, so turning
 * notifications off actually stops them rather than leaving a live endpoint
 * behind that a future batch could still reach.
 */
export async function disablePush(): Promise<PushActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: errorText('SIGN_IN_REQUIRED') };

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('set_push_opt_in', { p_on: false });
    if (error) return { ok: false, error: 'Could not turn notifications off.' };
    const result = (data ?? {}) as RpcResult;
    if (!result.ok) return { ok: false, error: errorText(result.error) };
    revalidatePath('/account');
    return { ok: true, devices: 0, message: 'Notifications are off. Every device was removed.' };
  } catch {
    return { ok: false, error: 'Could not reach the database.' };
  }
}
