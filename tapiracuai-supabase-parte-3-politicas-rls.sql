-- ============================================================
-- TAPIRACUAI SUPABASE - PARTE 3: POLITICAS RLS
-- Ejecutar esta parte completa en Supabase SQL Editor.
-- ============================================================

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
