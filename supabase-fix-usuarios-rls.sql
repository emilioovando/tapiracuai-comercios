-- ============================================================
-- TAPIRACUAI - FIX RLS USUARIOS / REGISTRO SUPABASE AUTH
-- Ejecutar en Supabase SQL Editor.
-- Corrige: new row violates row-level security policy for table "usuarios"
-- ============================================================

alter table public.usuarios enable row level security;

drop policy if exists "usuarios_insert_own_or_admin" on public.usuarios;

create policy "usuarios_insert_own_or_admin"
on public.usuarios
for insert
with check (id = auth.uid() or public.is_admin());

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuarios (id, email, role, nombre)
  values (
    new.id,
    lower(new.email),
    case
      when lower(new.email) = 'emiliojavi29@gmail.com' then 'admin'::public.user_role
      when lower(coalesce(new.raw_user_meta_data->>'role', 'cliente')) = 'comercio' then 'comercio'::public.user_role
      else 'cliente'::public.user_role
    end,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update set
    email = excluded.email,
    role = excluded.role,
    nombre = coalesce(usuarios.nombre, excluded.nombre),
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

-- Verificacion rapida:
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'usuarios'
-- order by policyname;
