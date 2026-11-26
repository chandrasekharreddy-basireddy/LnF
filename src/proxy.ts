import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Two jobs, one pass:
 *  1. mint a per-request nonce and attach a Content-Security-Policy (Next reads the
 *     request header and stamps the nonce onto its own scripts);
 *  2. refresh the Supabase session cookie so a server component never renders with
 *     an expired token.
 *
 * No authorization decisions live here — those are enforced in Postgres.
 *
 * Next 16 renamed this convention: the file is `proxy.ts` and the export is the
 * default function (a `middleware.ts` file is deprecated and no longer applied).
 */

function supabaseOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

function buildCsp(nonce: string, dev: boolean): string {
  const origin = supabaseOrigin();
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (dev) scriptSrc.push("'unsafe-eval'");

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // inline style attributes are used throughout; a nonce cannot cover style=""
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${origin ? ` ${origin}` : ''}`,
    "font-src 'self' data:",
    `connect-src 'self'${origin ? ` ${origin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ];
  return directives.join('; ');
}

export default async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, process.env.NODE_ENV !== 'production');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const withCsp = (response: NextResponse) => {
    response.headers.set('content-security-policy', csp);
    return response;
  };

  if (!url || !key) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  await supabase.auth.getUser();
  return withCsp(response);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|.*\\.(?:svg|png|jpg|jpeg|webp|ico|txt|xml)$).*)'],
};
