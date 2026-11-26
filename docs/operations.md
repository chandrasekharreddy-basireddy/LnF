# Running the desk

The software is the easy part. These are the habits that make a board actually return items.

## Day one: do not launch an empty board

Two hundred items are already sitting in a cardboard box behind the desk. Photograph them,
list them, then launch. An empty board teaches everyone that the site is useless, and they do
not come back to check.

Order of work on launch day:

1. Photograph the backlog in batches of 20, on a plain background, with a card showing the
   reference. Log each one at `/report/found` from a staff account, with `custody` set to the
   desk.
2. Print the desk card (`A6`) and one zone poster per zone, each with a QR to
   `/browse?zone=<zone-code>`.
3. Post the lost side harder than the found side: most recoveries happen because a finder
   searches for a lost report, not the other way round. One all-hands line, one WhatsApp
   digest per hostel or floor, one line in the weekly notice.
4. Delete the six sample rows from `/admin` once real listings exist.

Skip SEO in month one. Nobody googles "lost bottle campus".

## The 90-second counter script

> "Found something? I can log it now — takes a minute. I need a photo, where you found it, and
> one question only the owner could answer. Then leave it with me, I will keep it in the bin
> with this reference. If someone claims it, you will get an email when it goes home."

> "Lost something? Check the board first, then post a lost report so you get an alert. If you
> see it, start a claim — I compare your answer with what the finder wrote."

## Daily, at the counter (5 minutes)

- Open `/staff`. Work the claims list top to bottom.
- Approve only when the answer matches **and** the proof is plausible. If both are weak, move
  it to review and ask one more question by email.
- Never release an item without an approved claim and a code. If the code is lost, reissue it
  from the claim, and note why.
- Log items you took in from walk-ins the same day. An item in a drawer that is not on the
  board cannot be found.

## Weekly (15 minutes)

- `/admin` → 60-day recovery rate and median days. If the rate drops, the cause is usually one
  of three: intake is slow (items sit in a drawer), questions are too easy (wrong person
  collects), or listings expire before anyone looks.
- Clear the reports queue.
- Re-photograph anything with a bad photo. A blurry photo is a lost item.

## Monthly

- Publish the recovered count on the notice board and in the digest. Recognition is the only
  incentive the system offers, and it works.
- Spot-check five random claims for decision quality.
- Export nothing unless asked; the retention job handles the rest.

## What to do when

| Situation | Action |
| --- | --- |
| Someone asks for money for an item | Close the report, suspend the listing, keep the audit trail. Never mediate. |
| A claimant insists the answer was right | Move to review, ask for a receipt or a photo of them using it. Do not reveal the finder's answer. |
| Two people claim the same item | Approve neither until one produces independent proof. The other claim stays `under_review`. |
| A found ID or bank card | Never list it. Hold it, contact the issuing authority, log it as `quarantined`. |
| Staff member leaves | Admin removes the `staff` role in `/admin/users`; sessions stop being able to act immediately. |
| Data erasure request | Delete the account in Supabase Auth (cascades profile, listings, claims), then close the report. |

## Measuring it

The only number that matters:

```
recovery rate = items with a confirmed handover ÷ items handed in, within 60 days
```

`/admin` computes it from `handover_records`, not from claims approved — an approved claim
that was never collected is not a recovery. Median days to return sits beside it; a rising
median means items are sitting in a drawer.
