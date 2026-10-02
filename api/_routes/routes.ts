import type { VercelRequest, VercelResponse } from '@vercel/node';
import googleCallbackHandler from './auth/google/callback.js';
import googleStartHandler from './auth/google/start.js';
import authLogoutHandler from './auth/logout.js';
import authStatusHandler from './auth/status.js';
import billingHandler from './billing.js';
import filesHandler from './files.js';
import habitsHandler from './habits.js';
import recurringHandler from './recurring.js';
import reportHandler from './report.js';
import sessionHandler from './session.js';
import taskHandler from './task.js';
import taskReorderHandler from './task-reorder.js';
import tasksHandler from './tasks.js';

export type RouteHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>;

/** Ruta (`/api/...`) → handler. Fuente única para Vercel y el servidor de desarrollo. */
export const routes: Record<string, RouteHandler> = {
  '/api/auth/google/start': googleStartHandler as RouteHandler,
  '/api/auth/google/callback': googleCallbackHandler as RouteHandler,
  '/api/auth/status': authStatusHandler as RouteHandler,
  '/api/auth/logout': authLogoutHandler as RouteHandler,
  '/api/billing': billingHandler as RouteHandler,
  '/api/tasks': tasksHandler as RouteHandler,
  '/api/session': sessionHandler as RouteHandler,
  '/api/task-reorder': taskReorderHandler as RouteHandler,
  '/api/task': taskHandler as RouteHandler,
  '/api/files': filesHandler as RouteHandler,
  '/api/habits': habitsHandler as RouteHandler,
  '/api/report': reportHandler as RouteHandler,
  '/api/recurring': recurringHandler as RouteHandler,
};
