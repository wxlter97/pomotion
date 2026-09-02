/**
 * Set de íconos inline compartido — mismo estilo (trazo, sin relleno salvo
 * donde se indica) para que la navegación (bottom nav / sidebar) y los
 * headers de cada pantalla se vean consistentes.
 */

export function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <circle cx="12" cy="5" r="1.85" />
      <circle cx="12" cy="12" r="1.85" />
      <circle cx="12" cy="19" r="1.85" />
    </svg>
  );
}

export function TodayIcon({ active }: { active?: boolean } = {}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="16" rx="3.5" />
      <path d="M8 3v3M16 3v3M3.5 9.5h17" />
      <path d="M8.5 14l2 2 4.5-4.5" />
    </svg>
  );
}

export function AgendaIcon({ active }: { active?: boolean } = {}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="16" rx="3.5" />
      <path d="M8 3v3M16 3v3M3.5 9.5h17" />
      <path d="M7.5 13h3M7.5 16.5h6M13.5 13h3" />
    </svg>
  );
}

export function StatsIcon({ active }: { active?: boolean } = {}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

/* Engranaje real (dientes + orificio central) — deliberadamente distinto del
 * ícono de sol/luna del cambio de tema, con el que antes se confundía. */
export function SettingsIcon({ active }: { active?: boolean } = {}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 1.9 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="10.2,2.9 13.8,2.9 13.3,5.5 15.7,6.5 17.2,4.3 19.7,6.8 17.5,8.3 18.5,10.7 21.1,10.2 21.1,13.8 18.5,13.3 17.5,15.7 19.7,17.2 17.2,19.7 15.7,17.5 13.3,18.5 13.8,21.1 10.2,21.1 10.7,18.5 8.3,17.5 6.8,19.7 4.3,17.2 6.5,15.7 5.5,13.3 2.9,13.8 2.9,10.2 5.5,10.7 6.5,8.3 4.3,6.8 6.8,4.3 8.3,6.5 10.7,5.5" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.7-4.7" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="16" rx="3.5" />
      <path d="M8 3v3M16 3v3M3.5 9.5h17" />
    </svg>
  );
}
