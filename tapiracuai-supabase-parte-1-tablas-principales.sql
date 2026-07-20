-- ============================================================
-- TAPIRACUAI SUPABASE - PARTE 1: TABLAS PRINCIPALES
-- Ejecutar esta parte completa en Supabase SQL Editor.
-- ============================================================

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
