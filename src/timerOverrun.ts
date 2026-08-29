// Aviso de "timer olvidado": un timer en modo libre que sigue corriendo
// mucho rato probablemente se quedó prendido de casualidad, y al detenerlo
// registraría una sesión de horas de basura. A partir de OVERRUN_HOURS se
// muestra un aviso no bloqueante con opción de detener, y se vuelve a
// mostrar en cada hora nueva mientras no se detenga (el usuario puede
// "ignorar" cada aparición). El pomodoro nunca llega acá: sus fases se
// cierran solas. La restauración desde localStorage tiene su propio corte,
// más generoso, en timerStorage.ts (MAX_AGE_MS).

export const OVERRUN_HOURS = 2;

/** Horas enteras transcurridas (piso). */
export function overrunElapsedHours(elapsedMs: number): number {
  return Math.floor(elapsedMs / 3_600_000);
}

/**
 * ¿Mostrar el aviso ahora?
 * - `running`: hay un timer en curso (fase distinta de 'idle').
 * - `posting`: se está guardando la sesión — no tiene sentido avisar.
 * - `ackHours`: la marca horaria de la última aparición que el usuario
 *   ignoró (0 si ninguna). Al detener/cambiar de tarea se vuelve a 0.
 */
export function shouldWarnOverrun(opts: {
  running: boolean;
  posting: boolean;
  elapsedMs: number;
  ackHours: number;
}): boolean {
  if (!opts.running || opts.posting) return false;
  const hours = overrunElapsedHours(opts.elapsedMs);
  return hours >= OVERRUN_HOURS && hours > opts.ackHours;
}
