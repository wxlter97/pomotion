# pomotion

Timer (pomodoro y libre) que jala las tareas del día/semana actual desde una
plantilla de Notion, y al detener el timer escribe la sesión de vuelta a
Notion como bloque hijo del `to_do` correspondiente.

- **Frontend:** React + Vite, con un diseño inspirado en Apple HIG (botones
  pill, segmented control, sheets con blur, tema claro/oscuro).
- **Backend:** funciones serverless de Vercel (`/api`) que actúan de proxy
  hacia la API de Notion — el token nunca se expone al cliente.
- **Auth:** contraseña compartida simple (cookie de sesión firmada).
- **Costo:** $0, todo en tiers gratuitos de Vercel.

**Además del flujo base (ver spec del proyecto):**
- Marcar/desmarcar tareas como hechas directo desde la app (actualiza el
  `checked` del `to_do` en Notion, sin tocar el texto).
- Gestión completa de tareas del día: agregar, eliminar, y reordenar
  (botones ↑/↓ + drag nativo en desktop). Como Notion no tiene un
  endpoint para "mover" un bloque, reordenar internamente crea la tarea
  en la nueva posición (con sus sesiones) y borra la original — mientras
  haya un timer corriendo, la tarea activa queda con esos controles
  bloqueados para no arriesgar esa sesión en curso.
- Total de minutos registrados del día, visible arriba de la lista.
- Navegación entre semanas (‹ / › y un botón "Hoy" para volver a la actual),
  no solo la semana activa/detectada — útil para revisar historial.
- El timer activo se persiste en `localStorage` (sobrevive un refresh o
  cierre accidental de tab) con limpieza automática si es de un día
  calendario distinto o demasiado viejo.
- Confirmación antes de cancelar un timer activo al cambiar de tarea, día o
  semana.
- Botón para eliminar una sesión mal registrada (borra el bloque en Notion).
- Título de la pestaña con el countdown en vivo, anillo de progreso visual.
- Atajos de teclado: `espacio` inicia/detiene, `1`–`5` cambia de día,
  `[`/`]` cambia de semana, `T` cambia el tema.
- Favicon + manifest básico (ícono generado con
  [scripts/gen-icons.mjs](scripts/gen-icons.mjs), sin dependencias).

## 1. Crear la integración de Notion

1. Ve a [notion.so/my-integrations](https://www.notion.so/my-integrations) →
   **New integration**.
2. Dale un nombre (ej. `pomotion`), tipo **Internal**, workspace donde vive tu
   plantilla.
3. Copia el **Internal Integration Secret** → esto es `NOTION_TOKEN`.
4. Esta integración solo puede ver páginas que compartas explícitamente con
   ella (paso 3 abajo).

## 2. Crear la página índice

Esta es la página que **nunca se archiva** — le dice a la app cuál es la
página semanal activa ahora mismo.

1. Crea una página nueva en Notion, ej. `pomotion — índice`.
2. Dentro, escribe un solo bloque de texto con la **URL completa** (o el ID)
   de tu página semanal actual. Ejemplo:
   `https://www.notion.so/tuworkspace/2026-08-17-Semana-abcdef1234567890abcdef1234567890`
3. Comparte esta página con la integración: `···` (arriba a la derecha) →
   **Connections** → agrega la integración `pomotion`.
4. Copia el ID de **esta página índice** (los 32 caracteres al final de su
   propia URL) → esto es `NOTION_INDEX_PAGE_ID`.

Cuando reinicies tu plantilla semanal (archivas la vieja, creas la nueva),
solo editas el texto de este bloque con la URL de la página nueva —
compártela también con la integración (paso 3) — y no hay que tocar código
ni redeploy.

## 3. Compartir la página semanal activa

Comparte también la página semanal actual (la que referencia la página
índice) con la integración `pomotion`, igual que el paso 3 de arriba. Cada
vez que crees una página semanal nueva, compártela también.

Formato esperado dentro de esa página (ver spec del proyecto):

- `heading_1`: encabezado de semana, ej. `2026.08.17 - 2026.08.21`
- `heading_3`: encabezado de día, ej. `Lunes`, `Martes`
- `to_do`: cada tarea

Los días pueden estar como hermanos planos del `heading_1`, o metidos en un
layout de columnas de Notion (un `column_list` con un `column` por día,
cada uno con su `heading_3` + `to_do` adentro) — la app soporta ambos casos.

## 4. Variables de entorno

Copia `.env.example` a `.env` para desarrollo local, y configura las mismas
en Vercel (**Project Settings → Environment Variables**) para producción:

| Variable                | Descripción                                                        |
| ------------------------ | ------------------------------------------------------------------- |
| `NOTION_TOKEN`           | Token de la integración interna (paso 1).                          |
| `NOTION_INDEX_PAGE_ID`   | ID de la página índice permanente (paso 2).                        |
| `APP_PASSWORD`           | Contraseña compartida para entrar a la app.                        |
| `APP_TIMEZONE` (opcional)| Zona horaria para "hoy" y para formatear horas. Default: `America/El_Salvador`. |

## 5. Desarrollo local

```bash
npm install
npm run dev:api     # sirve /api en :3000 (lee .env con dotenv)
```

En otra terminal:

```bash
npm run dev          # sirve el frontend en :5173, con proxy de /api → :3000
```

`dev:api` levanta un servidor local mínimo ([scripts/dev-api-server.ts](scripts/dev-api-server.ts))
que monta los mismos archivos de `/api` sin pasar por el CLI de Vercel —
evita tener que loguearte a una cuenta de Vercel solo para desarrollar
localmente. En producción Vercel enruta cada archivo de `/api`
directamente; este script no se usa ahí.

Alternativa: si prefieres probar con el runtime real de Vercel,
`npm i -g vercel && vercel dev` funciona igual de bien (requiere login).

Abre `http://localhost:5173`.

## 6. Deploy en Vercel

1. `vercel link` (o importa el repo directo desde el dashboard de Vercel).
2. Configura las 3-4 variables de entorno de la tabla de arriba en el
   proyecto de Vercel.
3. `vercel --prod`, o simplemente haz push a `main` si conectaste el repo de
   GitHub.

## Fuera de alcance (por diseño)

- Multiusuario / OAuth de Notion (ver spec, sección 10).
- Extracción automática de tickets de Jira por regex — se asocian
  manualmente al iniciar el timer.
- Export o resumen adicional — las sesiones quedan como bloques hijo en la
  propia página de Notion.

## Decisiones de implementación no explícitas en la spec

- **Zona horaria:** por defecto `America/El_Salvador` (ajustable con
  `APP_TIMEZONE`), usada para detectar "hoy"/"qué día de la semana es" y
  para formatear las horas `(10:15–10:40)` de los bloques de sesión.
- **Cuándo se registra una sesión en modo Pomodoro:** además de al presionar
  "Detener" manualmente, también se registra automáticamente cuando el ciclo
  de trabajo de 25 minutos llega a 0 (transición natural a descanso). Los
  descansos nunca se registran como sesión.
- **Sesiones muy cortas:** si el timer corre menos de 30 segundos antes de
  detenerse, no se escribe nada a Notion (evita ruido por clics accidentales).
- **Semana/día no detectados automáticamente:** si la fecha de hoy no cae
  dentro de ningún rango de `heading_1`, o no hay un `heading_3` que
  coincida con el día actual, la app cae a un valor por defecto (última
  semana encontrada / primer día de la semana) y muestra un aviso visible en
  la UI en vez de fallar en silencio.
