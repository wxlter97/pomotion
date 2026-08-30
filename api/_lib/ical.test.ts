import { describe, expect, it } from 'vitest';
import { parseIcalEvents } from './ical.js';

const WIN = { windowStart: new Date('2026-08-24T00:00:00Z'), windowEnd: new Date('2026-09-21T00:00:00Z') };

function cal(...vevents: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    'BEGIN:VTIMEZONE',
    'TZID:America/El_Salvador',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0600',
    'TZOFFSETTO:-0600',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n');
}

describe('parseIcalEvents', () => {
  it('lee un evento simple con hora y zona, convierte a UTC', () => {
    const events = parseIcalEvents(
      cal(
        'BEGIN:VEVENT',
        'UID:one',
        'SUMMARY:Reunión cliente',
        'DTSTART;TZID=America/El_Salvador:20260828T140000',
        'DTEND;TZID=America/El_Salvador:20260828T150000',
        'LOCATION:Sala 2',
        'END:VEVENT'
      ),
      WIN
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: 'one',
      summary: 'Reunión cliente',
      location: 'Sala 2',
    });
    expect(events[0].start.toISOString()).toBe('2026-08-28T20:00:00.000Z');
    expect(events[0].end.toISOString()).toBe('2026-08-28T21:00:00.000Z');
  });

  it('saltea eventos de día completo', () => {
    const events = parseIcalEvents(
      cal(
        'BEGIN:VEVENT',
        'UID:allday',
        'SUMMARY:Feriado',
        'DTSTART;VALUE=DATE:20260901',
        'DTEND;VALUE=DATE:20260902',
        'END:VEVENT'
      ),
      WIN
    );
    expect(events).toHaveLength(0);
  });

  it('saltea eventos cancelados', () => {
    const events = parseIcalEvents(
      cal(
        'BEGIN:VEVENT',
        'UID:x',
        'SUMMARY:Cancelada',
        'DTSTART;TZID=America/El_Salvador:20260828T100000',
        'DTEND;TZID=America/El_Salvador:20260828T110000',
        'STATUS:CANCELLED',
        'END:VEVENT'
      ),
      WIN
    );
    expect(events).toHaveLength(0);
  });

  it('saltea eventos rechazados por el usuario (PARTSTAT=DECLINED)', () => {
    const ics = cal(
      'BEGIN:VEVENT',
      'UID:y',
      'SUMMARY:No voy',
      'DTSTART;TZID=America/El_Salvador:20260828T100000',
      'DTEND;TZID=America/El_Salvador:20260828T110000',
      'ATTENDEE;PARTSTAT=DECLINED:mailto:yo@ejemplo.com',
      'END:VEVENT'
    );
    expect(parseIcalEvents(ics, { ...WIN, viewerEmail: 'yo@ejemplo.com' })).toHaveLength(0);
    expect(parseIcalEvents(ics, { ...WIN, viewerEmail: 'otro@ejemplo.com' })).toHaveLength(1);
  });

  it('expande un evento semanal dentro de la ventana y respeta EXDATE', () => {
    const events = parseIcalEvents(
      cal(
        'BEGIN:VEVENT',
        'UID:standup',
        'SUMMARY:Daily',
        'DTSTART;TZID=America/El_Salvador:20260810T090000',
        'DTEND;TZID=America/El_Salvador:20260810T091500',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        'EXDATE;TZID=America/El_Salvador:20260826T090000',
        'END:VEVENT'
      ),
      WIN
    );
    // 4 semanas de días hábiles (24 ago–18 sep) = 20, menos 1 EXDATE.
    expect(events.length).toBe(19);
    // cada ocurrencia tiene uid único.
    expect(new Set(events.map((e) => e.uid)).size).toBe(events.length);
    expect(events.every((e) => e.uid.startsWith('standup::'))).toBe(true);
    // el 26/08 quedó excluido.
    expect(events.some((e) => e.start.toISOString() === '2026-08-26T15:00:00.000Z')).toBe(false);
  });

  it('aplica los overrides con RECURRENCE-ID', () => {
    const events = parseIcalEvents(
      cal(
        'BEGIN:VEVENT',
        'UID:r',
        'SUMMARY:Semanal',
        'DTSTART;TZID=America/El_Salvador:20260825T090000',
        'DTEND;TZID=America/El_Salvador:20260825T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:r',
        'RECURRENCE-ID;TZID=America/El_Salvador:20260901T090000',
        'SUMMARY:Semanal (movida)',
        'DTSTART;TZID=America/El_Salvador:20260901T110000',
        'DTEND;TZID=America/El_Salvador:20260901T120000',
        'END:VEVENT'
      ),
      WIN
    );
    const moved = events.find((e) => e.summary === 'Semanal (movida)');
    expect(moved).toBeDefined();
    expect(moved?.start.toISOString()).toBe('2026-09-01T17:00:00.000Z');
  });

  it('lanza un error legible ante datos no-iCal', () => {
    expect(() => parseIcalEvents('esto no es un calendario', WIN)).toThrow();
  });
});
