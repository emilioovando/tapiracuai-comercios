-- Tapiracuai Comercios - Banners informativos
-- Ejecutar en Supabase SQL Editor.
-- Crea la tabla, RLS y bucket de Storage para banners administrados.

create extension if not exists pgcrypto;

create table if not exists public.banners_informativos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text not null default '',
  imagen_url text not null default '',
  fecha_inicio timestamptz not null,
  fecha_fin timestamptz not null,
  activo boolean not null default true,
  creado_por uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint banners_informativos_fechas_chk check (fecha_fin > fecha_inicio)
);

create index if not exists banners_informativos_vigencia_idx
  on public.banners_informativos (activo, fecha_inicio, fecha_fin, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_banners_informativos_updated_at on public.banners_informativos;
create trigger set_banners_informativos_updated_at
before update on public.banners_informativos
for each row
execute function public.set_updated_at();

alter table public.banners_informativos enable row level security;

create or replace function public.tapiracuai_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = 'emiliojavi29@gmail.com'
  );
$$;

drop policy if exists "Admin gestiona banners informativos" on public.banners_informativos;
create policy "Admin gestiona banners informativos"
on public.banners_informativos
for all
to authenticated
using (public.tapiracuai_is_admin())
with check (public.tapiracuai_is_admin());

drop policy if exists "Clientes leen banners activos vigentes" on public.banners_informativos;
create policy "Clientes leen banners activos vigentes"
on public.banners_informativos
for select
to authenticated
using (
  activo = true
  and now() >= fecha_inicio
  and now() <= fecha_fin
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'banners',
  'banners',
  true,
  6291456,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public lee imagenes de banners Tapiracuai" on storage.objects;
create policy "Public lee imagenes de banners Tapiracuai"
on storage.objects
for select
to public
using (bucket_id = 'banners');

drop policy if exists "Admin sube imagenes de banners Tapiracuai" on storage.objects;
create policy "Admin sube imagenes de banners Tapiracuai"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'banners'
  and public.tapiracuai_is_admin()
);

drop policy if exists "Admin actualiza imagenes de banners Tapiracuai" on storage.objects;
create policy "Admin actualiza imagenes de banners Tapiracuai"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'banners'
  and public.tapiracuai_is_admin()
)
with check (
  bucket_id = 'banners'
  and public.tapiracuai_is_admin()
);

drop policy if exists "Admin elimina imagenes de banners Tapiracuai" on storage.objects;
create policy "Admin elimina imagenes de banners Tapiracuai"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'banners'
  and public.tapiracuai_is_admin()
);

