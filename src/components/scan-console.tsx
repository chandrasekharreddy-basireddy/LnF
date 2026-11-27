'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type DetectedBarcode = { rawValue: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type Status = 'idle' | 'starting' | 'scanning' | 'unsupported' | 'denied';

/** Pull the reference or claim code out of whatever the tag encodes. */
export function extractCode(raw: string): string | null {
  // A typed code is usually lower-case; a scanned one is already upper.
  const upper = raw.trim().toUpperCase();
  const item = upper.match(/LF-\d{4}-\d{4}/);
  if (item) return item[0];
  const claim = upper.match(/CLM-\d{4}-\d{4}/);
  if (claim) return claim[0];
  // A bare code must be the whole input: "CAMERA" is six allowed characters,
  // and a typed word must never be mistaken for a handover code.
  if (/^[2-9A-HJ-NP-Z]{6}$/.test(upper)) return upper;
  return null;
}

export function ScanConsole() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const go = useCallback(
    (raw: string) => {
      const code = extractCode(raw);
      if (!code) {
        setError('That does not look like an L&F reference or handover code.');
        return;
      }
      router.push(`/staff/scan/${code}`);
    },
    [router],
  );

  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: new (init: { formats: string[] }) => Detector })
      .BarcodeDetector;

    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;

    const startCamera = async () => {
      if (!Detector) {
        setStatus('unsupported');
        return;
      }
      setStatus('starting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        // the permission prompt can outlive the page: never leak the camera
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          return;
        }
        if (!videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          return;
        }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('scanning');

        const detector = new Detector({ formats: ['qr_code', 'code_128'] });
        timer = window.setInterval(async () => {
          if (!videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length) go(codes[0].rawValue);
          } catch {
            // a frame that cannot be read is not an error worth showing
          }
        }, 500);
      } catch {
        if (!cancelled) setStatus('denied');
      }
    };

    // Started from a timer callback so the capability check never sets state
    // during the effect body itself.
    const kickoff = window.setTimeout(() => void startCamera(), 0);

    return () => {
      cancelled = true;
      window.clearTimeout(kickoff);
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [go]);

  return (
    <div className="stack">
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Camera preview"
        hidden={status !== 'scanning'}
        style={{ width: '100%', borderRadius: 10, background: '#000' }}
      />

      {status === 'unsupported' ? (
        <p className="small muted">
          This browser cannot read barcodes directly. Type the reference below — everything else works the same.
        </p>
      ) : null}
      {status === 'denied' ? (
        <p className="small muted">
          Camera permission was refused. Type the reference below, or allow the camera in the address bar.
        </p>
      ) : null}

      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          go(value);
        }}
      >
        <div className="field">
          <label htmlFor="scan-code">Reference or handover code</label>
          <input
            id="scan-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="LF-2026-0007 or a 6-character code"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
          {error ? (
            <p className="error">{error}</p>
          ) : (
            <p className="hint">Case does not matter. Dashes are optional for a handover code.</p>
          )}
        </div>
        <button className="btn" type="submit">
          Open
        </button>
      </form>
    </div>
  );
}
