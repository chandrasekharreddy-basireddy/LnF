import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { safeInternalPath } from '@/lib/validation';

/**
 * Magic-link landing. The 6-digit code path does not need this route, but the
 * email also carries a link, and a link that 404s is a broken promise.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') ?? 'email';
  const next = url.searchParams.get('next') ?? '/account';

  if (!tokenHash) {
    return NextResponse.redirect(new URL('/sign-in?error=link', request.url));
  }

  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'email' | 'magiclink' | 'signup' | 'recovery' | 'invite' | 'email_change',
    });
    if (error) return NextResponse.redirect(new URL('/sign-in?error=expired', request.url));
  } catch {
    return NextResponse.redirect(new URL('/sign-in?error=unavailable', request.url));
  }

  const safeNext = safeInternalPath(next);
  return NextResponse.redirect(new URL(safeNext, request.url));
}
