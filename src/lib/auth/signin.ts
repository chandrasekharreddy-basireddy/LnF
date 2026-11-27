import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { sendEmail, templates } from '@/lib/email';

/**
 * Sign-in codes, issued and delivered by us.
 *
 * Supabase Auth keeps the part that is genuinely hard to get right — token
 * generation, session cookies, refresh rotation, single-use enforcement. This
 * module takes over the part that was generic and ugly: minting the code with
 * the admin API and sending it through Brevo with our own template, so the
 * sign-in email looks like the product and carries our anti-scam footer.
 *
 * If no service-role key is configured we fall back to Supabase's own mailer,
 * which means the feature degrades to "works, with a plainer email" rather
 * than "does not work".
 */

type IssueResult =
  | { ok: true; channel: 'brevo' | 'supabase' }
  | { ok: false; error: string };

function adminClient(): SupabaseClient | null {
  if (!env.serviceRoleKey) return null;
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function issueSignInCode(email: string): Promise<IssueResult> {
  const admin = adminClient();
  if (!admin) return issueViaSupabase(email);

  try {
    // One call for the common case. generateLink only fails for an address with
    // no account, which is exactly when we create one — unconfirmed until the
    // code is entered.
    let link = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${env.siteUrl}/auth/confirm` },
    });

    if (link.error) {
      const { error: createError } = await admin.auth.admin.createUser({ email, email_confirm: false });
      // "already registered" means a race with another request; carry on
      if (createError && !/already/i.test(createError.message)) {
        return { ok: false, error: 'Could not start sign-in. Try again in a moment.' };
      }
      link = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: `${env.siteUrl}/auth/confirm` },
      });
    }

    const { data, error } = link;
    if (error || !data?.properties?.email_otp) {
      return issueViaSupabase(email);
    }

    const code = data.properties.email_otp;
    const mail = templates.signInCode(code, email);
    const sent = await sendEmail({ to: email, ...mail });

    if (!sent.ok) {
      // The code exists but the email did not leave. Fall back so the user is
      // not stuck holding a code that never arrived.
      return issueViaSupabase(email);
    }

    return { ok: true, channel: 'brevo' };
  } catch {
    return issueViaSupabase(email);
  }
}

async function issueViaSupabase(email: string): Promise<IssueResult> {
  try {
    const { createServerClient } = await import('@supabase/ssr');
    const { cookies } = await import('next/headers');
    const store = await cookies();
    const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // called from a server component; the proxy refreshes the session
          }
        },
      },
    });

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${env.siteUrl}/auth/confirm` },
    });
    if (error) return { ok: false, error: 'Could not send the code. Try again in a moment.' };
    return { ok: true, channel: 'supabase' };
  } catch {
    return { ok: false, error: 'Sign-in is not available right now. Try again in a minute.' };
  }
}

/** Sends the welcome note once, after the first successful verification. */
export async function sendWelcome(email: string, name: string | null): Promise<void> {
  try {
    const mail = templates.welcome(name);
    await sendEmail({ to: email, ...mail });
  } catch {
    // never block a sign-in on a courtesy email
  }
}
