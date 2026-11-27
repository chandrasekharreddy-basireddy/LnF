'use client';

import { useState, useTransition } from 'react';
import { decodeBase64Url } from '@/lib/push';
import { disablePush, enablePush } from '@/lib/actions/notifications';
import { Banner } from './banner';

type Props = {
  /** false when the deployment has no VAPID keys — then nothing can be enabled */
  configured: boolean;
  optIn: boolean;
  devices: number;
  publicKey: string | null;
};

type Status = { tone: 'ok' | 'danger'; text: string } | null;

/**
 * Turns web push on and off for this browser.
 *
 * Three things must line up before a device is registered: the deployment has
 * VAPID keys, the browser supports service workers and push, and the person
 * grants notification permission. Each failure is named on screen instead of
 * leaving a button that does nothing.
 *
 * The server is told only after the browser has a real subscription, and the
 * server checks the shape again — the client is never the authority here.
 */
export function PushToggle({ configured, optIn, devices, publicKey }: Props) {
  const [on, setOn] = useState(optIn && devices > 0);
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();

  async function turnOn() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setStatus({ tone: 'danger', text: 'This browser cannot receive web push. Email alerts still work.' });
      return;
    }

    const keyBytes = publicKey ? decodeBase64Url(publicKey) : null;
    if (!keyBytes) {
      setStatus({ tone: 'danger', text: 'Push is misconfigured on this deployment. Email alerts still work.' });
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus({
          tone: 'danger',
          text:
            permission === 'denied'
              ? 'Your browser blocked notifications for this site. Allow them in the site settings, then try again.'
              : 'Notifications were not allowed, so nothing was saved.',
        });
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: new Uint8Array(keyBytes).buffer as ArrayBuffer,
        }));

      const result = await enablePush(subscription.toJSON());
      if (!result.ok) {
        // the device is not on our side, so it must not stay subscribed here
        await subscription.unsubscribe().catch(() => undefined);
        setStatus({ tone: 'danger', text: result.error ?? 'Could not save this device.' });
        return;
      }

      setOn(true);
      setStatus({ tone: 'ok', text: result.message ?? 'Notifications are on for this browser.' });
    } catch {
      setStatus({ tone: 'danger', text: 'This browser would not create a subscription. Try a different browser.' });
    }
  }

  async function turnOff() {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) await subscription.unsubscribe();
    } catch {
      // the server call below is what actually stops delivery
    }

    const result = await disablePush();
    if (!result.ok) {
      setStatus({ tone: 'danger', text: result.error ?? 'Could not turn notifications off.' });
      return;
    }
    setOn(false);
    setStatus({ tone: 'ok', text: result.message ?? 'Notifications are off.' });
  }

  if (!configured) {
    return (
      <p className="small muted">
        Push is not switched on for this deployment yet, so no browser can subscribe. Email alerts still work.
      </p>
    );
  }

  return (
    <div className="stack">
      {status ? <Banner tone={status.tone}>{status.text}</Banner> : null}
      <p className="small muted">
        {on
          ? `On for this browser${devices > 1 ? ` and ${devices - 1} other device${devices - 1 === 1 ? '' : 's'}` : ''}.`
          : 'Off. Push arrives on this device only, and you can turn it off here at any time.'}
      </p>
      <button
        type="button"
        className={on ? 'btn btn-secondary' : 'btn'}
        disabled={pending}
        onClick={() => startTransition(async () => (on ? turnOff() : turnOn()))}
      >
        {pending ? 'Working…' : on ? 'Turn notifications off' : 'Turn notifications on'}
      </button>
    </div>
  );
}
