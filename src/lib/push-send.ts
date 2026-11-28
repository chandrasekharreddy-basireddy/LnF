/**
 * Web push — the sending half.
 *
 * Server-only: `web-push` does the VAPID signing and the payload encryption,
 * and must never end up in a client bundle. Imported by the cron route alone.
 */
import webpush from 'web-push';
import { isAllowedPushEndpoint, isGoneStatus, type PushPayload } from './push';

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type SendResult = {
  endpoint: string;
  ok: boolean;
  status?: number;
  /** the push service retired this subscription; the caller should drop it */
  gone?: boolean;
  error?: string;
};

export type Vapid = { publicKey: string; privateKey: string; subject: string };

/**
 * Sends one payload to every device of one notification. A failure is recorded
 * per device, never thrown: one dead phone must not stop the rest, and the
 * caller decides what the notification's final state is.
 */
export async function sendPushBatch(
  targets: PushTarget[],
  payload: PushPayload,
  vapid: Vapid,
  timeoutMs = 8000,
): Promise<SendResult[]> {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const body = JSON.stringify(payload);

  return Promise.all(
    targets.map(async (target): Promise<SendResult> => {
      if (!isAllowedPushEndpoint(target.endpoint)) {
        return { endpoint: target.endpoint, ok: false, gone: true, error: 'disallowed push host' };
      }
      try {
        const res = await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          body,
          { TTL: 3600, timeout: timeoutMs, urgency: 'normal' },
        );
        return { endpoint: target.endpoint, ok: true, status: res.statusCode };
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        return {
          endpoint: target.endpoint,
          ok: false,
          status,
          gone: isGoneStatus(status),
          error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        };
      }
    }),
  );
}
