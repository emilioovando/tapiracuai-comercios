-- Corrección RLS para permitir que un comerciante autenticado
-- cree, edite y elimine productos únicamente de su propio comercio.
-- Ejecutar en Supabase SQL Editor solo si el error completo indica bloqueo RLS en public.productos.

create or replace function public.owns_commerce(commerce_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.comercios c
    where c.id = commerce_id
      and c.owner_user_id = auth.uid()
  );
$$;

alter table public.productos enable row level security;

drop policy if exists "productos_select_public" on public.productos;
drop policy if exists "productos_owner_all" on public.productos;

create policy "productos_select_public"
on public.productos
for select
using (
  activo = true
  or public.owns_commerce(comercio_id)
  or public.is_admin()
);

create policy "productos_owner_all"
on public.productos
for all
using (
  public.owns_commerce(comercio_id)
  or public.is_admin()
)
with check (
  public.owns_commerce(comercio_id)
  or public.is_admin()
);
