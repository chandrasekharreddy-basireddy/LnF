# Incident response

One page, written before it is needed. Print it, or keep it where the desk can find it.

## Who decides

| Role | Who | Decides |
| --- | --- | --- |
| Incident lead | the admin on duty (see `/admin/users`) | whether this is an incident, and who is told |
| Desk lead | whoever is on the counter | whether to stop handovers |
| Institution contact | the faculty / IT owner of the project | notification to the institution, and to affected people |

Nobody else speaks publicly about an incident. One voice, one log.

## First 30 minutes

1. **Stop the bleeding, reversibly.** Revoke the affected role in `/admin/users`, rotate the
   service-role key in Supabase, or unpublish the listing. Do not delete evidence.
2. **Preserve.** Export `audit_logs` and `auth_events` (hash-only) before touching anything
   else, and run `/admin` → Oversight → audit chain check. A broken chain is itself a finding.
3. **Write it down.** Time, what you saw, what you did, who you told. A running note is the
   difference between a report and a guess.

## What counts as an incident

| Signal | Why it matters | Where you see it |
| --- | --- | --- |
| Handover code mismatch (`alert` severity) | someone tried to collect with a guessed code | `/admin/audit` |
| `handover_code_mismatch` repeated from one account | a person, not a typo | `/admin/audit` |
| Audit chain broken | history was edited or deleted | `/admin` → Oversight |
| Extortion message quarantined | a scam attempt on the board | `/staff` reports |
| Report queue growing | nobody is moderating | `/staff` |
| `auth_events` spike for one address hash | credential probing | SQL, below |

```sql
-- sign-in attempts in the last 24 hours, by address hash
select email_hash, kind, count(*)
from auth_events
where created_at > now() - interval '24 hours'
group by 1, 2 order by 3 desc limit 20;
```

## Data breach (personal data)

Personal data here is: an email address, a name, a phone number, a photo, a claim answer.
A breach is unauthorised access to any of it.

1. Contain (step 1 above), then establish **what** was exposed and **whose**.
2. Tell the institution contact within 24 hours. Under India's DPDP Act the Data Protection
   Board must be notified; the institution decides that, not the desk.
3. Tell affected people plainly: what was exposed, what was not, what they should do. Do not
   speculate about who did it.
4. Fix the cause, then write it up: timeline, cause, blast radius, what changed.

## If the desk itself is the problem

A staff account releasing items without an approved claim is an insider incident, not a bug.
Revoke the role, export the audit log, and compare `handover_records` against
`claims.status = 'approved'` — every handover should have one.

```sql
select h.id, i.ref_code, h.created_at, h.code_verified, h.staff_id
from handover_records h join items i on i.id = h.item_id
where not exists (
  select 1 from claims c where c.id = h.claim_id and c.status = 'approved'
);
```

## Afterwards

Within a week: a short written review, the change that would have prevented it, and a note in
`ops_reviews` so the next person can see it happened.
