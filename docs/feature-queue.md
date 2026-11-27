# Feature queue

The durable state for the build loop. Each run picks the first unchecked item, builds it to the
same standard as the rest of the repo (migration, RLS, tests, smoke, CI green), ticks it, pushes,
and emails a completion note. Nothing here is "mostly done" — an item is ticked only when CI is
green on `main`.

| # | Feature | Status |
| --- | --- | --- |
| 1 | Anonymous hand-in + accountless claim | [x] done |
| — | Chat system (threads, unread, live delivery) | [x] done |
| 2 | Bulk backlog importer | [x] done — migration 0021, /staff/import, CSV parser with tests |
| 3 | Notifications: web push + WhatsApp click-to-chat | [x] done — migration 0028, `push_subscriptions` + service-role dispatcher, `wa.me` links; push to a real device still unproven (see `docs/notifications.md`) |
| 4 | Photo-similarity matching | [ ] |
| 5 | Claim-proof attachments (redacted) | [ ] needs a product decision — see below |
| 6 | Dispute room + trust signals | [ ] |
| 7 | Institution analytics + monthly PDF | [ ] |
| 8 | Custody timeline for the owner | [ ] |
| 9 | PWA + offline desk | [ ] |

## Standing rules for every run

1. Additive migration only; never edit an applied one.
2. Authorization lives in Postgres, not in the page.
3. Every new route is either public-and-safe or session-guarded, and `scripts/smoke.mjs` says which.
4. `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and the smoke gate must pass
   before the item is ticked.
5. Email the owner when the item is green: what shipped, what was verified, what was not.
6. If an item cannot be finished honestly in one run, leave it unchecked and say what is missing
   in this file — never tick a half-built feature.
7. Run the lifecycle check in `docs/lifecycle-check.md` after any change to a claim, handover,
   notification or audit function. It is the only test that walks the write path end to end.

## Item 5 is blocked on a decision, not on code

Claim-proof attachments reverse the promise on `/legal/privacy` that identity documents are never
uploaded. Do not build it until the owner says so in writing; keep it unchecked until then.
