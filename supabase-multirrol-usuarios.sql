-- ============================================================
-- TAPIRACUAI - MIGRACION SEGURA MULTIRROL
-- Ejecutar manualmente en Supabase SQL Editor.
-- No borra datos, no desactiva RLS y no elimina la columna usuarios.role.
-- ============================================================

create table if not exists public.usuario_roles (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  role public.user_role not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (usuario_id, role)
);

drop trigger if exists usuario_roles_set_updated_at on public.usuario_roles;

create trigger usuario_roles_set_updated_at
before update on public.usuario_roles
for each row
execute function public.set_updated_at();

alter table public.usuario_roles enable row level security;

drop policy if exists "usuario_roles_select_own_or_admin" on public.usuario_roles;
drop policy if exists "usuario_roles_insert_own_or_admin" on public.usuario_roles;
drop policy if exists "usuario_roles_update_own_or_admin" on public.usuario_roles;
drop policy if exists "usuario_roles_delete_admin" on public.usuario_roles;

create policy "usuario_roles_select_own_or_admin"
on public.usuario_roles
for select
using (usuario_id = auth.uid() or public.is_admin());

create policy "usuario_roles_insert_own_or_admin"
on public.usuario_roles
for insert
with check (usuario_id = auth.uid() or public.is_admin());

create policy "usuario_roles_update_own_or_admin"
on public.usuario_roles
for update
using (usuario_id = auth.uid() or public.is_admin())
with check (usuario_id = auth.uid() or public.is_admin());

create policy "usuario_roles_delete_admin"
on public.usuario_roles
for delete
using (public.is_admin());

-- Migrar roles existentes sin duplicar usuarios.
insert into public.usuario_roles (usuario_id, role)
select id, role
from public.usuarios
where role is not null
on conflict (usuario_id, role) do update set activo = true;

insert into public.usuario_roles (usuario_id, role)
select usuario_id, 'cliente'::public.user_role
from public.clientes
on conflict (usuario_id, role) do update set activo = true;

insert into public.usuario_roles (usuario_id, role)
select owner_user_id, 'comercio'::public.user_role
from public.comercios
on conflict (usuario_id, role) do update set activo = true;

insert into public.usuario_roles (usuario_id, role)
select id, 'admin'::public.user_role
from public.usuarios
where lower(email) = 'emiliojavi29@gmail.com'
on conflict (usuario_id, role) do update set activo = true;

-- Todo comercio existente también puede usar modo cliente con el mismo user_id.
insert into public.usuario_roles (usuario_id, role)
select distinct owner_user_id, 'cliente'::public.user_role
from public.comercios
on conflict (usuario_id, role) do update set activo = true;

-- Crear perfil cliente para comerciantes existentes si aún no tienen uno.
-- No inventa nombre, apellido, teléfono ni dirección personal.
insert into public.clientes (usuario_id, foto_url, direccion, barrio, ciudad, perfil_completo)
select
  u.id,
  coalesce(u.avatar_url, ''),
  coalesce(u.direccion, ''),
  coalesce(u.barrio, ''),
  coalesce(u.ciudad, 'Santaní'),
  (
    nullif(trim(coalesce(u.nombre, '')), '') is not null
    and nullif(trim(coalesce(u.whatsapp, '')), '') is not null
  )
from public.usuarios u
where exists (
  select 1
  from public.comercios c
  where c.owner_user_id = u.id
)
on conflict (usuario_id) do update
set
  foto_url = coalesce(public.clientes.foto_url, excluded.foto_url),
  direccion = coalesce(public.clientes.direccion, excluded.direccion),
  barrio = coalesce(public.clientes.barrio, excluded.barrio),
  ciudad = coalesce(public.clientes.ciudad, excluded.ciudad),
  perfil_completo = public.clientes.perfil_completo or excluded.perfil_completo;

-- Trigger limpio: Auth crea el usuario y su rol inicial.
-- Cliente crea perfil cliente inicial; Comercio crea rol comercio y completará cliente al guardar perfil.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
begin
  requested_role :=
    case
      when lower(new.email) = 'emiliojavi29@gmail.com' then 'admin'::public.user_role
      when lower(coalesce(new.raw_user_meta_data->>'role', 'cliente')) = 'comercio' then 'comercio'::public.user_role
      else 'cliente'::public.user_role
    end;

  insert into public.usuarios (id, email, role, nombre)
  values (
    new.id,
    lower(new.email),
    requested_role,
    nullif(coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', ''), '')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    role = excluded.role,
    nombre = coalesce(public.usuarios.nombre, excluded.nombre),
    updated_at = now();

  insert into public.usuario_roles (usuario_id, role)
  values (new.id, requested_role)
  on conflict (usuario_id, role) do update set activo = true;

  if requested_role = 'cliente' then
    insert into public.clientes (usuario_id)
    values (new.id)
    on conflict (usuario_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_tapiracuai on auth.users;
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created_tapiracuai
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Verificacion sugerida:
-- select role, count(*) from public.usuario_roles where activo group by role;
-- select count(distinct usuario_id) from public.usuario_roles where role = 'cliente' and activo;
