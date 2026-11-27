const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const env = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  brevoApiKey: process.env.BREVO_API_KEY ?? '',
  brevoSenderEmail: process.env.BREVO_SENDER_EMAIL ?? 'no-reply@lnf.app',
  brevoSenderName: process.env.BREVO_SENDER_NAME ?? 'L&F',
  cronSecret: process.env.CRON_SECRET ?? '',
  campusName: process.env.NEXT_PUBLIC_CAMPUS_NAME ?? 'Campus',
  deskLabel: process.env.NEXT_PUBLIC_DESK_LABEL ?? 'Main Gate & Security Desk',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'help@lnf.app',
  // Web push. All three are optional: without them /account says push is off
  // and the dispatcher refuses with a named reason instead of failing blind.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? '',
  // The desk's WhatsApp number in international format, digits or +digits.
  // Server-side only: the link is built on the server, so the number is never
  // shipped in the client bundle.
  deskWhatsApp: process.env.DESK_WHATSAPP_NUMBER ?? '',
  buildStamp: process.env.NEXT_PUBLIC_BUILD_STAMP ?? new Date().toISOString().slice(0, 16).replace('T', ' '),
};

export function hasSupabase(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
