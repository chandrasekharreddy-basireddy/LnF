import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase-server';
import { sendWelcome } from '@/lib/auth/signin';
import { callerIp } from '@/lib/http';
import { safeInternalPath } from '@/lib/validation';

const ALLOWED_TYPES = new Set(['email', 'magiclink', 'signup'] as const);
type AllowedOtpType = 'email' | 'magiclink' | 'signup';

/**
 * Magic-link landing. The 6-digit code path does not need this route, but the
 * email also carries a link, and a link that 404s is a broken promise.
 *
 * The OTP type is allow-listed: `recovery` and `email_change` are not sign-in
 * events, and accepting them here would turn a password-reset link into a login.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const rawType = url.searchParams.get('type') ?? 'email';
  const next = url.searchParams.get('next') ?? '/account';

  if (!tokenHash || !ALLOWED_TYPES.has(rawType as AllowedOtpType)) {
    return NextResponse.redirect(new URL('/sign-in?error=link', request.url));
  }

  let email: string | null = null;
  let firstTime = false;
  let name: string | null = null;

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: rawType as AllowedOtpType,
    });
    if (error) return NextResponse.redirect(new URL('/sign-in?error=expired', request.url));

    email = data.user?.email ?? null;

    const { data: profile } = data.user?.id
      ? await supabase.from('profiles').select('full_name, email_verified_at').eq('id', data.user.id).maybeSingle()
      : { data: null };
    firstTime = !profile?.email_verified_at;
    name = (profile?.full_name as string | null) ?? null;

    // the same parity the 6-digit path has: verified marker plus an audit row
    await supabase.rpc('mark_email_verified');
    if (email) {
      await (supabaseAdmin() ?? supabase).rpc('log_auth_event', {
        p_kind: 'code_verified',
        p_email: email,
        p_ip: await callerIp(),
      });
    }
  } catch {
    return NextResponse.redirect(new URL('/sign-in?error=unavailable', request.url));
  }

  if (firstTime && email) {
    await sendWelcome(email, name);
  }

  return NextResponse.redirect(new URL(safeInternalPath(next), request.url));
}
