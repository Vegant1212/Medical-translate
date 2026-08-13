# MedLingua Translator

Aplicación web para traducción y revisión de contenido médico, procesamiento de documentos, subtítulos, generación de citas y auditoría bibliográfica.

## Requisitos

- [Bun](https://bun.sh/) 1.3 o posterior.
- Una cuenta de Vercel con AI Gateway habilitado para la traducción.

## Instalación

```bash
cd web
bun install --frozen-lockfile
bun run playwright:install
```

## Desarrollo

```bash
bunx vercel dev
```

Vercel sirve conjuntamente la aplicación y la función segura `/api/chat`. La terminal mostrará la URL local asignada.

## Validación

```bash
bun run build
bun run lint
bun run test:unit
bun run test:browser:run
```

Las pruebas de navegador requieren Chromium de Playwright y permiso para abrir un puerto local. El comando `bun run playwright:install` descarga únicamente Chromium; normalmente solo es necesario ejecutarlo después de la primera instalación o de actualizar Playwright.

## Configuración

1. Copia `web/.env.example` como `web/.env.local`.
2. Crea una clave en AI Gateway y guárdala como `AI_GATEWAY_API_KEY`.
3. Ejecuta `bunx vercel dev` desde `web`.

`AI_GATEWAY_API_KEY` se usa exclusivamente en la función de servidor. Nunca debe llevar los prefijos `VITE_` o `EXPO_PUBLIC_`.

El desarrollo local usa `alibaba/qwen3.7-flash`, disponible para cuentas Free Tier de AI Gateway y con un coste bajo descontado del crédito gratuito. Antes de emplearlo con contenido médico real debe evaluarse su calidad y revisarse cada resultado profesionalmente.

`VITE_API_BASE_URL` solo es necesario si frontend y API se ejecutan en orígenes distintos. `EXPO_PUBLIC_TOOLKIT_URL` se conserva temporalmente como compatibilidad con el runtime original de Rork.

Las variables con prefijo `EXPO_PUBLIC_` se incluyen en el código del navegador. No deben contener secretos ni claves privadas.

## Estructura

- `web/src/pages`: pantallas de la aplicación.
- `web/src/components`: interfaz y componentes reutilizables.
- `web/src/lib`: traducción, documentos, transcripción, citas y auditoría.
- `web/src/context`: preferencias locales del usuario.
- `web/src/test`: pruebas unitarias y de navegador.

## Consideraciones sobre datos médicos

La aplicación puede enviar texto, documentos y audio a servicios externos configurados a través de Rork Toolkit. No debe utilizarse con información clínica identificable hasta definir y verificar los controles de privacidad, consentimiento, retención y cumplimiento aplicables.
