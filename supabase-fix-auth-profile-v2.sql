-- ============================================================
-- TAPIRACUAI - FIX AUTH PERFIL V2
-- Ejecutar completo en Supabase SQL Editor.
--
-- Corrige:
-- - new row violates row-level security policy for table "usuarios"
-- - perfil faltante en public.usuarios después de Supabase Auth
-- - role comercio no guardado correctamente desde metadata
-- ============================================================

alter table public.usuarios enable row level security;
alter table public.clientes enable row level security;

alter table public.usuarios no force row level security;
alter table public.clientes no force row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.usuarios to authenticated;
grant select, insert, update on public.clientes to authenticated;

drop policy if exists "usuarios_select_own_or_admin" on public.usuarios;
drop policy if exists "usuarios_insert_own_or_admin" on public.usuarios;
drop policy if exists "usuarios_update_own_or_admin" on public.usuarios;

create policy "usuarios_select_own_or_admin"
on public.usuarios
for select
using (id = auth.uid() or public.is_admin());

create policy "usuarios_insert_own_or_admin"
on public.usuarios
for insert
with check (id = auth.uid() or public.is_admin());

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

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.ensure_user_profile(
  requested_role text default null,
  requested_name text default null
)
returns public.usuarios
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_user_id uuid;
  auth_email text;
  meta_role text;
  meta_name text;
  resolved_role public.user_role;
  resolved_name text;
  result public.usuarios;
begin
  auth_user_id := auth.uid();
  auth_email := lower(coalesce(auth.email(), ''));

  if auth_user_id is null or auth_email = '' then
    raise exception 'Usuario no autenticado';
  end if;

  meta_role := coalesce(requested_role, auth.jwt()->'user_metadata'->>'role', 'cliente');
  meta_name := coalesce(
    requested_name,
    auth.jwt()->'user_metadata'->>'name',
    auth.jwt()->'user_metadata'->>'full_name',
    auth.jwt()->'user_metadata'->>'businessName',
    split_part(auth_email, '@', 1)
  );
  resolved_role := public.resolve_auth_role(meta_role, auth_email);
  resolved_name := coalesce(nullif(meta_name, ''), split_part(auth_email, '@', 1));

  insert into public.usuarios (id, email, role, nombre, last_login_at)
  values (auth_user_id, auth_email, resolved_role, resolved_name, now())
  on conflict (id) do update set
    email = excluded.email,
    role = case
      when public.usuarios.role = 'admin' then public.usuarios.role
      when excluded.role = 'comercio' then 'comercio'::public.user_role
      else public.usuarios.role
    end,
    nombre = coalesce(nullif(public.usuarios.nombre, ''), excluded.nombre),
    last_login_at = now(),
    updated_at = now()
  returning * into result;

  insert into public.clientes (usuario_id)
  values (auth_user_id)
  on conflict (usuario_id) do nothing;

  return result;
end;
$$;

grant execute on function public.ensure_user_profile(text, text) to authenticated;

-- Verificación:
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('usuarios', 'clientes')
-- order by tablename, policyname;
