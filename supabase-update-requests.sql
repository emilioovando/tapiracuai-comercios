-- Tapiracuai Comercios
-- Solicitudes de actualizacion desde Administrador hacia Comercio.
-- No crea tablas nuevas. Amplia public.sugerencias para asociar cada solicitud a un comercio.

alter table public.sugerencias
  add column if not exists comercio_id uuid references public.comercios(id) on delete cascade,
  add column if not exists tipo text not null default 'sugerencia',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists sugerencias_comercio_id_idx
  on public.sugerencias (comercio_id);

create index if not exists sugerencias_tipo_idx
  on public.sugerencias (tipo);

drop policy if exists "sugerencias_select_admin" on public.sugerencias;
drop policy if exists "sugerencias_update_admin" on public.sugerencias;
drop policy if exists "sugerencias_select_owner_or_admin" on public.sugerencias;
drop policy if exists "sugerencias_update_owner_or_admin" on public.sugerencias;

create policy "sugerencias_select_owner_or_admin"
on public.sugerencias
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.comercios c
    where c.id = sugerencias.comercio_id
      and c.owner_user_id = auth.uid()
  )
);

create policy "sugerencias_update_owner_or_admin"
on public.sugerencias
for update
using (
  public.is_admin()
  or exists (
    select 1
    from public.comercios c
    where c.id = sugerencias.comercio_id
      and c.owner_user_id = auth.uid()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.comercios c
    where c.id = sugerencias.comercio_id
      and c.owner_user_id = auth.uid()
  )
);
