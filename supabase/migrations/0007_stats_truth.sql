-- L&F :: 0007 open counts describe the board as it is; recovered counts only
-- ever include real handovers, never the sample rows.

create or replace view public.public_stats as
select
  count(*) filter (where type = 'found' and status in ('available', 'claimed')) as open_found,
  count(*) filter (where type = 'lost' and status in ('available', 'claimed')) as open_lost,
  count(*) filter (where status = 'recovered' and is_sample = false) as recovered_total,
  count(*) filter (
    where status = 'recovered' and is_sample = false and created_at > now() - interval '30 days'
  ) as recovered_30d,
  (
    select round(percentile_cont(0.5) within group (
      order by extract(epoch from (h.created_at - i2.created_at)) / 86400
    )::numeric, 1)
    from public.handover_records h
    join public.items i2 on i2.id = h.item_id
    where i2.is_sample = false
  ) as median_days_to_recovery
from public.items
where status in ('available', 'claimed', 'recovered');

grant select on public.public_stats to anon, authenticated;
notify pgrst, 'reload schema';
