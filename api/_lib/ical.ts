/**
 * Parseo de calendarios iCalendar (.ics) para la suscripción a calendarios.
 * Envuelve `ical.js`: registra las VTIMEZONE embebidas, expande los eventos
 * recurrentes (RRULE / EXDATE / overrides con RECURRENCE-ID) dentro de una
 * ventana, y devuelve ocurrencias planas listas para materializar como tareas.
 *
 * Alcance de v2: solo eventos con hora (los de día completo se saltean),
 * se descartan los cancelados y los que el usuario rechazó (PARTSTAT=DECLINED).
 */
import ICAL from 'ical.js';

export type IcalEvent = {
  /**
   * Identidad estable de la ocurrencia entre syncs: el UID del VEVENT, o
   * `UID::<recurrence-id>` para cada instancia de un evento recurrente.
   */
  uid: string;
  summary: string;
  /** Instante de inicio / fin (UTC). */
  start: Date;
  end: Date;
  location: string | null;
};

export type ParseIcalOptions = {
  windowStart: Date;
  windowEnd: Date;
  /** Si el usuario aparece como asistente con PARTSTAT=DECLINED, se saltea el evento. */
  viewerEmail?: string | null;
};

// Topes defensivos: un RRULE sin fin arranca desde su DTSTART, que puede ser
// años atrás; y un feed hostil podría traer miles de eventos.
const MAX_ITER_PER_EVENT = 10_000;
const MAX_EVENTS = 500;

type Comp = InstanceType<typeof ICAL.Component>;

function registerTimezones(root: Comp): void {
  for (const vt of root.getAllSubcomponents('vtimezone')) {
    try {
      const tzid = vt.getFirstPropertyValue('tzid');
      if (typeof tzid === 'string' && tzid && !ICAL.TimezoneService.has(tzid)) {
        ICAL.TimezoneService.register(vt);
      }
    } catch {
      // Zona inválida: la ignoramos. Los tiempos en UTC igual resuelven bien.
    }
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isCancelled(comp: Comp): boolean {
  return str(comp.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED';
}

function declinedByViewer(comp: Comp, viewerEmail: string): boolean {
  const target = viewerEmail.trim().toLowerCase();
  if (!target) return false;
  for (const att of comp.getAllProperties('attendee')) {
    const who = String(att.getFirstValue() ?? '')
      .replace(/^mailto:/i, '')
      .toLowerCase();
    if (who !== target) continue;
    const partstat = att.getParameter('partstat');
    if (String(Array.isArray(partstat) ? partstat[0] : partstat ?? '').toUpperCase() === 'DECLINED') {
      return true;
    }
  }
  return false;
}

function summaryOf(comp: Comp): string {
  return str(comp.getFirstPropertyValue('summary')) || '(sin título)';
}

function locationOf(comp: Comp): string | null {
  const loc = str(comp.getFirstPropertyValue('location'));
  return loc.length > 0 ? loc : null;
}

/** Ocurrencias de todos los VEVENT del calendario dentro de `[windowStart, windowEnd)`. */
export function parseIcalEvents(text: string, opts: ParseIcalOptions): IcalEvent[] {
  const { windowStart, windowEnd, viewerEmail } = opts;

  let root: Comp;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (err) {
    throw new Error(
      `No se pudo leer el calendario: ${err instanceof Error ? err.message : 'formato inválido'}`
    );
  }
  registerTimezones(root);

  // Agrupar VEVENTs por UID: uno "master" (sin RECURRENCE-ID) y sus overrides.
  const masters = new Map<string, Comp>();
  const overrides = new Map<string, Comp[]>();
  for (const ve of root.getAllSubcomponents('vevent')) {
    const uid = str(ve.getFirstPropertyValue('uid'));
    if (!uid) continue;
    if (ve.hasProperty('recurrence-id')) {
      const list = overrides.get(uid) ?? [];
      list.push(ve);
      overrides.set(uid, list);
    } else {
      masters.set(uid, ve);
    }
  }

  const out: IcalEvent[] = [];
  const emit = (uid: string, comp: Comp, start: Date, end: Date): void => {
    if (out.length >= MAX_EVENTS) return;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    out.push({ uid, summary: summaryOf(comp), start, end, location: locationOf(comp) });
  };
  const keep = (comp: Comp): boolean =>
    !isCancelled(comp) && !(viewerEmail && declinedByViewer(comp, viewerEmail));

  for (const [uid, master] of masters) {
    if (!keep(master)) continue;

    let event: InstanceType<typeof ICAL.Event>;
    try {
      event = new ICAL.Event(master, {
        exceptions: overrides.get(uid) ?? [],
        strictExceptions: false,
      });
    } catch {
      continue;
    }
    if (!event.startDate || event.startDate.isDate) continue; // sin hora: fuera de v2

    if (event.isRecurring()) {
      const it = event.iterator();
      let occ: InstanceType<typeof ICAL.Time> | null;
      let n = 0;
      while ((occ = it.next()) && n < MAX_ITER_PER_EVENT) {
        n++;
        const startJs = occ.toJSDate();
        if (startJs >= windowEnd) break;
        if (startJs < windowStart) continue;
        let det;
        try {
          det = event.getOccurrenceDetails(occ);
        } catch {
          continue;
        }
        const occComp = det.item?.component ?? master;
        if (!keep(occComp)) continue;
        const rid = det.recurrenceId?.toString() ?? occ.toString();
        emit(`${uid}::${rid}`, occComp, det.startDate.toJSDate(), det.endDate.toJSDate());
      }
    } else {
      const startJs = event.startDate.toJSDate();
      if (startJs >= windowStart && startJs < windowEnd) {
        emit(uid, master, startJs, event.endDate.toJSDate());
      }
    }
  }

  // Overrides cuyo master no vino en el feed: se tratan como eventos sueltos.
  for (const [uid, list] of overrides) {
    if (masters.has(uid)) continue;
    for (const ov of list) {
      if (!keep(ov)) continue;
      try {
        const ev = new ICAL.Event(ov);
        if (!ev.startDate || ev.startDate.isDate) continue;
        const startJs = ev.startDate.toJSDate();
        if (startJs < windowStart || startJs >= windowEnd) continue;
        const rid = str(ov.getFirstPropertyValue('recurrence-id'));
        emit(`${uid}::${rid}`, ov, startJs, ev.endDate.toJSDate());
      } catch {
        // override ilegible: lo saltamos
      }
    }
  }

  return out;
}
