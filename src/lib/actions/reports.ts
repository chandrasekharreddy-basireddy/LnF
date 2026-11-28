'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { currentUser } from '@/lib/data';
import { errorText } from '@/lib/copy';
import { isEmail, bool, clamp, isValidDate, str, todayISO } from '@/lib/validation';

import { processAndUploadPhotos } from '@/lib/photos';
import { sendOrQueue, templates } from '@/lib/email';
import { callerIp } from '@/lib/http';

export type ReportState = { ok: boolean; error?: string; fieldErrors?: Record<string, string> };

export async function createReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in first so we can send you updates on this item.' };

  const kind = str(formData.get('type')) === 'lost' ? 'lost' : 'found';
  const title = clamp(str(formData.get('title')), 120);
  const description = clamp(str(formData.get('description')), 1000);
  const category = str(formData.get('category')) || 'other';
  const zoneCode = str(formData.get('zone')) || null;
  const spot = clamp(str(formData.get('spot')), 120);
  const eventDate = str(formData.get('event_date'));
  const custody = clamp(str(formData.get('custody')), 120);
  const question = clamp(str(formData.get('question')), 200);
  const answer = clamp(str(formData.get('answer')), 200);
  const contactEmail = str(formData.get('contact_email')).toLowerCase();
  if (contactEmail && !isEmail(contactEmail)) {
    return { ok: false, fieldErrors: { contact_email: 'Enter a valid email address, or leave it blank.' }, error: 'Check the highlighted fields.' };
  }
  const sensitive = bool(formData.get('sensitive'));
  const consent = bool(formData.get('consent'));

  const fieldErrors: Record<string, string> = {};
  if (title.length < 3) fieldErrors.title = 'Give the item a name of at least 3 characters.';
  if (description.length < 10) fieldErrors.description = 'Add at least 10 characters so the owner can recognise it.';
  if (!isValidDate(eventDate)) fieldErrors.event_date = 'Pick the date you lost or found it.';
  else if (eventDate > todayISO()) fieldErrors.event_date = 'Use a date today or earlier.';
  if (kind === 'found' && question.length < 8) {
    fieldErrors.question = 'Ask one question only the owner could answer, for example "What is the lock screen wallpaper?".';
  }
  if (kind === 'found' && answer.length < 1) {
    fieldErrors.answer = 'The answer stays private and is how the desk verifies the owner.';
  }
  if (!consent) fieldErrors.consent = 'Tick the notice to continue.';

  if (Object.keys(fieldErrors).length) {
    return { ok: false, fieldErrors, error: 'Check the highlighted fields.' };
  }

  let ref = '';
  let status = 'available';
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('create_item', {
      p_type: kind,
      p_category: category,
      p_title: title,
      p_description: description,
      p_zone_code: zoneCode,
      p_spot: spot || null,
      p_event_date: eventDate,
      p_custody: custody || null,
      p_question: kind === 'found' ? question : null,
      p_answer: kind === 'found' ? answer : null,
      p_sensitive: sensitive,
      p_contact_email: contactEmail || user.email,
      p_finder_email: null,
      p_reporter_kind: 'member',
    });
    if (error) return { ok: false, error: 'We could not save that report. Try again in a moment.' };
    const result = data as { ok: boolean; error?: string; ref?: string; status?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };
    ref = result.ref ?? '';
    status = result.status ?? 'available';
  } catch {
    return { ok: false, error: 'We could not reach the board. Check your connection and try again.' };
  }

  const files = formData.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length && status === 'available') {
    await processAndUploadPhotos(files, user.id, ref, title);
  }

  if (status === 'available') {
    await sendOrQueue({
      to: user.email,
      mail: templates.itemPublished(ref, title, kind),
    eventType: 'item_published',
    payload: { ref, title, kind },
      dedupeKey: `item_published:${ref}`,
    });
  }

  revalidatePath('/browse');
  revalidatePath('/');
  // A quarantined or first-time listing is not public, so its own page would
  // 404. Send the reporter somewhere that explains the state instead.
  redirect(status === 'available' ? `/items/${ref}?posted=1` : `/report/success?ref=${ref}&state=${status}`);
}

export type HandInState = { ok: boolean; error?: string; fieldErrors?: Record<string, string> };

/** Public hand-in: no account, no photo, staff review before it is published. */
export async function handInFoundItem(_prev: HandInState, formData: FormData): Promise<HandInState> {
  const title = clamp(str(formData.get('title')), 120);
  const description = clamp(str(formData.get('description')), 1000);
  const category = str(formData.get('category')) || 'other';
  const zoneCode = str(formData.get('zone')) || null;
  const spot = clamp(str(formData.get('spot')), 120);
  const eventDate = str(formData.get('event_date'));
  const question = clamp(str(formData.get('question')), 200);
  const answer = clamp(str(formData.get('answer')), 200);
  const finderEmail = clamp(str(formData.get('finder_email')).toLowerCase(), 254);
  const finderPhone = clamp(str(formData.get('finder_phone')), 20);

  const fieldErrors: Record<string, string> = {};
  if (title.length < 3) fieldErrors.title = 'Give the item a name of at least 3 characters.';
  if (description.length < 10) fieldErrors.description = 'Add at least 10 characters so the owner can recognise it.';
  if (!isValidDate(eventDate)) fieldErrors.event_date = 'Pick the date you found it.';
  else if (eventDate > todayISO()) fieldErrors.event_date = 'Use a date today or earlier.';
  if (question.length < 8) fieldErrors.question = 'Ask one question only the owner could answer.';
  if (finderEmail && !isEmail(finderEmail)) fieldErrors.finder_email = 'Enter a valid email address or leave this blank.';
  if (answer.length < 1) fieldErrors.answer = 'The answer is how the desk checks a claim. It stays private.';
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors, error: 'Check the highlighted fields.' };

  let ref = '';
  let status = 'pending_moderation';
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('create_found_item_anonymous', {
      p_category: category,
      p_title: title,
      p_description: description,
      p_zone_code: zoneCode,
      p_spot: spot || null,
      p_event_date: eventDate,
      p_question: question,
      p_answer: answer,
      p_finder_email: finderEmail || null,
      p_finder_phone: finderPhone || null,
      p_ip: await callerIp(),
    });
    if (error) return { ok: false, error: 'We could not save that. Try again in a moment.' };
    const result = data as { ok: boolean; error?: string; ref?: string; status?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };
    ref = result.ref ?? '';
    status = result.status ?? 'pending_moderation';
  } catch {
    return { ok: false, error: 'We could not reach the board. Check your connection and try again.' };
  }

  revalidatePath('/staff');
  redirect(`/report/success?ref=${ref}&state=${status}`);
}

export type ListingReportState = { ok: boolean; error?: string; done?: boolean };

export async function reportListing(_prev: ListingReportState, formData: FormData): Promise<ListingReportState> {
  const ref = str(formData.get('ref'));
  const reason = str(formData.get('reason')) || 'other';
  const details = clamp(str(formData.get('details')), 1000);
  if (!ref) return { ok: false, error: 'Missing listing reference.' };
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('submit_report', {
      p_ref: ref,
      p_reason: reason,
      p_details: details,
    });
    if (error) return { ok: false, error: 'Could not send the report. Try again.' };
    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) return { ok: false, error: errorText(result?.error) };
    return { ok: true, done: true };
  } catch {
    return { ok: false, error: 'Could not send the report. Try again.' };
  }
}
