import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { sendEmail, templates } from '@/lib/email';

/**
 * Sign-in codes: minted by Supabase, delivered only by us.
 *
 * Supabase Auth keeps the part that is genuinely hard to get right — token
 * generation, session cookies, refresh rotation, single-use enforcement. Every
 * byte of the email is ours: the template, the sender, the footer, and the
 * Brevo API call.
 *
 * There is deliberately no fallback to Supabase's own mailer. That fallback
 * looked like resilience and was the opposite: it is rate-limited to a few
 * messages an hour, its emails carry no product footer, and it made a
 * misconfigured deployment look like a working one. If Brevo is not configured
 * or the send fails, this returns an error the page shows, and the operator
 * finds out immediately.
 */

type IssueResult =
  | { ok: true; channel: 'brevo' }
  | { ok: false; error: string; reason: 'NOT_CONFIGURED' | 'SEND_FAILED' | 'MINT_FAILED' };

function adminClient(): SupabaseClient | null {
  if (!env.serviceRoleKey) return null;
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function issueSignInCode(email: string): Promise<IssueResult> {
  const admin = adminClient();
  if (!admin) {
    // no service-role key: we cannot mint a code, and we will not hand the job
    // to Supabase's mailer
    console.warn('[signin] SUPABASE_SERVICE_ROLE_KEY is not set — no code can be issued');
    return {
      ok: false,
      reason: 'NOT_CONFIGURED',
      error: 'Sign-in email is not configured on this deployment. Tell the desk.',
    };
  }

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
        return { ok: false, reason: 'MINT_FAILED', error: 'Could not start sign-in. Try again in a moment.' };
      }
      link = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: `${env.siteUrl}/auth/confirm` },
      });
    }

    const { data, error } = link;
    if (error || !data?.properties?.email_otp) {
      console.warn('[signin] could not mint a code:', error?.message ?? 'no email_otp in the response');
      return {
        ok: false,
        reason: 'MINT_FAILED',
        error: 'Could not start sign-in. Try again in a moment.',
      };
    }

    const code = data.properties.email_otp;
    // the same token as a clickable link, for a person who would rather tap
    const actionUrl = data.properties.action_link;
    const mail = templates.signInCode(code, email, 'signin', actionUrl);
    const sent = await sendEmail({ to: email, ...mail });

    if (!sent.ok) {
      // The code exists but never left. Say so — a silent fallback is how a
      // broken provider stays broken for weeks.
      console.error('[signin] brevo refused the sign-in mail, status', sent.status);
      return {
        ok: false,
        reason: 'SEND_FAILED',
        error: 'We could not send the email just now. Try again in a minute.',
      };
    }

    return { ok: true, channel: 'brevo' };
  } catch (error) {
    console.error('[signin] unexpected failure while issuing a code:', (error as Error).message);
    return {
      ok: false,
      reason: 'MINT_FAILED',
      error: 'Could not start sign-in. Try again in a moment.',
    };
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
