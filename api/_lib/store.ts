// Contrato de la capa de almacenamiento, en términos de dominio (Task,
// Session, semana, archivo) — sin nada de Notion. Hoy la única
// implementación es notionStore.ts; una futura sobre base de datos real
// implementaría esta misma interfaz y los endpoints no se enterarían.
//
// Los tipos `*Input` llevan los campos crudos de la request (opcionales,
// sin validar): validarlos y lanzar el ApiError correspondiente
// (BadRequestError, etc.) es responsabilidad de cada implementación, que es
// la frontera real de validación.

import type { WeekSource } from './weekModel.js';

export type { WeekSource };

export type Session = {
  blockId: string | undefined;
  durationSeconds: number;
  start: string;
  end: string;
};

export type Task = {
  blockId: string;
  text: string;
  checked: boolean;
  day: string;
  sessions: Session[];
};

export type WeekView = {
  week: string | null;
  weekSource: WeekSource;
  isCurrentWeek: boolean;
  previousWeekLabel: string | null;
  nextWeekLabel: string | null;
  availableDays: string[];
  selectedDay: string | null;
  dayMatched: boolean;
  dayContainerId: string | null;
  dayHeadingBlockId: string | null;
  dayContainers: DayContainer[];
  tasks: Task[];
  weekTotalSeconds: number;
};

/** Dónde insertar/mover tareas de un día concreto (contenedor de Notion +
 *  heading del día como ancla). Se expone para todos los días de la semana,
 *  no solo el seleccionado, para poder mover una tarea a otro día. */
export type DayContainer = { day: string; containerId: string; headingBlockId: string };

export type FileEntry = { id: string; label: string };

/** Una sesión registrada, ya fechada (la fecha sale de su semana + día) y
 *  con el texto de su tarea — la unidad de fila del reporte de tiempo. */
export type SessionRow = {
  date: string;
  day: string;
  week: string;
  task: string;
  durationSeconds: number;
  start: string;
  end: string;
};

export type ReportInput = { from?: string; to?: string; fileId?: string };

export type WeekSuggestion = { start: string; end: string; label: string };
export type WeekRef = { label: string; start: string; end: string };
export type TaskRef = { blockId: string; text: string; checked: false };
export type TaskFieldsUpdate = { checked: boolean | undefined; text: string | undefined };
export type ReorderResult = { newBlockId: string; warning?: 'stale_original_not_deleted' };

export type GetWeekViewInput = { fileId?: string; week?: string; day?: string };
export type CreateWeekInput = { start?: string; end?: string; fileId?: string };
export type UpdateTaskInput = { blockId?: string; checked?: boolean; text?: string };
export type CreateTaskInput = { containerId?: string; afterBlockId?: string; text?: string };
export type ReorderTaskInput = { blockId?: string; containerId?: string; afterBlockId?: string };
export type LogSessionInput = {
  blockId?: string;
  durationSeconds?: number;
  // Timer en vivo: horas ISO completas, se formatean con la zona horaria configurada.
  startTime?: string;
  endTime?: string;
  // Registro manual: el usuario ya escribió la hora tal cual la quiere ver ("HH:MM").
  start?: string;
  end?: string;
};
export type UpdateSessionInput = {
  blockId?: string;
  durationSeconds?: number;
  start?: string;
  end?: string;
};

export interface Store {
  getWeekView(input: GetWeekViewInput): Promise<WeekView>;
  /** Todas las sesiones registradas cuya fecha cae en [from, to], ordenadas
   *  por fecha y hora de inicio. */
  getSessionsInRange(input: ReportInput): Promise<SessionRow[]>;
  suggestNextWeek(fileId?: string): Promise<WeekSuggestion>;
  createWeek(input: CreateWeekInput): Promise<WeekRef>;
  listFiles(): Promise<FileEntry[]>;
  updateTask(input: UpdateTaskInput): Promise<TaskFieldsUpdate>;
  createTask(input: CreateTaskInput): Promise<TaskRef>;
  deleteTask(blockId?: string): Promise<void>;
  reorderTask(input: ReorderTaskInput): Promise<ReorderResult>;
  logSession(input: LogSessionInput): Promise<Session>;
  updateSession(input: UpdateSessionInput): Promise<Session>;
  deleteSession(blockId?: string): Promise<void>;
}
