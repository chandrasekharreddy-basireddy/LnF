-- L&F :: 0004 storage, zones and clearly-labelled sample rows

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "item photos: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'item-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "item photos: staff can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'item-photos' and public.is_staff());

create policy "item photos: owner can remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = auth.uid()::text);

insert into public.campus_zones (code, name, description, sort_order) values
  ('main-gate', 'Main Gate & Security Desk', 'Gate, visitor lobby and the security counter', 10),
  ('library', 'Central Library', 'Reading rooms, stacks and study desks', 20),
  ('lecture', 'Lecture Halls', 'Classrooms and tutorial rooms', 30),
  ('lab', 'Labs & Workshops', 'Computer, electronics and design labs', 40),
  ('canteen', 'Canteen & Food Court', 'Dining hall, counters and seating', 50),
  ('sports', 'Sports Complex', 'Ground, courts, gym and changing rooms', 60),
  ('hostel', 'Hostels', 'Residence blocks and common rooms', 70),
  ('parking', 'Parking & Shuttle Stop', 'Two-wheeler, car parking and bus bay', 80),
  ('admin', 'Admin Block', 'Offices, accounts and admissions', 90),
  ('auditorium', 'Auditorium & Event Spaces', 'Auditorium, seminar hall and foyer', 100)
on conflict (code) do nothing;

-- Sample rows so a brand-new board is not a dead end. Every row is flagged
-- is_sample = true, is excluded from the published statistics, and one click in
-- /admin removes them all.
insert into public.items
  (type, status, category, title, public_description, zone_id, spot, event_date,
   custody_label, verification_question, reporter_id, reporter_kind, is_sample, published_at)
select *
from (values
  ('found'::public.item_type, 'available'::public.item_status, 'electronics', 'Black wireless earbuds in a charging case',
   'Matte black earbuds in an open case. A small sticker on the back of the case. Found on a study desk.',
   (select id from public.campus_zones where code = 'library'), 'Quiet study desks, north windows',
   current_date - 2, 'Main Gate & Security Desk', 'What is the Bluetooth name of the case?',
   null::uuid, 'staff', true, now() - interval '2 days'),
  ('found'::public.item_type, 'available'::public.item_status, 'bags', 'Grey canvas backpack with a blue tag',
   'Single-compartment canvas bag, zip works fine, has a blue luggage tag with the name partly rubbed off. No laptop inside.',
   (select id from public.campus_zones where code = 'canteen'), 'Table near the billing counter',
   current_date - 3, 'Canteen supervisor desk', 'What is written on the inside label?',
   null::uuid, 'staff', true, now() - interval '3 days'),
  ('found'::public.item_type, 'available'::public.item_status, 'documents', 'Steel water bottle with a dented base',
   'One-litre steel bottle, blue cap, dent on the bottom edge. Name scratched off.',
   (select id from public.campus_zones where code = 'sports'), 'Bench by court 2',
   current_date - 1, 'Sports office', 'What sticker is on the bottle?',
   null::uuid, 'staff', true, now() - interval '1 day'),
  ('found'::public.item_type, 'available'::public.item_status, 'accessories', 'Spectacles in a brown hard case',
   'Thin gold frame, brown hard case, one lens has a small scratch at the edge.',
   (select id from public.campus_zones where code = 'lecture'), 'Room LH-204, back row',
   current_date - 4, 'Main Gate & Security Desk', 'What is taped inside the case lid?',
   null::uuid, 'staff', true, now() - interval '4 days'),
  ('lost'::public.item_type, 'available'::public.item_status, 'electronics', 'Black wired earphones lost near the shuttle stop',
   'Wired earphones, black, with one white earbud tip. Lost while boarding the 5:30 shuttle.',
   (select id from public.campus_zones where code = 'parking'), 'Shuttle bay, near the notice board',
   current_date - 2, null, null, null, 'member', true, now() - interval '2 days'),
  ('found'::public.item_type, 'recovered'::public.item_status, 'electronics', 'Silver laptop charger, 65W USB-C',
   'Compact 65W charger with a USB-C cable, cable has a red velcro tie.',
   (select id from public.campus_zones where code = 'lab'), 'Lab 3, seat 12',
   current_date - 20, 'Main Gate & Security Desk', 'What is the brand printed on the brick?',
   null::uuid, 'staff', true, now() - interval '20 days')
) as seed(type, status, category, title, public_description, zone_id, spot, event_date,
          custody_label, verification_question, reporter_id, reporter_kind, is_sample, published_at)
where not exists (select 1 from public.items where is_sample);

insert into public.item_private (item_id, answer_hash)
select id, encode(digest(lower('redmi buds'), 'sha256'), 'hex')
from public.items where is_sample and title like 'Black wireless earbuds%'
on conflict do nothing;

insert into public.item_private (item_id, answer_hash)
select id, encode(digest(lower('blue ink'), 'sha256'), 'hex')
from public.items where is_sample and title like 'Grey canvas backpack%'
on conflict do nothing;

-- one sample handover so the recovered count and median are not zero
insert into public.handover_records (item_id, claim_id, code_verified, note, created_at)
select i.id, null, true, 'Sample record', now() - interval '15 days'
from public.items i
where i.is_sample and i.status = 'recovered'
  and not exists (select 1 from public.handover_records h where h.item_id = i.id);

notify pgrst, 'reload schema';
