'use client';

import { useActionState, useState } from 'react';
import { createReport, type ReportState } from '@/lib/actions/reports';
import { SubmitButton } from './submit-button';
import { Banner } from './banner';
import { todayISO } from '@/lib/validation';
import { compressSelectedPhotos } from '@/lib/client-photo';

const initial: ReportState = { ok: false };

export function ReportForm({
  kind,
  categories,
  zones,
  deskLabel,
  defaultEmail,
  defaultZone,
}: {
  kind: 'lost' | 'found';
  categories: readonly { value: string; label: string }[];
  zones: { code: string; name: string }[];
  deskLabel: string;
  defaultEmail: string | null;
  defaultZone?: string;
}) {
  const [state, action] = useActionState(createReport, initial);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const fe = state.fieldErrors ?? {};

  return (
    <form className="form" action={action} noValidate>
      <input type="hidden" name="type" value={kind} />

      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}

      <div className="field">
        <label htmlFor="title">What is it?</label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={120}
          placeholder={kind === 'found' ? 'Black wireless earbuds in a charging case' : 'Black wired earphones'}
          aria-invalid={Boolean(fe.title)}
          aria-describedby={fe.title ? 'title-error' : 'title-hint'}
        />
        {fe.title ? (
          <p className="error" id="title-error">
            {fe.title}
          </p>
        ) : (
          <p className="hint" id="title-hint">
            A short name the owner would recognise at a glance.
          </p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue="electronics">
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="event_date">Date {kind === 'found' ? 'you found it' : 'you lost it'}</label>
          <input
            id="event_date"
            name="event_date"
            type="date"
            required
            max={todayISO()}
            defaultValue={todayISO()}
            aria-invalid={Boolean(fe.event_date)}
            aria-describedby={fe.event_date ? 'date-error' : undefined}
          />
          {fe.event_date ? (
            <p className="error" id="date-error">
              {fe.event_date}
            </p>
          ) : null}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="zone">Zone</label>
          <select id="zone" name="zone" defaultValue={defaultZone ?? ''}>
            <option value="">Not sure</option>
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="spot">Specific spot (optional)</label>
          <input id="spot" name="spot" type="text" maxLength={120} placeholder="Quiet study desks, north windows" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          name="description"
          required
          minLength={10}
          maxLength={1000}
          aria-invalid={Boolean(fe.description)}
          aria-describedby={fe.description ? 'desc-error' : 'desc-hint'}
          placeholder={
            kind === 'found'
              ? 'Colour, material, marks, what is inside. Leave out anything only the owner would know.'
              : 'Colour, brand, distinguishing marks. Do not write your phone number or ID number here.'
          }
        />
        {fe.description ? (
          <p className="error" id="desc-error">
            {fe.description}
          </p>
        ) : (
          <p className="hint" id="desc-hint">
            This is public. Never post your ID number, address or phone number.
          </p>
        )}
      </div>

      {kind === 'found' ? (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="question">One verification question</label>
              <input
                id="question"
                name="question"
                type="text"
                maxLength={200}
                placeholder="What is the lock screen wallpaper?"
                aria-invalid={Boolean(fe.question)}
                aria-describedby={fe.question ? 'q-error' : 'q-hint'}
              />
              {fe.question ? (
                <p className="error" id="q-error">
                  {fe.question}
                </p>
              ) : (
                <p className="hint" id="q-hint">
                  Public. Only the owner should be able to answer it.
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="answer">The answer</label>
              <input
                id="answer"
                name="answer"
                type="text"
                maxLength={200}
                autoComplete="off"
                aria-invalid={Boolean(fe.answer)}
                aria-describedby={fe.answer ? 'a-error' : 'a-hint'}
              />
              {fe.answer ? (
                <p className="error" id="a-error">
                  {fe.answer}
                </p>
              ) : (
                <p className="hint" id="a-hint">
                  Private. Stored as a one-way hash; the desk uses it to check a claim.
                </p>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor="custody">Where is it now?</label>
            <input id="custody" name="custody" type="text" maxLength={120} defaultValue={deskLabel} />
            <p className="hint">Hand it in at {deskLabel} so the handover is staffed.</p>
          </div>

          <div className="field">
            <label htmlFor="photos">Photos (optional, up to 3)</label>
            <input
              id="photos"
              name="photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={async (event) => {
                // shrink on the phone: a 4 MB photo is rejected by the platform
                // before it ever reaches the action
                const problem = await compressSelectedPhotos(event.target);
                setPhotoNotice(problem);
              }}
            />
            {photoNotice ? <p className="hint">{photoNotice}</p> : null}
            <p className="hint">
              JPG, PNG or WebP, up to 5 MB each. Location data and camera details are removed from your photo before
              it is stored.
            </p>
          </div>

          <label className="check">
            <input type="checkbox" name="sensitive" />
            <span>
              This photo shows something sensitive (a document, a screen, a face). Show no photo publicly — use the
              description only.
            </span>
          </label>
        </>
      ) : (
        <div className="field">
          <label htmlFor="photos">A photo you already have (optional)</label>
          <input
            id="photos"
            name="photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={async (event) => {
              const problem = await compressSelectedPhotos(event.target);
              setPhotoNotice(problem);
            }}
          />
          {photoNotice ? <p className="hint">{photoNotice}</p> : null}
          <p className="hint">Up to 3 images, 5 MB each. Metadata is removed on upload.</p>
        </div>
      )}

      <div className="field">
        <label htmlFor="contact_email">Email for updates</label>
        <input
          id="contact_email"
          name="contact_email"
          type="email"
          autoComplete="email"
          defaultValue={defaultEmail ?? ''}
          placeholder="you@example.com"
        />
        <p className="hint">Kept private. Used only for this item and never shown on the board.</p>
      </div>

      <div>
        <label className="check">
          <input type="checkbox" name="consent" aria-invalid={Boolean(fe.consent)} />
          <span>
            I understand this listing is public, that my contact details stay private, and that it is deleted 90 days
            after posting. See the{' '}
            <a href="/legal/privacy" target="_blank" rel="noreferrer">
              privacy notice
            </a>
            .
          </span>
        </label>
        {fe.consent ? <p className="error">{fe.consent}</p> : null}
      </div>

      <div className="form-actions">
        <SubmitButton pendingLabel="Posting…">
          {kind === 'found' ? 'Post the found item' : 'Post the lost report'}
        </SubmitButton>
        <span className="form-note">You can edit or remove it from your account.</span>
      </div>
    </form>
  );
}
