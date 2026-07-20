-- ============================================================
-- TAPIRACUAI SUPABASE - PARTE 2: INDICES Y RELACIONES
-- Ejecutar esta parte completa en Supabase SQL Editor.
-- ============================================================

create index if not exists idx_comercios_owner on public.comercios(owner_user_id);
create index if not exists idx_comercios_estado on public.comercios(estado);
create index if not exists idx_comercios_categoria on public.comercios(categoria_id);
create index if not exists idx_productos_comercio on public.productos(comercio_id);
create index if not exists idx_promociones_comercio on public.promociones(comercio_id);
create index if not exists idx_favoritos_usuario on public.favoritos(usuario_id);
create index if not exists idx_consultas_comercio on public.consultas(comercio_id);
create index if not exists idx_estadisticas_comercio_fecha on public.estadisticas(comercio_id, fecha);

create trigger usuarios_set_updated_at before update on public.usuarios for each row execute function public.set_updated_at();
create trigger clientes_set_updated_at before update on public.clientes for each row execute function public.set_updated_at();
create trigger categorias_set_updated_at before update on public.categorias for each row execute function public.set_updated_at();
create trigger planes_set_updated_at before update on public.planes for each row execute function public.set_updated_at();
create trigger comercios_set_updated_at before update on public.comercios for each row execute function public.set_updated_at();
create trigger comercio_configuraciones_set_updated_at before update on public.comercio_configuraciones for each row execute function public.set_updated_at();
create trigger comercio_horarios_set_updated_at before update on public.comercio_horarios for each row execute function public.set_updated_at();
create trigger productos_set_updated_at before update on public.productos for each row execute function public.set_updated_at();
create trigger promociones_set_updated_at before update on public.promociones for each row execute function public.set_updated_at();
create trigger consultas_set_updated_at before update on public.consultas for each row execute function public.set_updated_at();
create trigger opiniones_set_updated_at before update on public.opiniones for each row execute function public.set_updated_at();
create trigger estadisticas_set_updated_at before update on public.estadisticas for each row execute function public.set_updated_at();
create trigger imagenes_set_updated_at before update on public.imagenes for each row execute function public.set_updated_at();
create trigger sugerencias_set_updated_at before update on public.sugerencias for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and (u.role = 'admin' or lower(u.email) = 'emiliojavi29@gmail.com')
  );
$$;

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

-- DATOS INICIALES

insert into public.planes (nombre, descripcion, precio_gs, limite_productos, limite_promociones, destacado, activo)
values ('Gratis', 'Plan inicial para pruebas reales en Santaní.', 0, 30, 5, false, true)
on conflict (nombre) do nothing;

insert into public.categorias (nombre, slug, sector, icono, orden, activa)
values
  ('General','general','General','storefront',1,true),
  ('Alimentos y bebidas','alimentos-y-bebidas','Comercio','shopping_basket',2,true),
  ('Farmacias','farmacias','Salud','local_pharmacy',3,true),
  ('Ferretería','ferreteria','Servicios','construction',4,true),
  ('Ropa y accesorios','ropa-y-accesorios','Comercio','checkroom',5,true),
  ('Repuestos','repuestos','Automotor','build',6,true),
  ('Personalizados','personalizados','Servicios','brush',7,true),
  ('Hospedajes','hospedajes','Turismo','hotel',8,true)
on conflict (slug) do nothing;
