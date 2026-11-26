-- L&F :: 0002 public projection, RLS and grants
-- Rule: the public surface is a set of views and functions with an explicit
-- column list. Nothing under app/(public) ever reads a base table.

create or replace view public.public_items as
select
  i.id,
  i.ref_code,
  i.type,
  i.status,
  i.category,
  i.title,
  i.public_description,
  z.name as zone_label,
  z.code as zone_code,
  i.spot,
  i.event_date,
  i.custody_label,
  i.verification_question,
  i.is_sample,
  i.created_at,
  i.published_at
from public.items i
left join public.campus_zones z on z.id = i.zone_id
where i.status in ('available', 'claimed', 'recovered');

create or replace view public.public_item_images as
select
  im.id,
  im.item_id,
  im.storage_path,
  im.alt_text,
  im.width,
  im.height,
  im.position
from public.item_images im
join public.items i on i.id = im.item_id
where i.status in ('available', 'claimed', 'recovered')
  and i.sensitive_hidden_photo = false;

create or replace view public.public_zones as
select code, name, description, sort_order
from public.campus_zones
where is_active = true
order by sort_order, name;

create or replace view public.public_stats as
select
  count(*) filter (where type = 'found' and status in ('available', 'claimed')) as open_found,
  count(*) filter (where type = 'lost' and status in ('available', 'claimed')) as open_lost,
  count(*) filter (where status = 'recovered') as recovered_total,
  count(*) filter (where status = 'recovered' and created_at > now() - interval '30 days') as recovered_30d,
  (
    select round(percentile_cont(0.5) within group (
      order by extract(epoch from (h.created_at - i2.created_at)) / 86400
    )::numeric, 1)
    from public.handover_records h
    join public.items i2 on i2.id = h.item_id
    where i2.is_sample = false
  ) as median_days_to_recovery
from public.items
where is_sample = false;

-- ---------------- RLS ----------------
alter table public.campus_zones enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.items enable row level security;
alter table public.item_private enable row level security;
alter table public.item_images enable row level security;
alter table public.claims enable row level security;
alter table public.claim_events enable row level security;
alter table public.handover_codes enable row level security;
alter table public.handover_records enable row level security;
alter table public.match_alerts enable row level security;
alter table public.notifications enable row level security;
alter table public.abuse_reports enable row level security;
alter table public.audit_logs enable row level security;
alter table public.events enable row level security;
alter table public.rate_limits enable row level security;

create policy zones_read on public.campus_zones for select to anon, authenticated using (true);

create policy profiles_read_own on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy roles_read_own on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy items_read_own on public.items for select to authenticated
  using (reporter_id = auth.uid() or public.is_staff());

create policy item_private_staff on public.item_private for select to authenticated
  using (public.is_staff());

create policy item_images_own on public.item_images for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.items i where i.id = item_id and i.reporter_id = auth.uid())
  );

create policy claims_read_own on public.claims for select to authenticated
  using (claimant_id = auth.uid() or public.is_staff());

create policy claim_events_read_own on public.claim_events for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.claims c where c.id = claim_id and c.claimant_id = auth.uid())
  );

create policy handover_records_read on public.handover_records for select to authenticated
  using (public.is_staff());

create policy match_alerts_read_own on public.match_alerts for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.items i where i.id = lost_item_id and i.reporter_id = auth.uid())
  );

create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy abuse_reports_insert on public.abuse_reports for insert to authenticated
  with check (reporter_id = auth.uid());
create policy abuse_reports_read on public.abuse_reports for select to authenticated
  using (public.is_staff());

create policy audit_logs_read_admin on public.audit_logs for select to authenticated
  using (public.is_admin());

-- no policies on events, rate_limits, handover_codes: server/service role only

-- ---------------- grants ----------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.public_items to anon, authenticated;
grant select on public.public_item_images to anon, authenticated;
grant select on public.public_zones to anon, authenticated;
grant select on public.public_stats to anon, authenticated;

grant select on public.campus_zones to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select on public.items to authenticated;
grant select on public.item_images to authenticated;
grant select on public.claims to authenticated;
grant select on public.claim_events to authenticated;
grant select on public.handover_records to authenticated;
grant select on public.match_alerts to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert on public.abuse_reports to authenticated;
grant select on public.audit_logs to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated;
