# Architecture

## Shape

```
Browser ──► Vercel (Next.js App Router)
                │  server components render with the user's session cookie
                │  server actions validate, then call one RPC
                ▼
           Supabase PostgREST  ──► Postgres (RLS + SECURITY DEFINER functions)
                │
                └──► Storage (private bucket, signed URLs, 1 h)
```

There is no separate API service. Every mutation is a Postgres function with an explicit
authorization check inside it; every read on a public page is a view or a function that
returns a fixed column list. The browser never holds a key that can bypass RLS.

## Why the data layer looks like this

`lib/data.ts` is the only place that talks to Supabase from a page. It returns typed shapes
and never passes a raw row through. Three rules hold the privacy boundary:

1. **Public reads go through `public_items`, `public_item_images`, `public_zones`,
   `public_stats`, or the RPCs `search_items` / `get_public_item`.** Those have no
   `contact_email`, `finder_email`, `answer_hash`, `bin_code` or `reporter_id` column.
2. **`to_public_item()` builds JSON field by field.** No `to_jsonb(row)` spread anywhere, so a
   column added later cannot leak by default.
3. **Base tables are not granted to `anon`.** A query that forgets to use a view fails loudly
   with `permission denied` instead of quietly returning private columns.

## Request paths

| Action | Path |
| --- | --- |
| Browse / search | `search_items(jsonb)` — synonyms, tsquery, trigram fallback, capped at 50 rows |
| Item page | `get_public_item(ref)` → item + photo paths; paths signed in one batched call |
| Report an item | server action → `create_item(...)` → optional `sharp` re-encode + storage upload → `item_images` insert → `refresh_matches()` |
| Claim | server action → `submit_claim(ref, answer, proof)`; answer stored as `sha256(lower(trim(answer)))`, never compared in the browser |
| Decide a claim | `staff_decide_claim(ref, decision, reason)` → issues a 6-character code, stores `sha256(code)`, sets item `claimed` |
| Handover | `staff_confirm_handover(item_ref, code)` → verifies hash, marks code used, item `recovered`, writes `handover_records` + audit + notifications |
| Daily job | `housekeeping()` — expiry, retention, nudges; returns photo paths for the Vercel job to delete |
| Email | `sendOrQueue` tries Brevo; on refusal it writes `email_outbox` with a dedupe key, and the cron retries up to 3 times |
| Headers | `src/proxy.ts` (Next 16's replacement for middleware) mints a nonce and sets a strict CSP on request and response |
| Messaging | `post_claim_message()` scans for payment requests, phone numbers, emails and ID numbers; hits are quarantined and audited, never delivered |
| Retention | `retention_policies` sets the window per category; `create_item` reads it, `housekeeping()` enforces it, `/legal/retention` renders the same rows |
| Saved | `saved_items` / `saved_searches`; `run_saved_searches()` runs inside housekeeping and sends one notification per run |
| Photo hash | `processAndUploadPhotos` → `dhashFromImage` → `set_item_photo_hash(path, hash)` → `recompute_item_matches(ref)` |
| Match review | `/staff/matches` → `match_queue(limit)`, which returns null unless `is_staff()` |
| Dispute | `/disputes` → `open_dispute(claim_ref, reason)`; the room is the claim's own thread. `decide_dispute()` reopens a rejected claim only while the item is still in custody. See [disputes.md](disputes.md) |
| Trust signals | `claimant_trust(claim_ref)` for staff (counts about one account); `public_trust()` for `/safety` (counts about the desk, never a person) |
| Theme | a `lnf-theme` cookie read in the layout, so `data-theme` is on `<html>` before first paint |

## Matching

Deliberately simple and explainable, because an unexplainable score is a liability:

```
score = 0.55 · similarity(lost.title, found.title)
      + 0.25 · (same category)
      + 0.10 · (same zone)
      + up to 0.10 · (closer event dates, within 45 days)
      + 0.35 · photo similarity          (migration 0029)

photo similarity = max(0, 1 − hamming(dHash_lost, dHash_found) / 24)
```

Candidates are limited to the same category, a title similarity above 0.3, or photos within 12
of 64 bits — so a re-described item can be found by its picture alone. Only pairs scoring ≥ 0.35
become a `match_alerts` row, and each row stores the title score, photo score and photo distance
that produced it, so the desk can see why. The platform surfaces *possible matches*; it never
declares an item found, and it never emails a claimant a "confirmed" match.

The photo hash is a 64-bit dHash computed server-side with `sharp` at upload time, stored on
`item_images.phash`, and written only by `set_item_photo_hash()`. See
[photo-matching.md](photo-matching.md) for the arithmetic, the authorization rules and the limits.

## Rendering and speed

- Server components only; the client bundle is limited to the forms, the filter-free pages
  and one copy button.
- No UI framework, no CSS-in-JS: one 12 KB stylesheet, system fonts, no web font request.
- Photos: one `createSignedUrls` call per page, `loading="lazy"`, explicit `width`/`height` to
  avoid layout shift.
- Every dynamic page is `force-dynamic`; there is no ISR cache to go stale after a claim.
- `next.config.ts` sets HSTS, `X-Frame-Options: DENY`, `nosniff` and a referrer policy.

## Failure behaviour

| Failure | What the user sees |
| --- | --- |
| Database unreachable | Board renders with zeros and an empty-state that offers an action, not a spinner forever |
| Storage unreachable | Item shows its category icon and description; the listing still works |
| Email provider down | The action still succeeds; the notification row stays in-app |
| A page throws | `error.tsx` shows a retry and a digest reference, never the exception text |
