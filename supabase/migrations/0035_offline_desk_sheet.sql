-- L&F :: 0035 the desk sheet, for a desk with no signal
--
-- The counter sits at a gate. The wifi there drops, and the person at the
-- counter is holding a bag asking "is this mine?". Today the answer is a phone
-- hotspot or a walk to a better corner.
--
-- This adds one read: desk_sheet() → the items currently on the board, in a
-- shape small enough to keep in a browser for a shift. The desk saves it while
-- the network is up; /offline.html reads it back when it is not.
--
-- The sheet is deliberately a copy of what is already public. It carries:
--   ref, title, category, type, status, zone name, spot, event date, held since.
-- It carries, in no field:
--   * who reported or handed in the item (no reporter_id, no contact_email,
--     no finder_email, no reporter_kind);
--   * what the verification question is, or its answer hash (item_private);
--   * any serial number, bin code or private note (item_private);
--   * any claim, claimant, code or handover detail.
-- That is the point: a sheet left on a shared desk machine, or in a browser
-- that outlives a shift, must not be worth stealing. Anything a stranger reads
-- from it is already on /browse.
--
-- Authorization lives here, not in the page:
--   * no session        → AUTH_REQUIRED
--   * not staff         → NOT_STAFF
--   * staff             → the sheet
-- `anon` cannot execute it at all.

create or replace function public.desk_sheet(p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 300), 500));
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not public.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'NOT_STAFF');
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'ref', i.ref_code,
               'title', i.title,
               'category', i.category,
               'type', i.type::text,
               'status', i.status::text,
               'zone', z.name,
               'spot', i.spot,
               'eventDate', i.event_date,
               'heldSince', i.created_at)
             order by i.created_at desc),
           '[]'::jsonb)
    into v_rows
    from (
      select it.*
        from public.items it
       where it.status in ('available', 'claimed')
         and it.published_at is not null
       order by it.created_at desc
       limit v_limit
    ) i
    left join public.campus_zones z on z.id = i.zone_id;

  return jsonb_build_object(
    'ok', true,
    'generatedAt', now(),
    'count', jsonb_array_length(v_rows),
    'rows', v_rows);
end $$;

revoke all on function public.desk_sheet(int) from public;
revoke all on function public.desk_sheet(int) from anon;
grant execute on function public.desk_sheet(int) to authenticated;

comment on function public.desk_sheet(int) is
  'Items currently on the board, as a public-safe sheet a staff desk can keep offline (0035).';
