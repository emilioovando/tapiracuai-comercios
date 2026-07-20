-- ============================================================
-- TAPIRACUAI - AUTH TRIGGER CLEAN
-- Ejecutar completo en Supabase SQL Editor.
--
-- Objetivo:
-- - Usar UN SOLO método para crear public.usuarios: trigger auth.users.
-- - Eliminar triggers duplicados/antiguos sobre auth.users.
-- - Eliminar RPC ensure_user_profile para no tener doble método.
-- - Mantener RLS activo.
-- - No permitir que la app inserte/upsertee usuarios desde el navegador.
-- ============================================================

alter table public.usuarios enable row level security;
alter table public.clientes enable row level security;

alter table public.usuarios no force row level security;
alter table public.clientes no force row level security;

-- Eliminar funciones/métodos alternativos para evitar doble escritura.
drop function if exists public.ensure_user_profile(text, text);

-- Eliminar cualquier trigger no interno existente sobre auth.users.
do $$
declare
  trigger_record record;
begin
  for trigger_record in
    select t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and not t.tgisinternal
  loop
    execute format('drop trigger if exists %I on auth.users', trigger_record.tgname);
  end loop;
end;
$$;

drop policy if exists "usuarios_select_own_or_admin" on public.usuarios;
drop policy if exists "usuarios_insert_own_or_admin" on public.usuarios;
drop policy if exists "usuarios_update_own_or_admin" on public.usuarios;

create policy "usuarios_select_own_or_admin"
on public.usuarios
for select
using (id = auth.uid() or public.is_admin());

create policy "usuarios_update_own_or_admin"
on public.usuarios
for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "clientes_select_own_or_admin" on public.clientes;
drop policy if exists "clientes_insert_own_or_admin" on public.clientes;
drop policy if exists "clientes_update_own_or_admin" on public.clientes;

create policy "clientes_select_own_or_admin"
on public.clientes
for select
using (usuario_id = auth.uid() or public.is_admin());

create policy "clientes_insert_own_or_admin"
on public.clientes
for insert
with check (usuario_id = auth.uid() or public.is_admin());

create policy "clientes_update_own_or_admin"
on public.clientes
for update
using (usuario_id = auth.uid() or public.is_admin())
with check (usuario_id = auth.uid() or public.is_admin());

create or replace function public.resolve_auth_role(input_role text, input_email text)
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when lower(coalesce(input_email, '')) = 'emiliojavi29@gmail.com' then 'admin'::public.user_role
    when lower(coalesce(input_role, 'cliente')) = 'comercio' then 'comercio'::public.user_role
    else 'cliente'::public.user_role
  end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_role public.user_role;
  resolved_name text;
begin
  resolved_role := public.resolve_auth_role(new.raw_user_meta_data->>'role', new.email);
  resolved_name := coalesce(
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'businessName',
    split_part(new.email, '@', 1)
  );

  insert into public.usuarios (id, email, role, nombre)
  values (new.id, lower(new.email), resolved_role, resolved_name)
  on conflict (id) do update set
    email = excluded.email,
    role = excluded.role,
    nombre = coalesce(nullif(public.usuarios.nombre, ''), excluded.nombre),
    updated_at = now();

  insert into public.clientes (usuario_id)
  values (new.id)
  on conflict (usuario_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Backfill para usuarios ya creados en Supabase Auth que no tengan perfil.
insert into public.usuarios (id, email, role, nombre, created_at, updated_at)
select
  au.id,
  lower(au.email),
  public.resolve_auth_role(au.raw_user_meta_data->>'role', au.email),
  coalesce(
    au.raw_user_meta_data->>'name',
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'businessName',
    split_part(au.email, '@', 1)
  ),
  coalesce(au.created_at, now()),
  now()
from auth.users au
where not exists (
  select 1
  from public.usuarios pu
  where pu.id = au.id
);

insert into public.clientes (usuario_id)
select au.id
from auth.users au
where not exists (
  select 1
  from public.clientes c
  where c.usuario_id = au.id
);

-- Verificación 1: debe devolver un solo trigger.
-- select tgname
-- from pg_trigger t
-- join pg_class c on c.oid = t.tgrelid
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'auth'
--   and c.relname = 'users'
--   and not t.tgisinternal;

-- Verificación 2: no debe existir ensure_user_profile.
-- select proname
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and proname = 'ensure_user_profile';

-- Verificación 3: usuarios existentes en Auth sin perfil.
-- select au.id, au.email
-- from auth.users au
-- left join public.usuarios pu on pu.id = au.id
-- where pu.id is null;
