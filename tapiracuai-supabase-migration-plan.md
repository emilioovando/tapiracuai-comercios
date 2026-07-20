# Tapiracuai - Plan de migracion segura a Supabase

## Estado actual

La app todavia usa `localStorage` como almacenamiento principal. Eso sirve para pruebas, pero no para produccion.

Claves locales actuales:

- `tapiracuai_users`: usuarios demo/locales.
- `tapiracuai_auth_session`: sesion local.
- `tapiracuai_client_profiles`: perfiles de clientes.
- `tapiracuai_businesses`: comercios globales locales.
- `tapiracuai_comercios`: comercios legacy.
- `tapiracuai_products`: productos.
- `tapiracuai_promotions`: promociones.
- `tapiracuai_reviews`: resenas.
- `tapiracuai_favorites`: favoritos.
- `tapiracuai_stats`: estadisticas.
- `tapiracuai_pending_categories`: categorias sugeridas.

## Objetivo

Pasar la fuente principal de datos a Supabase:

- Supabase Auth para usuarios y sesiones.
- PostgreSQL para comercios, productos, promociones, favoritos, consultas, resenas, estadisticas y configuracion.
- Supabase Storage para logo, portada, fotos de productos, promociones y avatares.
- `localStorage` solo como cache temporal o respaldo de migracion.

## Orden recomendado

1. Ejecutar `tapiracuai-supabase-schema.sql` en Supabase SQL Editor.
2. Confirmar que se crearon tablas, politicas RLS y buckets.
3. Pasar a Codex:
   - Project URL de Supabase.
   - anon public key.
4. Conectar `auth-config.js` con esos valores.
5. Reemplazar servicios locales por servicios Supabase.
6. Crear exportador temporal de localStorage a JSON.
7. Crear importador temporal desde JSON a Supabase.
8. Probar con un comercio real:
   - registro
   - login
   - carga de comercio
   - producto
   - promocion
   - vista cliente
   - panel admin
9. Mantener localStorage como cache durante la prueba.
10. Desactivar localStorage como fuente principal cuando Supabase este validado.

## Regla de seguridad

No publicar nuevas versiones de produccion que borren o reemplacen datos locales sin antes exportarlos.

Antes de migrar datos reales:

1. Abrir la app actual publicada.
2. Exportar datos del navegador.
3. Guardar respaldo JSON.
4. Importar a Supabase.
5. Verificar registros en tablas.
6. Recien ahi publicar version conectada.

## Tablas principales Supabase

- `usuarios`
- `clientes`
- `categorias`
- `planes`
- `comercios`
- `comercio_configuraciones`
- `comercio_horarios`
- `productos`
- `promociones`
- `favoritos`
- `consultas`
- `opiniones`
- `estadisticas`
- `imagenes`
- `sugerencias`

## Buckets de Storage

- `business-logos`
- `business-covers`
- `product-images`
- `promotion-images`
- `user-avatars`

## Pendiente despues de recibir URL y ANON KEY

- Crear `supabase-client.js`.
- Actualizar `auth-service.js`.
- Actualizar lectura/escritura de Cliente.
- Actualizar Dashboard Comercio.
- Actualizar Dashboard Admin.
- Implementar subida de imagenes a Storage.
- Mantener fallback temporal de localStorage.
- Generar nuevo ZIP solo despues de prueba completa.
