-- L&F :: 0050 "today" meant UTC, so tonight's reports were rejected
--
-- items_event_date_check compared event_date against current_date, which on
-- Supabase is UTC. Between 00:00 and 05:30 IST the server is still on
-- yesterday, so a person choosing "today" in the date picker — the most common
-- choice there is — got:
--   23514: new violating check constraint "items_event_date_check"
-- which surfaced as "We could not save that report. Try again in a moment."
-- Reported from production at 01:48 IST on 29/11.
--
-- The campus is in IST; the comparison has to be too. create_item already
-- validated against the IST date, which is why the function's own check passed
-- and only the table constraint fired.

alter table public.items drop constraint if exists items_event_date_check;
alter table public.items add constraint items_event_date_check
  check (event_date <= ((now() at time zone 'Asia/Kolkata')::date + 1));

-- A day of tolerance rather than none: the constraint is evaluated at insert
-- time, and a report written at 23:59 IST must still be accepted by a server
-- that has already rolled over to the next UTC day.
comment on constraint items_event_date_check on public.items is
  'No future dates, with a day of slack so an IST evening is not rejected by a UTC clock.';
