-- Tapiracuai Comercios - Supabase production schema
-- Fecha: 2026-07-09
-- Uso: pegar completo en Supabase SQL Editor y ejecutar una vez.

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

do $$ begin
  create type public.user_role as enum ('cliente','comercio','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.business_status as enum ('pending','active','inactive','suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.promotion_status as enum ('draft','active','paused','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.image_owner_type as enum ('usuario','comercio','producto','promocion','categoria');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.inquiry_status as enum ('new','opened','answered','archived');
exception when duplicate_object then null; end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(unaccent(coalesce(value,''))), '[^a-z0-9]+', '-', 'g'));
$$;

create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role public.user_role not null default 'cliente',
  nombre text,
  apellido text,
  whatsapp text,
  avatar_url text,
  direccion text,
  barrio text,
  ciudad text not null default 'Santaní',
  activo boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references public.usuarios(id) on delete cascade,
  foto_url text,
  direccion text,
  barrio text,
  ciudad text not null default 'Santaní',
  preferencias jsonb not null default '{}'::jsonb,
  perfil_completo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categorias(id) on delete set null,
  nombre text not null,
  slug text not null unique,
  sector text,
  icono text,
  orden integer not null default 0,
  activa boolean not null default true,
  pendiente_aprobacion boolean not null default false,
  creada_por uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.planes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  descripcion text,
  precio_gs integer not null default 0 check (precio_gs >= 0),
  limite_productos integer,
  limite_promociones integer,
  destacado boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comercios (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.usuarios(id) on delete cascade,
  plan_id uuid references public.planes(id) on delete set null,
  categoria_id uuid references public.categorias(id) on delete set null,
  nombre text not null,
  slug text not null unique,
  rubro text not null default 'General',
  categorias text[] not null default array['General']::text[],
  responsable text,
  whatsapp text not null,
  email_contacto text,
  direccion text,
  barrio text,
  ciudad text not null default 'Santaní',
  latitud numeric(10,7),
  longitud numeric(10,7),
  horario_texto text,
  metodos_pago text[] not null default '{}'::text[],
  descripcion text,
  logo_url text,
  portada_url text,
  fotos_urls text[] not null default '{}'::text[],
  verificado boolean not null default false,
  destacado boolean not null default false,
  estado public.business_status not null default 'active',
  perfil_completo integer not null default 0 check (perfil_completo between 0 and 100),
  rating_promedio numeric(3,2) not null default 0 check (rating_promedio between 0 and 5),
  total_opiniones integer not null default 0 check (total_opiniones >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comercio_configuraciones (
  comercio_id uuid primary key references public.comercios(id) on delete cascade,
  acepta_delivery boolean not null default false,
  acepta_transferencia boolean not null default false,
  acepta_tarjeta boolean not null default false,
  acepta_qr boolean not null default false,
  google_maps_url text,
  instagram_url text,
  facebook_url text,
  mostrar_precios boolean not null default true,
  notificaciones_whatsapp boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comercio_horarios (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references public.comercios(id) on delete cascade,
  dia_semana integer not null check (dia_semana between 0 and 6),
  abre time,
  cierra time,
  abierto boolean not null default true,
  nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references public.comercios(id) on delete cascade,
  categoria_id uuid references public.categorias(id) on delete set null,
  nombre text not null,
  slug text not null,
  descripcion text,
  precio_gs integer check (precio_gs is null or precio_gs >= 0),
  stock integer check (stock is null or stock >= 0),
  disponible boolean not null default true,
  activo boolean not null default true,
  destacado boolean not null default false,
  imagen_url text,
  imagen_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comercio_id, slug)
);

create table if not exists public.promociones (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references public.comercios(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  titulo text not null,
  descripcion text,
  descuento text,
  precio_original_gs integer check (precio_original_gs is null or precio_original_gs >= 0),
  precio_promocional_gs integer check (precio_promocional_gs is null or precio_promocional_gs >= 0),
  fecha_inicio date,
  fecha_fin date,
  imagen_url text,
  imagen_path text,
  estado public.promotion_status not null default 'active',
  destacada boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.favoritos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  comercio_id uuid references public.comercios(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (comercio_id is not null or producto_id is not null),
  unique (usuario_id, comercio_id, producto_id)
);

create table if not exists public.consultas (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references public.comercios(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  usuario_id uuid references public.usuarios(id) on delete set null,
  nombre_cliente text,
  whatsapp_cliente text,
  mensaje text,
  origen text not null default 'whatsapp',
  estado public.inquiry_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.opiniones (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references public.comercios(id) on delete cascade,
  usuario_id uuid references public.usuarios(id) on delete set null,
  nombre_publico text,
  calificacion integer not null check (calificacion between 1 and 5),
  comentario text,
  aprobada boolean not null default true,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.estadisticas (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references public.comercios(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete cascade,
  fecha date not null default current_date,
  visitas integer not null default 0 check (visitas >= 0),
  clicks_whatsapp integer not null default 0 check (clicks_whatsapp >= 0),
  apariciones_busqueda integer not null default 0 check (apariciones_busqueda >= 0),
  favoritos integer not null default 0 check (favoritos >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comercio_id, producto_id, fecha)
);

create table if not exists public.imagenes (
  id uuid primary key default gen_random_uuid(),
  owner_type public.image_owner_type not null,
  owner_id uuid not null,
  bucket text not null,
  path text not null,
  public_url text,
  alt_text text,
  principal boolean not null default false,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, path)
);

create table if not exists public.sugerencias (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios(id) on delete set null,
  nombre text,
  email text,
  mensaje text not null,
  estado text not null default 'nueva',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

alter table public.usuarios enable row level security;
alter table public.clientes enable row level security;
alter table public.categorias enable row level security;
alter table public.planes enable row level security;
alter table public.comercios enable row level security;
alter table public.comercio_configuraciones enable row level security;
alter table public.comercio_horarios enable row level security;
alter table public.productos enable row level security;
alter table public.promociones enable row level security;
alter table public.favoritos enable row level security;
alter table public.consultas enable row level security;
alter table public.opiniones enable row level security;
alter table public.estadisticas enable row level security;
alter table public.imagenes enable row level security;
alter table public.sugerencias enable row level security;

create policy "usuarios_select_own_or_admin" on public.usuarios for select using (id = auth.uid() or public.is_admin());
create policy "usuarios_insert_own_or_admin" on public.usuarios for insert with check (id = auth.uid() or public.is_admin());
create policy "usuarios_update_own_or_admin" on public.usuarios for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy "clientes_select_own_or_admin" on public.clientes for select using (usuario_id = auth.uid() or public.is_admin());
create policy "clientes_update_own_or_admin" on public.clientes for update using (usuario_id = auth.uid() or public.is_admin()) with check (usuario_id = auth.uid() or public.is_admin());
create policy "clientes_insert_own_or_admin" on public.clientes for insert with check (usuario_id = auth.uid() or public.is_admin());

create policy "categorias_select_public" on public.categorias for select using (activa = true or public.is_admin());
create policy "categorias_insert_authenticated" on public.categorias for insert with check (auth.uid() is not null);
create policy "categorias_update_admin" on public.categorias for update using (public.is_admin()) with check (public.is_admin());

create policy "planes_select_public" on public.planes for select using (activo = true or public.is_admin());
create policy "planes_admin_all" on public.planes for all using (public.is_admin()) with check (public.is_admin());

create policy "comercios_select_public_or_owner" on public.comercios for select using (estado = 'active' or owner_user_id = auth.uid() or public.is_admin());
create policy "comercios_insert_owner" on public.comercios for insert with check (owner_user_id = auth.uid() or public.is_admin());
create policy "comercios_update_owner_or_admin" on public.comercios for update using (owner_user_id = auth.uid() or public.is_admin()) with check (owner_user_id = auth.uid() or public.is_admin());
create policy "comercios_delete_admin" on public.comercios for delete using (public.is_admin());

create policy "comercio_config_select_public_owner" on public.comercio_configuraciones for select using (public.owns_commerce(comercio_id) or public.is_admin() or exists(select 1 from public.comercios c where c.id = comercio_id and c.estado = 'active'));
create policy "comercio_config_owner_all" on public.comercio_configuraciones for all using (public.owns_commerce(comercio_id) or public.is_admin()) with check (public.owns_commerce(comercio_id) or public.is_admin());

create policy "horarios_select_public_owner" on public.comercio_horarios for select using (public.owns_commerce(comercio_id) or public.is_admin() or exists(select 1 from public.comercios c where c.id = comercio_id and c.estado = 'active'));
create policy "horarios_owner_all" on public.comercio_horarios for all using (public.owns_commerce(comercio_id) or public.is_admin()) with check (public.owns_commerce(comercio_id) or public.is_admin());

create policy "productos_select_public" on public.productos for select using (activo = true or public.owns_commerce(comercio_id) or public.is_admin());
create policy "productos_owner_all" on public.productos for all using (public.owns_commerce(comercio_id) or public.is_admin()) with check (public.owns_commerce(comercio_id) or public.is_admin());

create policy "promociones_select_public" on public.promociones for select using (estado = 'active' or public.owns_commerce(comercio_id) or public.is_admin());
create policy "promociones_owner_all" on public.promociones for all using (public.owns_commerce(comercio_id) or public.is_admin()) with check (public.owns_commerce(comercio_id) or public.is_admin());

create policy "favoritos_own_all" on public.favoritos for all using (usuario_id = auth.uid() or public.is_admin()) with check (usuario_id = auth.uid() or public.is_admin());

create policy "consultas_insert_authenticated" on public.consultas for insert with check (usuario_id = auth.uid() or auth.uid() is not null);
create policy "consultas_select_owner_user_admin" on public.consultas for select using (usuario_id = auth.uid() or public.owns_commerce(comercio_id) or public.is_admin());
create policy "consultas_update_owner_admin" on public.consultas for update using (public.owns_commerce(comercio_id) or public.is_admin()) with check (public.owns_commerce(comercio_id) or public.is_admin());

create policy "opiniones_select_public" on public.opiniones for select using ((aprobada = true and activa = true) or usuario_id = auth.uid() or public.owns_commerce(comercio_id) or public.is_admin());
create policy "opiniones_insert_authenticated" on public.opiniones for insert with check (usuario_id = auth.uid());
create policy "opiniones_update_owner_admin" on public.opiniones for update using (usuario_id = auth.uid() or public.is_admin()) with check (usuario_id = auth.uid() or public.is_admin());
create policy "opiniones_delete_admin" on public.opiniones for delete using (public.is_admin());

create policy "estadisticas_select_owner_admin" on public.estadisticas for select using (public.owns_commerce(comercio_id) or public.is_admin());
create policy "estadisticas_insert_authenticated" on public.estadisticas for insert with check (auth.uid() is not null);
create policy "estadisticas_update_owner_admin" on public.estadisticas for update using (public.owns_commerce(comercio_id) or public.is_admin()) with check (public.owns_commerce(comercio_id) or public.is_admin());

create policy "imagenes_select_public" on public.imagenes for select using (true);
create policy "imagenes_insert_authenticated" on public.imagenes for insert with check (auth.uid() is not null);
create policy "imagenes_update_admin" on public.imagenes for update using (public.is_admin()) with check (public.is_admin());

create policy "sugerencias_insert_any_authenticated" on public.sugerencias for insert with check (auth.uid() is null or usuario_id = auth.uid() or usuario_id is null);
create policy "sugerencias_select_admin" on public.sugerencias for select using (public.is_admin());
create policy "sugerencias_update_admin" on public.sugerencias for update using (public.is_admin()) with check (public.is_admin());

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
