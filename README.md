# pomotion

Planificador semanal de tareas con timer pomodoro y registro de tiempo. Cada
tarea vive en un día concreto; el timer, al detenerse, guarda la sesión.

- **Frontend:** React + Vite, diseño inspirado en Apple HIG (botones pill,
  segmented control, sheets, tema claro/oscuro).
- **Backend:** funciones serverless de Vercel (`/api`).
- **Almacén:** [Turso](https://turso.tech) (libSQL / SQLite). Ver
  `scripts/migrations/`.
- **Auth:** login con Google (OAuth2 + PKCE), sesión en cookie httpOnly +
  tabla `auth_sessions`. Multiusuario: cada cuenta arranca pendiente hasta
  que un admin la aprueba (`npm run approve -- <email>`); el `SEED_ADMIN_EMAIL`
  se aprueba solo en su primer login.

## Puesta en marcha

1. `npm install`
2. Copiar `.env.example` a `.env` y completar:
   - **Turso:** `turso db create pomotion`, luego `turso db show --url` y
     `turso db tokens create` → `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
     (Para dev sin cuenta: `TURSO_DATABASE_URL=file:local.db`.)
   - **Google OAuth:** en Google Cloud → Credentials → *OAuth client ID (Web)*.
     Redirect URIs: `${APP_BASE_URL}/api/auth/google/callback` y el de
     `http://localhost:5173/...` para dev.
   - `APP_BASE_URL`, `SEED_ADMIN_EMAIL`.
3. `npm run migrate` — crea el schema.
4. Dev: `npm run dev` (frontend, :5173) + `npm run dev:api` (API, :3000) en
   dos terminales. El proxy de Vite manda `/api` a :3000.

## Scripts

| | |
|---|---|
| `npm run dev` / `dev:api` | frontend / API en local |
| `npm run migrate` | aplica las migraciones SQL pendientes |
| `npm run approve -- <email>` | aprueba el login de un usuario |
| `npm run typecheck` / `test` / `build` | CI |

## Modelo de datos

- `tasks`: `id`, `user_id`, `name`, `date` (`YYYY-MM-DD`; `NULL` = backlog),
  `done`, `order` (fraccional), `file` (contexto: "Trabajo"/"Casa"/…), +
  campos para features futuras (`priority`, `estimate_min`, `notes`, `due`,
  `tags`).
- `work_sessions`: relación a `tasks`, `duration_sec`, `start_hhmm`,
  `end_hhmm`, `date` (denormalizado).
- `recurring_rules`: `name` + `weekdays` (CSV 1-7) → se materializan en la
  semana con "Aplicar" desde el diálogo de recurrentes.

Las "semanas" no son una entidad: se derivan de la fecha de cada tarea
(lunes de esa semana). La navegación `‹ ›` es aritmética de fechas.

## Funciones

- Vista por día dentro de la semana (Lun–Vie), con totales de día y semana.
- Timer pomodoro y libre; el activo se persiste en `localStorage` (sobrevive
  un refresh) y se descarta si es de otro día.
- Agregar / editar / marcar / borrar / reordenar tareas (↑↓ y drag).
- Mover una tarea a otro día de la semana o a la anterior/siguiente,
  arrastrando sus sesiones.
- Sesiones: registro automático al parar el timer, o manual; editar y
  borrar sesiones ya registradas; aviso (no bloqueante) de solapamiento.
- Reglas recurrentes por días de la semana.
- Reporte de tiempo por rango de fechas + export CSV.
- Selector de "archivos" (contextos) si tenés tareas con `file`.
- Notificación del navegador y sonido al cambiar de fase del pomodoro.
- Aviso de "timer olvidado" pasadas ~2h en modo libre.
- Atajos: `espacio` (start/stop), `1`–`5` (día), `[` `]` (semana), `T` (tema).

## Migración desde Notion

Versiones anteriores guardaban todo en una página de Notion. El estado
final de esa época está en la rama `archive/notion-storage` / tag
`notion-storage-final`. `ROADMAP.md` documenta la migración.
