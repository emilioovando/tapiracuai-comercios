-- Tapiracuai Comercios
-- Politicas RLS necesarias para que el administrador pueda eliminar un comercio
-- limpiando relaciones sin dejar registros huerfanos.
-- Ejecutar en Supabase SQL Editor si el boton Eliminar devuelve errores RLS.

drop policy if exists "consultas_delete_admin" on public.consultas;
create policy "consultas_delete_admin"
on public.consultas
for delete
using (public.is_admin());

drop policy if exists "estadisticas_delete_admin" on public.estadisticas;
create policy "estadisticas_delete_admin"
on public.estadisticas
for delete
using (public.is_admin());

drop policy if exists "imagenes_delete_admin" on public.imagenes;
create policy "imagenes_delete_admin"
on public.imagenes
for delete
using (public.is_admin());

drop policy if exists "sugerencias_delete_admin" on public.sugerencias;
create policy "sugerencias_delete_admin"
on public.sugerencias
for delete
using (public.is_admin());
