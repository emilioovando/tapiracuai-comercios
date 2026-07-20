-- ============================================================
-- TAPIRACUAI SUPABASE - PARTE 4: BUCKETS Y STORAGE
-- Ejecutar esta parte completa en Supabase SQL Editor.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('business-logos', 'business-logos', true, 5242880, array['image/png','image/jpeg','image/webp']),
  ('business-covers', 'business-covers', true, 10485760, array['image/png','image/jpeg','image/webp']),
  ('product-images', 'product-images', true, 10485760, array['image/png','image/jpeg','image/webp']),
  ('promotion-images', 'promotion-images', true, 10485760, array['image/png','image/jpeg','image/webp']),
  ('user-avatars', 'user-avatars', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "storage_public_read_tapiracuai_images"
on storage.objects for select
using (bucket_id in ('business-logos','business-covers','product-images','promotion-images','user-avatars'));

create policy "storage_authenticated_insert_tapiracuai_images"
on storage.objects for insert
with check (
  auth.uid() is not null
  and bucket_id in ('business-logos','business-covers','product-images','promotion-images','user-avatars')
);

create policy "storage_authenticated_update_own_folder"
on storage.objects for update
using (
  auth.uid() is not null
  and bucket_id in ('business-logos','business-covers','product-images','promotion-images','user-avatars')
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  auth.uid() is not null
  and bucket_id in ('business-logos','business-covers','product-images','promotion-images','user-avatars')
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "storage_authenticated_delete_own_folder"
on storage.objects for delete
using (
  auth.uid() is not null
  and bucket_id in ('business-logos','business-covers','product-images','promotion-images','user-avatars')
  and (storage.foldername(name))[1] = auth.uid()::text
);
