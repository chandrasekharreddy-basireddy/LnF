import type { Metadata } from 'next';
import Link from 'next/link';
import { Banner } from '@/components/banner';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/data';
import { SignInForm } from '@/components/sign-in-form';
import { safeInternalPath } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (user) redirect('/account');

  const sp = await searchParams;
  // the same guard the action uses: a tab or a "//host" must not survive here
  const next = safeInternalPath(typeof sp.next === 'string' ? sp.next : null);

  return (
    <div className="section" style={{ marginTop: 8, maxWidth: 460 }}>
      <p className="eyebrow">Sign in</p>
      <h1>One email, one code.</h1>
      <p className="lede" style={{ marginBottom: 8 }}>
        No password to remember, nothing to leak. We email a one-time code that works once and expires in ten minutes.
      </p>
      <p className="small muted" style={{ marginBottom: 24 }}>
        New here? The same code creates your account — there is no separate sign-up form.
      </p>

      <div className="card">
        {typeof sp.error === 'string' ? (
          <div style={{ marginBottom: 16 }}>
            <Banner tone="warn" title="That link did not work">
              {sp.error === 'expired'
                ? 'It has already been used or has expired. Enter the code from the email, or ask for a new one.'
                : sp.error === 'unavailable'
                  ? 'Sign-in is not configured on this deployment. Tell the desk.'
                  : 'Open the sign-in page again and ask for a new code.'}
            </Banner>
          </div>
        ) : null}
        <SignInForm next={next} />
      </div>

      <p className="small muted" style={{ marginTop: 16 }}>
        Signing in means you accept the <Link href="/legal/terms">terms</Link> and the{' '}
        <Link href="/legal/privacy">privacy notice</Link>.
      </p>
    </div>
  );
}
