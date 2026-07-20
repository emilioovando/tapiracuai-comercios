-- Politicas Storage para foto de perfil de clientes.
-- Ruta usada por la app:
-- user-avatars/clientes/{auth.uid()}/perfil.jpg
--
-- Ejecutar manualmente en Supabase SQL Editor si la subida o actualizacion
-- de la foto devuelve error de permisos/RLS.

drop policy if exists "Clientes suben su foto de perfil" on storage.objects;
create policy "Clientes suben su foto de perfil"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = 'clientes'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "Clientes actualizan su foto de perfil" on storage.objects;
create policy "Clientes actualizan su foto de perfil"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = 'clientes'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = 'clientes'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "Clientes eliminan su foto de perfil" on storage.objects;
create policy "Clientes eliminan su foto de perfil"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = 'clientes'
  and (storage.foldername(name))[2] = auth.uid()::text
);
