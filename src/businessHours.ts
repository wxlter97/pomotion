// Horas hábiles configurables — usadas para sugerir la hora de inicio al
// agregar una sesión manual sin tarea planeada (ver defaultManualStart en
// TaskList.tsx). 100% cliente, se guarda en localStorage vía
// useBusinessHoursSetting.ts. Módulo puro (validación + consultas),
// testeado.
//
// Cada día de la semana tiene una lista de "bloques" (rangos horarios)
// habilitados — varios bloques por día permiten modelar una pausa (ej.
// almuerzo) como el hueco entre dos bloques, y un día con un solo bloque
// corto modela una jornada reducida (ej. viernes solo hasta el mediodía).

import { isValidTimeLabel } from './duration';

export type BusinessHoursBlock = { start: string; end: string };

export type BusinessHoursDay = {
  enabled: boolean;
  blocks: BusinessHoursBlock[];
};

/** Igual convención que `RecurringRule.weekdays`: '1' = Lunes … '7' = Domingo. */
export type Weekday = '1' | '2' | '3' | '4' | '5' | '6' | '7';

export const WEEKDAYS: Weekday[] = ['1', '2', '3', '4', '5', '6', '7'];

export type BusinessHoursSettings = {
  /** Si está apagado, nunca se sugiere una hora hábil (se usa el fallback anterior). */
  enabled: boolean;
  days: Record<Weekday, BusinessHoursDay>;
};

/** Cada día de la semana necesita su propio array de bloques — si
 *  compartieran uno solo, una mutación en cascada por cualquier lado
 *  (por más que las funciones de este módulo sean todas inmutables) podría
 *  terminar afectando a los cinco días laborales a la vez. */
function weekdayBlocks(): BusinessHoursBlock[] {
  return [
    { start: '09:00', end: '13:00' },
    { start: '14:00', end: '18:00' },
  ];
}

/** Lunes a viernes 09–13 / 14–18 (con la pausa del almuerzo entre bloques);
 *  fin de semana sin horario. Apagado por defecto — hay que activarlo a
 *  mano en Ajustes. */
export const DEFAULT_BUSINESS_HOURS: BusinessHoursSettings = {
  enabled: false,
  days: {
    '1': { enabled: true, blocks: weekdayBlocks() },
    '2': { enabled: true, blocks: weekdayBlocks() },
    '3': { enabled: true, blocks: weekdayBlocks() },
    '4': { enabled: true, blocks: weekdayBlocks() },
    '5': { enabled: true, blocks: weekdayBlocks() },
    '6': { enabled: false, blocks: [] },
    '7': { enabled: false, blocks: [] },
  },
};

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Un bloque es válido si sus dos horas lo son y `start` va antes que `end`
 *  (sin cruzar medianoche — una jornada laboral no lo necesita). */
export function isValidBlock(block: BusinessHoursBlock): boolean {
  return (
    isValidTimeLabel(block.start) &&
    isValidTimeLabel(block.end) &&
    timeToMinutes(block.start) < timeToMinutes(block.end)
  );
}

function cloneDefaultDay(key: Weekday): BusinessHoursDay {
  const base = DEFAULT_BUSINESS_HOURS.days[key];
  return { enabled: base.enabled, blocks: base.blocks.map((b) => ({ ...b })) };
}

/** Ordena los bloques de un día por hora de inicio — así "el primer bloque"
 *  siempre es realmente el más temprano, sin importar en qué orden se
 *  hayan agregado. */
export function sortBlocks(blocks: BusinessHoursBlock[]): BusinessHoursBlock[] {
  return [...blocks].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

/** Normaliza cualquier entrada (localStorage, JSON externo) a settings
 *  válidos — descarta bloques mal formados en vez de fallar entero. */
export function clampBusinessHours(raw: unknown): BusinessHoursSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<BusinessHoursSettings>;
  const days = (o.days && typeof o.days === 'object' ? o.days : {}) as Record<string, unknown>;

  const result = {} as Record<Weekday, BusinessHoursDay>;
  for (const key of WEEKDAYS) {
    const rawDay = days[key];
    if (!rawDay || typeof rawDay !== 'object') {
      result[key] = cloneDefaultDay(key);
      continue;
    }
    const d = rawDay as Partial<BusinessHoursDay>;
    const blocks = Array.isArray(d.blocks)
      ? sortBlocks(d.blocks.filter((b): b is BusinessHoursBlock => Boolean(b) && isValidBlock(b as BusinessHoursBlock)))
      : [];
    result[key] = { enabled: typeof d.enabled === 'boolean' ? d.enabled : blocks.length > 0, blocks };
  }

  return { enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_BUSINESS_HOURS.enabled, days: result };
}

/** Hora de inicio del primer bloque habilitado de esa fecha, o `null` si no
 *  hay ninguno (feature apagada, día apagado, o sin bloques). */
export function firstBlockStart(settings: BusinessHoursSettings, weekday: Weekday): string | null {
  if (!settings.enabled) return null;
  const day = settings.days[weekday];
  if (!day || !day.enabled || day.blocks.length === 0) return null;
  return sortBlocks(day.blocks)[0].start;
}

/** 'YYYY-MM-DD' → día de la semana en la misma convención que
 *  `RecurringRule.weekdays` ('1' Lunes … '7' Domingo). */
export function isoWeekdayOf(dateISO: string): Weekday {
  const d = new Date(`${dateISO}T00:00:00`);
  const jsDay = d.getDay(); // 0 Dom .. 6 Sáb
  const iso = jsDay === 0 ? 7 : jsDay;
  return String(iso) as Weekday;
}

// --- Mutaciones puras usadas por el diálogo de ajuste (BusinessHoursDialog) ---

export function setFeatureEnabled(settings: BusinessHoursSettings, enabled: boolean): BusinessHoursSettings {
  return { ...settings, enabled };
}

export function setDayEnabled(
  settings: BusinessHoursSettings,
  weekday: Weekday,
  enabled: boolean
): BusinessHoursSettings {
  return { ...settings, days: { ...settings.days, [weekday]: { ...settings.days[weekday], enabled } } };
}

export function addBlock(settings: BusinessHoursSettings, weekday: Weekday): BusinessHoursSettings {
  const day = settings.days[weekday];
  // Arranca donde termina el último bloque (si hay lugar antes de medianoche),
  // así agregar un bloque nuevo no pisa al anterior.
  const last = sortBlocks(day.blocks).at(-1);
  const start = last && timeToMinutes(last.end) < 23 * 60 ? last.end : '09:00';
  const startMin = Math.min(timeToMinutes(start) + 60, 23 * 60 + 59);
  const end = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;
  return {
    ...settings,
    days: { ...settings.days, [weekday]: { ...day, blocks: sortBlocks([...day.blocks, { start, end }]) } },
  };
}

export function removeBlock(settings: BusinessHoursSettings, weekday: Weekday, index: number): BusinessHoursSettings {
  const day = settings.days[weekday];
  return {
    ...settings,
    days: { ...settings.days, [weekday]: { ...day, blocks: day.blocks.filter((_, i) => i !== index) } },
  };
}

export function updateBlock(
  settings: BusinessHoursSettings,
  weekday: Weekday,
  index: number,
  patch: Partial<BusinessHoursBlock>
): BusinessHoursSettings {
  const day = settings.days[weekday];
  const blocks = day.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b));
  return { ...settings, days: { ...settings.days, [weekday]: { ...day, blocks } } };
}

/** Copia los bloques (y el estado on/off) del día `from` a todos los demás
 *  días laborales (Lun-Vie) — atajo para no repetir la misma jornada 5 veces. */
export function copyToWeekdays(settings: BusinessHoursSettings, from: Weekday): BusinessHoursSettings {
  const source = settings.days[from];
  const days = { ...settings.days };
  for (const key of ['1', '2', '3', '4', '5'] as Weekday[]) {
    if (key === from) continue;
    days[key] = { enabled: source.enabled, blocks: source.blocks.map((b) => ({ ...b })) };
  }
  return { ...settings, days };
}
