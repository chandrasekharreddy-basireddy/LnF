-- L&F :: 0005 photo write path and public read of published photos

grant insert on public.item_images to authenticated;

create policy item_images_insert_own on public.item_images
  for insert to authenticated
  with check (
    exists (select 1 from public.items i where i.id = item_id and i.reporter_id = auth.uid())
  );

create policy item_images_delete_own on public.item_images
  for delete to authenticated
  using (
    exists (select 1 from public.items i where i.id = item_id and i.reporter_id = auth.uid())
  );

grant delete on public.item_images to authenticated;

-- anyone may read a photo that belongs to a published listing; nothing else
create policy "item photos: read published" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'item-photos'
    and exists (select 1 from public.public_item_images p where p.storage_path = storage.objects.name)
  );

notify pgrst, 'reload schema';
