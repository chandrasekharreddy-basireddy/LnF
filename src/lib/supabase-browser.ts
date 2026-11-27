'use client';

import { createBrowserClient } from '@supabase/ssr';

let cached: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Browser client, used only for Realtime. Reads and writes still go through
 * server actions and RPCs, so a realtime failure degrades to polling rather
 * than breaking the page.
 */
export function supabaseBrowser() {
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  );
  return cached;
}
