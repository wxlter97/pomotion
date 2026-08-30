# pomotion — Roadmap: migración a Turso + login real

> Documento maestro. Reemplaza los planes previos de "Notion-DB" y de la rama
> `multiuser` (Notion OAuth). Estado al 2026-08-29.

---

## 1. Por qué

Hoy pomotion guarda todo como **bloques de una página de Notion** (heading por semana,
columnas por día, `to_do` por tarea, `paragraph` hijo por sesión). Consecuencias:

- Armar la vista semanal recorre el árbol nivel por nivel y hace **una llamada por
  tarea** para leer sus sesiones → ~45 llamadas en frío, ráfaga de ~35 en paralelo.
- La API de Notion limita a ~3 req/s y no hay reintento ante 429 → la request muere.
- El modelo está retorcido: "qué semana existe" es heurística, el orden es la posición
  del bloque, el reporte recorre todo el historial.
- Notion como almacén no tiene transacciones ni queries de agregación.

**Decisión:** mover el almacén a una base de datos propia (**Turso / libSQL = SQLite**),
con **login real por Google** (no la contraseña compartida actual), lista para que —
aunque hoy el único usuario sea Walter — otra persona pueda usarla con un click.

Esto además **desbloquea** vistas y funciones que hoy no son viables (mensual, heatmap,
carry-over, recurrentes automáticas, tags, analítica) — ver §9.

### Decisiones tomadas (con el usuario)

| Tema | Decisión |
|---|---|
| Almacén | **Turso** (libSQL/SQLite). Free tier alcanza para cientos de usuarios. |
| Auth | **Google sign-in únicamente**. Implementación propia y liviana (OAuth2 + PKCE), sesión en cookie httpOnly + tabla de sesiones en la DB. Sin proveedor externo. |
| Acceso | Cualquiera puede loguearse con Google → se crea su fila con `approved_login = 0`. Ve una pantalla "cuenta pendiente" hasta que un admin la aprueba. **El flag en la fila del usuario es la única fuente de verdad.** |
| Aislamiento | **Una sola DB compartida** con columna `user_id` en cada tabla; toda query scopeada por `user_id`. (DB-por-usuario queda como opción futura, no ahora.) |
| Notion | Se elimina por completo del runtime. Solo lo lee, una vez, el script de migración de datos. |
| Features en curso | **Mergear los PRs [#12](https://github.com/wxlter97/pomotion/pull/12) (mover tareas) y [#13](https://github.com/wxlter97/pomotion/pull/13) (recurrentes) a `main` primero**; la migración solo reimplementa el store por debajo. |
| Hosting | Sigue en **Vercel** (SPA + funciones serverless). Turso se accede por el driver libSQL HTTP. |

### Crecer en usuarios más adelante

Turso soporta multiusuario sin cambios de arquitectura (DB compartida con `user_id`, o
DB-por-usuario que es su patrón estrella). La interfaz `Store` deja el swap a Postgres
(Neon) como un archivo nuevo si algún día hiciera falta. Lo que **no** cubre este
roadmap y sería otra decisión: billing, límites de abuso, signup 100% abierto, soporte,
uptime SLA. Hoy: allowlist por flag, escala "vos + gente conocida".

---

## 2. Arquitectura destino

```
Browser (Vite SPA, React)
  │  cookie de sesión httpOnly
  ▼
Vercel Functions (/api/*)
  │  cada handler resuelve userId desde la cookie y lo mete en requestContext
  ▼
Store (interface)  ──  sqliteStore.ts  ──►  Turso (libSQL HTTP)
```

- **`Store`** ([api/_lib/store.ts](api/_lib/store.ts)) sigue siendo el contrato de
  dominio; hoy lo implementa `notionStore`, pasará a implementarlo `sqliteStore`. Los
  endpoints no cambian de forma (más allá de recibir `userId`).
- **`requestContext`** (AsyncLocalStorage): el `userId` autenticado viaja por ahí, no
  como parámetro en cada método. Patrón ya prototipado en la rama `multiuser`
  (`api/_lib/requestContext.ts`).
- **Helpers puros** (`weekModel` fechas, `computeOrder`, `sessionText`, `duration`,
  `recurring`) no dependen del almacén — se reusan tal cual.
- **Regla:** la interfaz `Store` y los helpers puros no mencionan Notion ni Turso.

---

## 3. Modelo de datos (schema SQL inicial)

Migraciones versionadas en `scripts/migrations/NNN_*.sql`, runner en `scripts/migrate.ts`
(patrón de la rama `multiuser`). Tabla `schema_migrations` para el control.

### Auth

```sql
CREATE TABLE users (
  id             TEXT PRIMARY KEY,          -- uuid
  email          TEXT UNIQUE NOT NULL,
  name           TEXT,
  picture_url    TEXT,
  google_sub     TEXT UNIQUE NOT NULL,      -- id estable de Google
  approved_login INTEGER NOT NULL DEFAULT 0,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,             -- ISO-8601
  last_seen_at   TEXT
);

CREATE TABLE auth_sessions (
  id         TEXT PRIMARY KEY,              -- token aleatorio; la cookie lleva el hash
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE oauth_state (                  -- transitorio: CSRF + PKCE durante el login
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_to   TEXT,
  created_at    TEXT NOT NULL
);
```

### Dominio

```sql
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  date              TEXT,                   -- 'YYYY-MM-DD'; NULL = backlog / inbox
  done              INTEGER NOT NULL DEFAULT 0,
  "order"           REAL NOT NULL DEFAULT 0, -- orden fraccional dentro del día
  file              TEXT,                   -- contexto: 'Trabajo' / 'Casa' / NULL
  -- campos "horneados" ahora para no re-migrar cuando llegue su UI:
  priority          TEXT,                   -- NULL / 'low' / 'med' / 'high'
  estimate_min      INTEGER,
  notes             TEXT,
  due               TEXT,                   -- 'YYYY-MM-DD', vencimiento ≠ agenda
  recurring_rule_id TEXT REFERENCES recurring_rules(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_tasks_user_date ON tasks(user_id, date);
CREATE INDEX idx_tasks_user_file_date ON tasks(user_id, file, date);

CREATE TABLE work_sessions (                -- las sesiones de tiempo (pomodoro / manual)
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  duration_sec INTEGER NOT NULL,
  start_hhmm   TEXT NOT NULL,               -- 'HH:MM'
  end_hhmm     TEXT NOT NULL,
  date         TEXT NOT NULL,               -- denormalizado de la tarea; se actualiza al mover
  file         TEXT,                        -- denormalizado
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_ws_user_date ON work_sessions(user_id, date);
CREATE INDEX idx_ws_user_task ON work_sessions(user_id, task_id);

CREATE TABLE tags (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  color   TEXT,
  UNIQUE(user_id, name)
);
CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE recurring_rules (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                 -- el texto de la tarea a crear
  file       TEXT,
  weekdays   TEXT NOT NULL DEFAULT '1,2,3,4,5',  -- CSV de 1(Lun)..7(Dom)
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
```

Notas:
- **`work_sessions`** para no chocar con `auth_sessions`. En el dominio TS sigue siendo
  `Session`.
- **`tasks.date` NULL = backlog** — habilita la vista "inbox" sin otra tabla.
- **Orden fraccional**: nueva tarea al final = `max(order)+1`; reordenar = punto medio
  entre vecinos. El cliente ya recibe `order` en cada tarea → reordenar/mover = 1 UPDATE.
- **`recurring_rules`** reemplaza la sección "Recurrentes" de Notion del PR #13. El
  "Aplicar a la semana" pasa a materializar reglas; más adelante puede correr solo
  (§9).

---

## 4. Fases

Cada fase = una rama `feat/NN-slug` desde `main` + un PR. Cierre de cada una:
`npm run typecheck && npm test && npm run build` en verde.

### Fase 0 — Mergear las features en curso a `main`  *(hecho: PRs abiertos)*
- [#12](https://github.com/wxlter97/pomotion/pull/12) `feature/move-task-between-days` → `main`.
- [#13](https://github.com/wxlter97/pomotion/pull/13) `feature/recurring-tasks` → tras #12.
- **Acción del usuario:** revisar y mergear (CI verde). Después `git pull`.

### Fase 1 — Capa Turso + runner de migraciones + limpieza del `Store`
- `npm i @libsql/client`.
- `api/_lib/db.ts`: cliente libSQL desde env (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`);
  helper `query` / `execute` / `transaction`. (Referencia: `api/_lib/db.ts` de la rama
  `multiuser`, que era Postgres — se readapta.)
- `scripts/migrate.ts` + `scripts/migrations/001_init.sql` con el schema de §3.
- **Limpieza de la interfaz** [api/_lib/store.ts](api/_lib/store.ts):
  - Quitar `createWeek`, `suggestNextWeek`.
  - `reorderTask` → `updateTaskPosition({ taskId, date?, order? })`; `ReorderResult`
    pierde `newBlockId`/`warning`.
  - `GetWeekViewInput` mantiene `week?/day?/fresh?`; `WeekView` cambia
    `dayContainerId`/`dayHeadingBlockId` → por día un `date` string.
- **Verificar temprano**: conexión a Turso desde una función de Vercel local
  (`dev-api-server.ts`), y una query trivial.

### Fase 2 — Auth por Google
- `api/auth/google/start.ts`: genera `state` + `code_verifier` (PKCE), guarda en
  `oauth_state`, redirige a Google.
- `api/auth/google/callback.ts`: valida `state`, intercambia `code` → tokens, lee
  `userinfo` (email, sub, name, picture), **upsert** en `users` (por `google_sub`).
  Aplica `approved_login`/`is_admin` según §5. Crea `auth_sessions`, setea cookie
  httpOnly `SameSite=Lax` `Secure`.
- `api/auth/status.ts`: devuelve `{ user, approved }` o 401.
- `api/auth/logout.ts`: borra la sesión + limpia la cookie.
- `api/_lib/auth.ts`: reescribir `requireAuth` → resuelve la cookie → `auth_sessions` →
  `users`; mete `userId` en `requestContext`. Devuelve 401 si no hay sesión, **403
  `pending_approval`** si `approved_login = 0`.
- Borrar `api/login.ts` / `api/logout.ts` viejos y `APP_PASSWORD`.
- **Referencia** de la rama `multiuser`: `api/auth/notion/*` (mismo baile OAuth),
  `api/_lib/crypto.ts`, `requestContext.ts`, `handler.ts`.

### Fase 3 — `sqliteStore.ts`
Implementa `Store` contra Turso, todo scopeado por `requestContext.userId`:
- `getWeekView`: rango Lun–Vie desde `week`/hoy →
  `SELECT * FROM tasks WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date, "order"` +
  `SELECT * FROM work_sessions WHERE user_id=? AND date BETWEEN ? AND ?`.
  Agrupa sesiones por `task_id`, arma los 5 días. `availableDays` fijo Lun–Vie. Por día
  devuelve su `date`.
- `getSessionsInRange` (reporte):
  `SELECT ws.*, t.name FROM work_sessions ws JOIN tasks t ON t.id = ws.task_id
   WHERE ws.user_id=? AND ws.date BETWEEN ? AND ? ORDER BY ws.date, ws.start_hhmm`.
  1 query. Total del rango = `SUM(duration_sec)`.
- `createTask({ date, order, text, file })`, `updateTask`, `deleteTask` (CASCADE borra
  sus `work_sessions`).
- `updateTaskPosition`: `UPDATE tasks SET "order"=?, date=? …`; si cambia `date`,
  `UPDATE work_sessions SET date=? WHERE task_id=?` (misma transacción).
- `logSession` / `updateSession` / `deleteSession`.
- Recurrentes: `listRecurringRules` / `upsertRecurringRule` / `deleteRecurringRule` /
  `applyRecurringToWeek(weekStart)` → por cada regla activa y cada weekday del rango,
  `INSERT` en `tasks` si no existe una con el mismo `name` normalizado ese día
  (reusa `missingRecurringTasks` de [api/_lib/recurring.ts](api/_lib/recurring.ts)).
- `listFiles`: `SELECT DISTINCT file FROM tasks WHERE user_id=? AND file IS NOT NULL`
  (o una tabla `files` chica si se quiere renombrar/ordenar — decidir al llegar).

### Fase 4 — Endpoints + frontend
- `api/tasks.ts`, `api/task.ts`, `api/task-reorder.ts`, `api/session.ts`,
  `api/report.ts`: pasan por el `Store` nuevo; body de crear/mover usa `date` + `order`.
- **Borrar** `api/week.ts`; `api/recurring.ts` pasa a operar sobre `recurring_rules`.
- [src/api.ts](src/api.ts): quitar `createWeek`/`getNextWeekSuggestion`; agregar
  `getAuthStatus`, `logout`, endpoints de reglas recurrentes.
- [src/App.tsx](src/App.tsx): sacar el flujo "Agregar semana" (`pendingNewWeek`,
  `confirmAddWeek`, `handleRequestAddWeek`); `handleReorderTask`/`handleMoveTask` por
  `date`+`order`.
- [src/components/DaySelector.tsx](src/components/DaySelector.tsx): sin botón "+";
  prev/next siempre disponibles (aritmética de fechas).
- [src/components/Login.tsx](src/components/Login.tsx): pantalla con botón único
  "Continuar con Google" (referencia: `Login.tsx` de la rama `multiuser`, two-step).
- Pantalla **"cuenta pendiente de aprobación"** cuando `status` devuelve 403.
- [src/components/MoveTaskMenu.tsx](src/components/MoveTaskMenu.tsx),
  [src/components/TaskList.tsx](src/components/TaskList.tsx): target de mover = una fecha.
- [src/taskReorder.ts](src/taskReorder.ts): `computeAfterBlockId` → `computeOrder(tasksOrdenadas, targetIndex)`.
- [api/_lib/weekModel.ts](api/_lib/weekModel.ts): queda `weekdayOffset`, `selectDay`,
  + `mondayOf` / `weekRange` / nav ±7 días. Se van `selectActiveWeek`, `computeWeekNav`,
  `findTodayWeekIndex`, `hasValidRange`, `computeNextWeekRange`. `parseWeekRange` /
  `formatWeekLabel` quedan (codec de la etiqueta de semana que el cliente sigue usando).

### Fase 5 — Migración de datos (one-off)
`scripts/migrate-notion-to-turso.ts` (`tsx`, con `--dry-run`):
1. Lee la(s) página(s) semanal(es) actual(es) con el código de bloques todavía presente
   (`resolveActivePageId`/`resolveFiles` + `groupBlocksByWeek`/`expandColumns`).
2. Por cada semana→día→tarea → `INSERT tasks` (`date` = lunes + offset, `name`, `done`,
   `order` = índice, `file` = label del archivo, `user_id` = tu id).
3. Por cada sesión → `INSERT work_sessions` (`task_id`, `duration_sec`, `start_hhmm`,
   `end_hhmm`, `date`, `file`).
4. Idempotente por "corré una vez sobre DB limpia"; imprime conteos.

### Fase 6 — Cutover + limpieza
- Env vars reales en Vercel (§7). Deploy.
- **Borrar**: `api/_lib/notionClient.ts`, `notionStore.ts`, `notionPage.ts`,
  `sessionText.ts`? (no — el formato de sesión se sigue usando para el título/CSV),
  `api/week.ts`, el bloque de bloques de `dev-api-server.ts`.
- `.env.example`: agregar `TURSO_*`, `GOOGLE_CLIENT_ID/SECRET`, `AUTH_SESSION_SECRET`,
  `SEED_ADMIN_EMAIL`, `APP_BASE_URL`; quitar todo `NOTION_*` y `APP_PASSWORD`.
- README: reescribir (era casi todo "estructura de la plantilla de Notion").
- Actualizar memoria.

---

## 5. Aprobación de usuarios

- **Bootstrap:** en el callback de Google, si `email == SEED_ADMIN_EMAIL` →
  `approved_login = 1, is_admin = 1`. (Vos.)
- **Nuevo usuario:** fila con `approved_login = 0`. `requireAuth` deja pasar el endpoint
  de status pero devuelve **403 `pending_approval`** en todo lo de dominio. El front
  muestra "tu cuenta está pendiente de aprobación".
- **Aprobar:** dos caminos, ambos triviales —
  1. `npm run approve -- <email>` (un `UPDATE`).
  2. ✅ PR #34 — si sos admin, en el menú **⋮ → "Aprobar usuarios"** ves el diálogo
     con pendientes / con acceso y botones Aprobar / Revocar
     (`GET|POST /api/auth/status`, gated a `is_admin`; no revoca tu propia cuenta).
- Invitar a alguien = decirle "entrá con Google" y aprobarlo. Sin claves compartidas.

---

## 6. Qué se reutiliza de la rama `multiuser`

Esa rama implementó OAuth (contra Notion) + DB (Postgres) sobre un `main` viejo. **No se
mergea** — se saca de referencia:

| De `multiuser` | Uso |
|---|---|
| `api/_lib/requestContext.ts` | tal cual (AsyncLocalStorage con `userId`) |
| `api/_lib/crypto.ts` | cifrado at-rest si hiciera falta (menos necesario con Google-only) |
| `api/_lib/db.ts`, `scripts/migrate.ts`, `scripts/migrations/` | patrón del runner; readaptar de Postgres a libSQL |
| `api/auth/notion/{start,callback}.ts` | forma del baile OAuth → adaptar a Google |
| `api/auth/status.ts`, `api/_lib/handler.ts` | casi tal cual |
| `src/components/Login.tsx`, `src/components/Settings.tsx` | base de UI |
| `public/privacy.html`, `public/terms.html` | drafts (Google pide privacy URL para el OAuth consent screen) |

---

## 7. Provisioning manual (te toca a vos)

1. **Turso**: crear DB (`turso db create pomotion`), sacar URL y token
   (`turso db show --url`, `turso db tokens create`).
2. **Google Cloud**: proyecto → *OAuth consent screen* (External, con la privacy URL) →
   *Credentials* → OAuth Client ID (Web) → redirect URI
   `https://<tu-dominio>/api/auth/google/callback` (+ `http://localhost:5173/...` para dev).
3. **Vercel env**: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `AUTH_SESSION_SECRET` (aleatorio), `SEED_ADMIN_EMAIL`
   (el tuyo), `APP_BASE_URL`.
4. Correr `npm run migrate` contra Turso (crea las tablas).
5. Correr `scripts/migrate-notion-to-turso.ts` una vez (Fase 5).
6. Quitar los env `NOTION_*` y `APP_PASSWORD` de Vercel.

---

## 8. Tests

| Área | Cómo |
|---|---|
| `weekModel` (reescrito) | tests directos de `mondayOf`/`weekRange`/nav/`selectDay` |
| `computeOrder` | nuevo, puro |
| `sqliteStore` | contra **SQLite in-memory** (`:memory:`), fixtures por test — el store real, sin mocks |
| Auth: PKCE, state, expiración de sesión | unit sobre los helpers; `fetch` de Google mockeado |
| `recurring` / `sessionText` / `duration` | sobreviven |
| E2E | `npm run dev` + `dev:api` + preview del navegador (§ verificación abajo) |

---

## 9. Backlog de features (post-migración)

Cada una su propia rama/PR. Ordenadas por valor/costo. Nada bloquea a la migración.

### Tier 1 — alto valor, bajo costo ✅ COMPLETO

- ~~**Vista mensual**~~ ✅ PR #23 — grilla del mes, tareas + horas por día, salto a la semana.
- ~~**Heatmap de foco**~~ ✅ PR #24 — grilla estilo GitHub, intensidad = horas registradas.
- ~~**Carry-over**~~ ✅ PR #22 — botón "traer a hoy" + modo automático al abrir la app.
- ~~**Recurrentes automáticas**~~ ✅ PR #25 — `recurring_rules` se materializan al abrir la
  semana (tabla `recurring_runs` marca cada semana/contexto, una sola vez). El "Aplicar"
  manual queda como override para reglas agregadas a mitad de semana.

### Tier 2 — requiere UI nueva, schema ya listo — ✅ COMPLETO
- ~~**Tags/proyectos**~~ ✅ PR #30 — diálogo de gestión (alta/rename/color/borrar) en el
  menú "Ver"; toggles en el panel de detalle de la tarea; chips de color en la fila;
  barra de filtro por etiqueta arriba de la lista; desglose "Por etiqueta" en el reporte.
  `Task.tagIds` + `WeekView.tags` nuevos; CRUD plegado en `POST /api/tasks` (sin función
  nueva). Paleta de 9 colores en `src/tags.ts`.
- ~~**Estimación vs real**~~ ✅ PR #28 — campo "Estimado" en el panel de detalle
  (acepta "90" o "1h 30m"). En la fila: `registrado / estimado` (o `est. 2h` sin
  registro), rojo si se pasó. Pill del día gana segmento "Est". Reporte: total
  "Estimado" + columna `estimado_min` en el CSV. `Task.estimateMinutes` nuevo.
- ~~**Backlog/inbox**~~ ✅ PR #29 — cajón plegable "Sin fecha" arriba de la agenda:
  anotar pendientes sin fecha, "Programar" a un día desde su menú, y "Sacar de la
  agenda" (→ inbox) en el menú de una tarea del día (solo si no tiene tiempo
  registrado). `Task.date` pasa a nullable; `WeekView.inbox` nuevo. Sin arrastre
  todavía (menú "Programar").
- ~~**Prioridad / notas / due date**~~ ✅ PR #26 — panel de detalle al editar la tarea
  (pills de prioridad, fecha de vencimiento, notas). Franja de color por prioridad y chip
  de "vence" (relativo, rojo si venció) en la fila. `WeekView.today` nuevo.
- ~~**Limpieza de UX / barra superior**~~ ✅ PR #26 — la barra pasó de 9 íconos sueltos a
  `pomotion` + tema + menú "Ver" (Mes/Heatmap/Reporte/Recurrentes) + menú "⋮"
  (Sonidos/Notificaciones/Carry-over/Actualizar/Salir). Las 5 acciones de cada fila de
  tarea se colapsaron en un menú "⋮" (`TaskRowMenu`). Las 2 pills de total (Día/Semana)
  se fusionaron en una. Componente `Menu` reutilizable.

### Tier 3 — más grande
- ~~**Analítica**~~ ✅ PR #31 — panel (menú "Ver" → Analítica): tiempo por día de
  semana, por hora del día, tendencia semanal, tasa de completado, racha actual/mejor.
  Ventana 4/12/26 sem. `GET /api/tasks?analytics=1` (2 queries + `computeAnalytics`
  puro). Sin función serverless nueva.
- **Time-blocking**: asignar la tarea a un bloque horario, ver el día como timeline.
  (Descartado por ahora — el más invasivo, necesita UI de calendario nueva.)
- ~~**Suscripción a calendarios (iCal)**~~ ✅ PR #35 — diálogo "Calendarios" (menú "Ver"):
  se registra una URL `.ics` (Google/Outlook/…), el server la baja y materializa los
  eventos con hora como tareas del día, manteniéndolas al día en cada sync. Recurrentes
  (RRULE/EXDATE/overrides) expandidos vía `ical.js`. Ventana hoy−7…+28 días, debounce
  10 min, trigger en segundo plano al abrir la app + botón "Sincronizar". Sync
  unidireccional. Migración `005_calendar_feeds.sql` (`calendar_feeds` + `tasks.source`
  / `feed_id` / `external_uid` / `external_date`). `GET /api/tasks?feeds=1` + acciones
  `*_feed` / `sync_feeds` en `POST /api/tasks` (sin función serverless nueva).
  Los eventos de día completo y los que rechazaste quedan afuera.
- ~~**Templates de día**~~ ✅ PR #32 — diálogo "Plantillas de día" (menú "Ver"): guardar
  un set de tareas (a mano, o copiando el día visible con su prioridad/estimación) y
  "Aplicar" al día visible (dedup por nombre). Migración `003_day_templates.sql`
  (`day_templates` + `day_template_items`). CRUD plegado en `POST /api/tasks`.
- ~~**Metas**~~ ✅ PR #33 — diálogo "Metas del mes" (menú "Ver"): "X horas en [etiqueta]
  al mes", barra de progreso con marca del ritmo esperado a la fecha, estado
  atrás/en ritmo/adelantada/cumplida. Migración `004_goals.sql`. `GET /api/tasks?goals=1`
  + CRUD en `POST /api/tasks`. `src/goals.ts` puro para el burn-down.

### Fuera de alcance por ahora
- Signup 100% abierto, billing, límites de abuso.
- App móvil nativa / offline-first.
- Sync de vuelta a Notion (posible como cron read-only si se extraña).
- DB-por-usuario / mudanza a Postgres (contenida por `Store` si algún día).

---

## 10. Verificación end-to-end (post-migración)

1. `npm run migrate` contra una DB de prueba → tablas creadas.
2. Login con Google (dev): primer login con `SEED_ADMIN_EMAIL` → entra directo y admin.
   Segundo email → pantalla "pendiente"; aprobarlo desde Settings → entra.
3. `scripts/migrate-notion-to-turso.ts --dry-run` → revisar conteos; correrlo →
   revisar la semana actual en la app: tareas, `done`, sesiones y totales correctos.
4. Contar llamadas en `preview_logs`: **~2 queries por vista** (antes ~45).
5. Navegar Lun↔Vie y entre semanas (‹ ›) → sin botón "+", instantáneo, sin 429 nunca.
6. Crear / editar / marcar / borrar tarea; reordenar y mover a otro día arrastrando;
   mover a la semana siguiente desde el menú → 1 UPDATE, las sesiones siguen pegadas,
   su `date` se actualiza al mover.
7. Timer: registrar sesión; sesión manual; editar/borrar sesión.
8. Reporte de un mes → 1 query con JOIN; CSV correcto.
9. Recurrentes: crear regla, aplicar a la semana, dedup en segundo "Aplicar".
10. Logout → vuelve al login. Borrar la propia cuenta (si se agrega) → CASCADE limpia todo.

---

## 11. Backlog 2 — nuevas features (post §9)

El §9 quedó cerrado salvo time-blocking. Esta es la segunda tanda. **Una rama/PR por
ítem, ramificando desde `main`, el usuario mergea entre ítems.** Ordenadas por
valor/costo dentro de cada tier; nada bloquea a nada.

### Reglas de implementación (heredadas del §9)

- **Nunca agregar una función serverless.** Hay 11/12 (límite Hobby de Vercel). Todo se
  pliega en los endpoints que ya están: `GET /api/tasks?X=1`, `POST /api/tasks {action}`,
  `/api/task`, `/api/session`, `/api/report`, `/api/recurring`, `/api/files`,
  `/api/auth/*`.
- **Migraciones**: `scripts/migrations/NNN_*.sql` (última: `005`), tracked en
  `schema_migrations`. No hay auto-run en deploy — el usuario corre `npm run migrate`
  contra prod después de mergear. Actualizar `scripts/migrate.test.ts` (lista
  `SCHEMA_TABLES` + `expect(applied).toContain('NNN_…')`).
- **Ajustes solo-cliente** van en un hook de `localStorage` (patrón `useSoundSetting` /
  `useNotificationSetting` / `useCarryOverSetting` / `useTheme`), sin tocar el backend.
- **Store**: interfaz en `api/_lib/taskStore.ts`, impl en `api/_lib/sqliteStore.ts`
  (toda query scopeada por `currentUserId()`). Lógica pura → su propio módulo con tests.
- **Verificación** por PR: `npm run typecheck` + `npm test` + `npm run build` en verde,
  y para UI nueva el harness estático de CSS (`public/_NAME.html` que linkea
  `/src/styles.css`, screenshot claro/oscuro/mobile, después se borra). No hay E2E real
  (prod exige login de Google).
- UI en español. Zona `America/El_Salvador`.
- Estado actual de `tasks`: `id, user_id, name, date (nullable), done, "order", file,
  priority, estimate_min, notes, due, recurring_rule_id, source, feed_id, external_uid,
  external_date, created_at, updated_at, planned_start, planned_minutes`.

### Tier 1 — alto valor, bajo costo

| Feature | Qué | Notas de costo |
|---|---|---|
| ~~**Búsqueda de tareas**~~ ✅ | Caja de búsqueda (atajo `/` o menú "Ver" → "Buscar tareas") que encuentra tareas por texto en todas las semanas + inbox; muestra día/fecha y contexto, ↑↓/Enter o clic para saltar a esa semana/día. | `GET /api/tasks?search=<q>` plegado (1 query `LIKE` escapada, scopeada por user+file, tope 50). Sin migración. `searchTasks` en el store, `SearchDialog` en el front. |
| ~~**Backup completo (export / import JSON)**~~ ✅ | `GET /api/tasks?export=1[&download=1]` devuelve todo el dataset del usuario (todas las tablas de dominio, sin `user_id`); `POST {action:'import', backup}` lo restaura. Diálogo "Copia de seguridad" (menú "⋮"). | Sin migración, sin función nueva. **Import v1: solo en cuenta vacía** (409 si no) — regenera todos los ids y reescribe las referencias, así puede convivir con la cuenta de origen. Manifiesto de tablas + validación en `api/_lib/backup.ts` (puro). Descarga vía navegación normal (Content-Disposition, como el CSV). |
| ~~**Pomodoro configurable**~~ ✅ | Duración de foco / descanso corto / largo, "descanso largo cada N pomos" (0 = nunca), auto-arrancar el siguiente pomodoro tras el descanso. Diálogo "Pomodoro" (menú "⋮"). | 100% cliente: `src/timerSettings.ts` (puro: clamp + `isLongBreakDue`) + `useTimerSettings` (localStorage). `Timer` recibe `settings`, lleva el contador de ciclo (`completedPomodoros`/`breakIsLong`, persistidos con el timer activo). Duraciones bloqueadas mientras corre. |
| ~~**Objetivo de pomodoros del día**~~ ❌ descartado | — | Al usuario no le gustó la idea (2026-08-29). |
| ~~**Notificaciones de vencimiento**~~ ✅ | Banner en la app + notificación del navegador (solo con la pestaña en 2º plano) por las tareas sin hacer del contexto que vencen hoy o ya vencieron. Dedup 1×/tarea/día. | `WeekView.dueReminders` nuevo (1 query en `getWeekView`, scopeada por file). `src/dueReminders.ts` puro + `useDueNotifications` (localStorage, re-chequea en `visibilitychange` + cada 30 min). `notify()` genérico en `notify.ts`. Sin migración. |
| ~~**Modo foco**~~ ✅ | Vista minimal: solo el timer + el nombre de la tarea, el resto oculto. Se entra por menú "⋮" → "Modo foco" o la tecla `F`; se sale con `F` / `Esc` / botón "Salir de foco". | Puro frontend, estado efímero (`useState`, no persiste). Clase `.app--focus` que oculta header/día/inbox/lista/footers por CSS + reposiciona el timer al centro. |
| ~~**Edad de la tarea**~~ ✅ | Chip tenue "9d" / "3sem" en tareas sin hacer que llevan ≥7 días abiertas (no en días futuros). | `Task.createdAt` nuevo (API + `src/types.ts` + `toTask`). `taskAgeLabel`/`taskAgeTitle` puros en `taskMeta.ts`. Chip en la fila de `TaskList`. Sin migración (`created_at` ya estaba). |

### Tier 2 — UI nueva o migración chica — ✅ COMPLETO

| Feature | Qué | Notas de costo |
|---|---|---|
| ~~**Drag-and-drop**~~ ✅ | Arrastrar una fila para reordenarla dentro del día, soltarla en la pestaña de otro día de la semana visible, o en el cajón "Sin fecha" (y al revés: una nota del inbox a una pestaña de día). Fantasma que sigue al puntero, resaltado de la zona de destino (rojo si no la acepta, p. ej. tarea con tiempo → inbox), autoscroll cerca de los bordes, `Esc` cancela. Anda con mouse **y** con el dedo (mantener presionado ~240 ms). Menú ⋮: se fueron "Subir/Bajar" y "Mover a otro día" (misma semana); queda "Mover a otra semana…" (lo que el arrastre no puede). | Sin migración, sin función nueva — reusa `moveTask`/`updateTaskPosition` y los handlers `handleReorderTask`/`handleMoveTask`/`handleScheduleTask`. Controlador a mano en `src/drag/` (pointer events, cero dependencias): `dnd.ts` puro (`parseZoneTag`, `computeReorderTarget`, `baseCanDrop`) + `DragProvider.tsx` (gesto, ghost por portal, autoscroll por rAF, hit-test con `elementFromPoint` sobre `[data-drag-zone]`). Umbral 5 px con mouse / hold 240 ms con touch, así el tap y el scroll normal siguen andando. |
| ~~**Acciones en lote**~~ ✅ | Se entra por ⋮ → "Seleccionar varias"; casilla por fila; barra arriba de la lista → completar / mover a otro día / etiquetar / sacar de la agenda / borrar, todas juntas. `Esc` o ✕ cancela. | `POST /api/tasks {action:'bulk', op, ids, date?, tag_id?}` → `bulkTasks` en el store (scopeado; 'move'/'inbox' reusan `updateTaskPosition`; 'inbox' saltea las que tienen tiempo). `BulkActionBar` nuevo; selección efímera en `App`. Sin migración, sin función nueva. |
| ~~**Subtareas / checklist**~~ ✅ | Una tarea con pasos marcables (sin tiempo propio). La fila muestra el chip "☑ 2/5" (verde si están todos). Editor en el panel expandible: marcar / agregar / quitar pasos. | Migración `006`: columna `checklist` TEXT (JSON `[{id,text,done}]`) en `tasks`. `api/_lib/checklist.ts` puro (parseo tolerante + validación, tope 50 ítems / 200 car.). `updateTask` acepta `checklist`; se pliega en `PATCH /api/task`. Sin función nueva. |
| ~~**Revisión semanal**~~ ✅ | Panel guiado (menú "Ver" → "Revisión semanal") en 3 pasos: **1 Resumen** (tareas hechas/totales, horas registradas + delta vs. semana anterior, barras por contexto y por etiqueta — todo cross-contexto) · **2 Pendientes** (cada tarea sin terminar de la semana: ✓ hecha / → próxima semana / al backlog) · **3 Foco** (nota corta de intención para la semana siguiente; muestra el foco que se fijó para la semana revisada). Navegación ‹ semana ›. | Migración `009_week_focus.sql` (tabla `week_focus (user_id, week_start, body, updated_at)`, PK `(user_id, week_start)`). `api/_lib/weeklyReview.ts` puro (`buildReviewSummary`: agrega por contexto/tag, arma las pendientes). `getWeeklyReview` (~4 queries) + `saveWeekFocus` (upsert; vacío borra) en el store; `GET /api/tasks?review=<semana>` + `POST {action:'save_week_focus'}` — sin función serverless nueva. Las acciones de pendientes reusan `moveTask`/`updateTaskDone`/`moveTaskToInbox`. En el backup. |
| ~~**Recurrencia mensual / por fecha**~~ ✅ | Cada regla recurrente elige **Semanal** (días de la semana, como antes) o **Mensual** (días del mes 1..31, más `-1` = "último día" — se ajusta a 28/29/30/31). Toggle + grilla de días en `RecurringTasksDialog`. | Migración `008`: `freq` + `monthdays` en `recurring_rules` (las reglas viejas quedan `weekly` por el DEFAULT). `api/_lib/recurrence.ts` puro (`ruleFiresOn`, parseo/validación de `monthdays`, `isLastDayOfMonth`). `applyRulesToWeek` usa `ruleFiresOn` por día. Sin función nueva. **Pendiente**: "cada N semanas" (necesita ancla) y "último día hábil". |
| ~~**Fin de semana opcional**~~ ✅ | Toggle "Mostrar fin de semana" (menú ⋮). Con él, la vista pasa a Lun–Dom: 7 pestañas de día, Sáb/Dom seleccionables, y el carry-over trae a hoy (no al lunes) si hoy cae en finde. La etiqueta de semana sigue siendo Lun–Vie (identificador estable). Las reglas recurrentes con S/D marcados ahora sí se materializan. | Sin migración. `weekDates.ts`: `WEEKEND_NAMES`/`ALL_DAY_NAMES`/`visibleDayNames`, `weekDates(monday, includeWeekend)`, `weekdayIndex`/`selectDay`/`toWeekday` con flag, `isWeekend`. `getWeekView` toma `includeWeekend` (`?weekend=1`); `applyRulesToWeek` materializa L–D. `useWeekendSetting` (localStorage) en el front. Sin función nueva. |
| ~~**Notas del día / bitácora**~~ ✅ | Texto libre por día, aparte de las tareas. Cajón plegable "Nota del día" bajo el inbox (punto de acento si tiene contenido); guarda al perder el foco o con ⌘/Ctrl+Enter. No se scopea por contexto — es la bitácora del día entero. | Migración `007`: tabla `day_notes (user_id, date, body, updated_at)`, PK `(user_id, date)`. `WeekView.dayNote` = la nota de `selectedDate`. `saveDayNote` (upsert; texto vacío borra la fila) → `POST /api/tasks {action:'save_day_note', date, body_text}`. Sin función nueva. En el backup. |
| ~~**Precisión de estimación**~~ ✅ | Sección "Precisión de estimación" en Analítica: "en promedio tardás un X% más/menos de lo que estimás", factor sugerido + barras estimado vs. registrado. Cuenta solo tareas completadas con estimación y tiempo (mín. 3). | `computeEstimateAccuracy` puro en `analytics.ts`; `getAnalytics` cruza `estimate_min` con el tiempo por tarea (agrega `task_id` a la query de sesiones). `Analytics.estimateAccuracy` nuevo. Sin migración, sin función nueva. |

### Tier 3 — grande

- ~~**Time-blocking**~~ ✅ (arrastrado del §9), en dos tandas:
  - **v1 "blando"**: hora planeada por tarea — campo "Hora planeada" en el panel de
    detalle (`<input type="time">`), chip 🕐 HH:MM en la fila, y el día se ordena por
    esa hora (las tareas sin horario quedan después, en su orden manual de siempre).
    Migración `010_time_blocking.sql` (`tasks.planned_start` TEXT nullable).
    `getWeekView` ordena `ORDER BY date, (planned_start IS NULL), planned_start,
    "order", created_at`. `normalizeTimeLabel` nuevo en `shared/duration.ts`
    (zero-pad para que el `ORDER BY` como texto ordene bien).
  - **v2, vista de agenda/timeline**: diálogo "Agenda del día" (menú "Ver"): franja
    vertical de 24h con los bloques planeados a la izquierda (arrastrar para mover,
    borde inferior para redimensionar — cambia la duración) y las sesiones reales
    superpuestas a la derecha; cola "Sin horario" arriba para arrastrar una tarea al
    timeline y agendarla; línea de "ahora" si el día es hoy; click en un bloque abre
    el panel de detalle (`TaskDetails`) inline. Migración `011_time_blocking_duration.sql`
    (`tasks.planned_minutes` INTEGER nullable — NULL usa la estimación o el default de
    30 min). `src/timeline.ts` puro (conversión hora↔minuto, snap de 5 min, rango de un
    bloque/sesión recortado a medianoche, `layoutColumns` para repartir en columnas los
    bloques que se solapan). `src/components/DayTimeline.tsx`: controlador de pointer
    events hecho a mano (mismo enfoque que `src/drag/DragProvider.tsx` pero con tres
    gestos — mover/redimensionar/agendar — en vez de uno), sin dependencias nuevas,
    mouse + touch. Ambas tandas en el backup; sin función serverless nueva (todo
    plegado en `PATCH /api/task` vía `plannedStart`/`plannedMinutes`).
- ~~**PWA instalable + offline de lectura**~~ ✅ — service worker hecho a mano (`public/sw.js`,
  cero deps): navegación red-primero → cae al `index.html` cacheado; `/assets/*` (con hash)
  cache-primero; `GET /api/tasks` + `/api/auth/status` red-primero → caen a lo último
  guardado (el auth cacheado deja entrar offline, al reconectar revalida). No encola
  mutaciones — offline es solo lectura. `src/pwa.ts` registra el SW (no en dev) y avisa
  "hay versión nueva" (banner con botón que manda `SKIP_WAITING` + recarga). `useOnlineStatus`
  + banner "sin conexión". `site.webmanifest` ya estaba (solo se puso al día). `vercel.json`:
  `Cache-Control: no-cache` para `/sw.js`. Sin migración, sin función serverless. **Encolar
  mutaciones offline queda para un v2.**
- **Exportar sesiones como `.ics`**: lo inverso a la suscripción — publicar las sesiones
  registradas como feed iCal (URL con token secreto) para verlas en el calendario propio.
  Choca con el presupuesto de funciones (endpoint público sin `withAuth`) — habría que
  plegarlo en un endpoint existente salteando el wrapper para ese path + validar el token.
- **(Opcional) Asistente con Claude API**: "estimá esta tarea", "resumí mi semana",
  "sugerí el foco de mañana". Suma dependencia (`@anthropic-ai/sdk`), costo por request,
  y una función (o fold en `/api/tasks` con `action:'assist'`). Solo si hay ganas.

### Tier 4 — ideas nuevas (post time-blocking, 2026-08-30)

- ~~**Recurrentes con hora por defecto**~~ ✅ — una regla recurrente puede llevar un
  `default_planned_start` opcional (`<input type="time">` en "Tareas recurrentes",
  con "Quitar"); las tareas que genera nacen con esa hora ya puesta (`planned_start`),
  sin tener que arrastrarlas al timeline cada semana. Migración
  `012_recurring_default_time.sql`. `applyRulesToWeek` propaga `rule.defaultPlannedStart`
  al insertar. Reusa `normalizeTimeLabel` para validar/zero-pad. En el backup. Sin
  función serverless nueva (plegado en `POST /api/recurring {action:'create'|'update'}`).
- **Aviso al arrancar un bloque planeado**: mismo mecanismo que `dueReminders`
  (banner + notificación del navegador), pero disparando en `planned_start` en vez
  de en `due`. Bajo costo — reusa `notify()` y el patrón de `useDueNotifications`.
- ~~**Plantillas de día con horario**~~ ✅ — "Plantillas de día" conserva también la
  hora planeada de cada ítem (no solo prioridad/estimación): al crear una plantilla
  como snapshot del día visible ("Copiar…") se captura `planned_start`, y al
  "Aplicar" la tarea nueva nace ya agendada en el timeline. Migración
  `013_day_template_time.sql` (`day_template_items.planned_start`). Sin UI nueva —
  la creación manual de ítems (textarea de nombres) sigue sin prioridad/estimación/
  hora, igual que antes; el tooltip de la plantilla ahora muestra la hora si hay.
  Sin función serverless nueva, en el backup.
- **Deshacer la última acción**: snackbar "Deshacer" (5-10s) para borrar tarea /
  marcar hecho / mover, para el error más común sin la fricción de confirmar todo.
- **Atajos de teclado en el timeline**: alternativa al arrastre — flechas para
  mover el bloque seleccionado (paso de 15 min), Shift+flecha para redimensionar.
  Accesibilidad para cuando no da el mouse/dedo.

### Fuera de alcance (sigue igual que §9)

- Colaboración / contextos compartidos (es personal aunque el backend sea multiusuario).
- App móvil nativa.
- Signup 100% abierto, billing, límites de abuso.
- Dependencias entre tareas ("bloqueada por") — overkill para uso diario personal.
- Sync de vuelta a Notion.
