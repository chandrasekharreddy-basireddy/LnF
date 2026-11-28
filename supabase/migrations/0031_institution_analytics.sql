-- L&F :: 0031 institution analytics, and the monthly report as a document
--
-- The board can already say how many items are waiting (0007's public_stats) and
-- an admin can see a 60-day cohort (0003's admin_metrics). Neither answers the
-- question an institution actually asks at the end of a month: of everything
-- handed in during this period, how much went back to an owner, where did the
-- rest come from, and how long did a return take?
--
-- This adds two functions and nothing else:
--
--   1. institution_analytics(from, to) — one jsonb snapshot for a date range:
--      a cohort (found items taken in during the period), the claim and handover
--      activity inside it, and the same cohort broken down by zone, category and
--      calendar month. Staff-only, enforced here, not in the page.
--
--   2. log_report_export(from, to) — writes one audit row when the PDF is
--      downloaded, so "who exported the institution's numbers, and when" has an
--      answer. Rate-limited per person.
--
-- Definitions, because a recovery rate that changes definition between months is
-- worse than no number at all:
--
--   handedIn  found items, is_sample = false, created_at::date inside the range
--   returned  those same items, whose status is 'recovered' now
--   rate      returned / handedIn, as a percentage with one decimal; null when
--             handedIn = 0. `lowSample` is true under 5, because 1/1 is 100%
--             and means nothing.
--   handovers handover_records rows created inside the range (activity, not
--             cohort), sample items excluded
--   claims    created inside the range; approved/rejected by decided_at inside it
--
-- Days are UTC days: created_at is timestamptz and Supabase runs the database in
-- UTC, so ::date is a UTC date. A report for a local month boundary may differ by
-- one day from a desk's own logbook. That is stated on the page and in the PDF.
--
-- No person-level field leaves this function. There is no claimant, no email, no
-- reporter id: counts and labels only.

create or replace function public.institution_analytics(
  p_from date default null,
  p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_to date := least(coalesce(p_to, current_date), current_date);
  v_from date := coalesce(p_from, least(coalesce(p_to, current_date), current_date) - 29);
  v_clamped boolean := false;
  v_handed int;
  v_returned int;
  v_handovers int;
  v_median numeric;
begin
  if not public.is_staff() then return null; end if;

  if v_from > v_to then
    return jsonb_build_object('ok', false, 'error', 'RANGE_INVALID');
  end if;

  -- one year is the widest window this report is honest about; anything longer is
  -- cut and said so in `clamped`, rather than silently returning a different range
  if v_to - v_from > 366 then
    v_from := v_to - 366;
    v_clamped := true;
  end if;

  select count(*) into v_handed
  from public.items
  where type = 'found' and is_sample = false
    and created_at::date between v_from and v_to;

  select count(*) into v_returned
  from public.items
  where type = 'found' and is_sample = false
    and created_at::date between v_from and v_to
    and status = 'recovered';

  select count(*) into v_handovers
  from public.handover_records h
  join public.items i on i.id = h.item_id
  where i.is_sample = false
    and h.created_at::date between v_from and v_to;

  select round(percentile_cont(0.5) within group (
           order by extract(epoch from (h.created_at - i.created_at)) / 86400
         )::numeric, 1)
    into v_median
  from public.handover_records h
  join public.items i on i.id = h.item_id
  where i.is_sample = false
    and h.created_at::date between v_from and v_to;

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'days', (v_to - v_from) + 1,
    'clamped', v_clamped,
    'generatedAt', now(),
    'totals', jsonb_build_object(
      'handedIn', v_handed,
      'returned', v_returned,
      'recoveryRate', case when v_handed = 0 then null
        else round((v_returned::numeric / v_handed) * 100, 1) end,
      'lowSample', v_handed < 5,
      'medianDaysToRecovery', v_median,
      'handovers', v_handovers,
      'awaitingCollection', (
        select count(*) from public.items
        where type = 'found' and is_sample = false and status = 'claimed'
      ),
      'openOnBoard', (
        select count(*) from public.items
        where type = 'found' and is_sample = false and status = 'available'
      ),
      'lostReports', (
        select count(*) from public.items
        where type = 'lost' and is_sample = false
          and created_at::date between v_from and v_to
      ),
      'claimsSubmitted', (
        select count(*) from public.claims c
        join public.items i on i.id = c.item_id
        where i.is_sample = false and c.created_at::date between v_from and v_to
      ),
      'claimsApproved', (
        select count(*) from public.claims c
        join public.items i on i.id = c.item_id
        where i.is_sample = false and c.status = 'approved'
          and c.decided_at::date between v_from and v_to
      ),
      'claimsRejected', (
        select count(*) from public.claims c
        join public.items i on i.id = c.item_id
        where i.is_sample = false and c.status = 'rejected'
          and c.decided_at::date between v_from and v_to
      ),
      'disputesOpened', (
        select count(*) from public.disputes d
        where d.created_at::date between v_from and v_to
      ),
      'disputesUpheld', (
        select count(*) from public.disputes d
        where d.status = 'upheld' and d.decided_at::date between v_from and v_to
      )
    ),
    'byZone', coalesce((
      select jsonb_agg(entry order by handed_in desc, label)
      from (
        select coalesce(z.name, 'No zone recorded') as label,
               count(i.id)::int as handed_in,
               jsonb_build_object(
                 'key', coalesce(z.code, 'none'),
                 'label', coalesce(z.name, 'No zone recorded'),
                 'handedIn', count(i.id)::int,
                 'returned', count(i.id) filter (where i.status = 'recovered')::int,
                 'rate', case when count(i.id) = 0 then null
                   else round((count(i.id) filter (where i.status = 'recovered'))::numeric
                              / count(i.id) * 100, 1) end,
                 'lowSample', count(i.id) < 5
               ) as entry
        from public.items i
        left join public.campus_zones z on z.id = i.zone_id
        where i.type = 'found' and i.is_sample = false
          and i.created_at::date between v_from and v_to
        group by z.name, z.code
        having count(i.id) > 0
      ) s
    ), '[]'::jsonb),
    'byCategory', coalesce((
      select jsonb_agg(entry order by handed_in desc, label)
      from (
        select i.category as label,
               count(*)::int as handed_in,
               jsonb_build_object(
                 'key', i.category,
                 'label', i.category,
                 'handedIn', count(*)::int,
                 'returned', count(*) filter (where i.status = 'recovered')::int,
                 'rate', case when count(*) = 0 then null
                   else round((count(*) filter (where i.status = 'recovered'))::numeric
                              / count(*) * 100, 1) end,
                 'lowSample', count(*) < 5
               ) as entry
        from public.items i
        where i.type = 'found' and i.is_sample = false
          and i.created_at::date between v_from and v_to
        group by i.category
      ) s
    ), '[]'::jsonb),
    'byMonth', coalesce((
      select jsonb_agg(entry order by month_start)
      from (
        select m::date as month_start,
               jsonb_build_object(
                 'key', to_char(m, 'YYYY-MM'),
                 'label', to_char(m, 'Mon YYYY'),
                 'handedIn', count(i.id)::int,
                 'returned', count(i.id) filter (where i.status = 'recovered')::int,
                 'handovers', (
                   select count(*)::int from public.handover_records h
                   join public.items hi on hi.id = h.item_id
                   where hi.is_sample = false
                     and h.created_at::date >= m::date
                     and h.created_at::date < (m + interval '1 month')::date
                 ),
                 'rate', case when count(i.id) = 0 then null
                   else round((count(i.id) filter (where i.status = 'recovered'))::numeric
                              / count(i.id) * 100, 1) end,
                 'lowSample', count(i.id) < 5
               ) as entry
        from generate_series(date_trunc('month', v_from::timestamp), date_trunc('month', v_to::timestamp),
                             interval '1 month') m
        left join public.items i
          on i.type = 'found' and i.is_sample = false
         and i.created_at::date >= m::date
         and i.created_at::date < (m + interval '1 month')::date
        group by m
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.institution_analytics(date, date) from public, anon;
grant execute on function public.institution_analytics(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------- export trail
-- Downloading the institution's numbers is a read, but it is a read worth
-- recording: the report is what gets forwarded to a management meeting.
create or replace function public.log_report_export(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if not public.rate_limit('report_export:' || v_uid::text, 60, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  insert into public.audit_logs (actor_id, action, resource_type, detail)
  values (v_uid, 'report_exported', 'report',
          jsonb_build_object('from', p_from, 'to', p_to));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.log_report_export(date, date) from public, anon;
grant execute on function public.log_report_export(date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
