# Configuración Supabase Auth para producción

Ir a Supabase:

Authentication → URL Configuration

## Site URL

```text
https://tubular-tartufo-9465bb.netlify.app
```

## Redirect URLs

Agregar estas URLs:

```text
https://tubular-tartufo-9465bb.netlify.app
https://tubular-tartufo-9465bb.netlify.app/
https://tubular-tartufo-9465bb.netlify.app/login.html
https://tubular-tartufo-9465bb.netlify.app/registro.html
https://tubular-tartufo-9465bb.netlify.app/recuperar-password.html
https://tubular-tartufo-9465bb.netlify.app/**
```

Guardar cambios.

Luego probar:

1. Crear una cuenta nueva.
2. Abrir el correo de confirmación.
3. Confirmar que el enlace abre:

```text
https://tubular-tartufo-9465bb.netlify.app
```

y no una URL local de desarrollo.
