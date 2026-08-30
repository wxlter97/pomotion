import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { es, type MsgKey } from './es';
import { en } from './en';

export type Lang = 'es' | 'en';
export type { MsgKey };

const DICTS: Record<Lang, Record<MsgKey, string>> = { es, en };
const LS_KEY = 'pomotion:lang';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
];

/** Idioma inicial: el guardado, si no el del navegador, si no español. */
export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored === 'es' || stored === 'en') return stored;
  } catch {
    /* localStorage no disponible */
  }
  try {
    return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

type Params = Record<string, string | number>;
export type TFn = (key: MsgKey, params?: Params) => string;

function interpolate(str: string, params?: Params): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** `t` para un idioma concreto (para usar fuera de React). */
export function makeT(lang: Lang): TFn {
  const dict = DICTS[lang] ?? es;
  return (key, params) => interpolate(dict[key] ?? es[key] ?? key, params);
}

/** "1 tarea" / "3 tareas" — es y en tienen la misma regla simple 1-vs-resto. */
export function plural(n: number, one: string, other: string): string {
  return Math.abs(n) === 1 ? one : other;
}

type Ctx = { lang: Lang; t: TFn; setLang: (l: Lang) => void };
const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LS_KEY, next);
    } catch {
      /* ignorar */
    }
  }, []);

  const t = useMemo(() => makeT(lang), [lang]);
  const value = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang]);

  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useT(): TFn {
  return useContext(LangCtx)?.t ?? makeT('es');
}

export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const ctx = useContext(LangCtx);
  if (!ctx) throw new Error('useLang() fuera de <LangProvider>');
  return { lang: ctx.lang, setLang: ctx.setLang };
}

// --- Nombres que el server manda siempre en español canónico ---

const DAY_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAY_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Traduce un nombre de día ("Lunes") como lo devuelve el server. */
export function localizeDay(day: string, lang: Lang): string {
  if (lang === 'es' || !day) return day;
  const i = DAY_ES.indexOf(day);
  return i >= 0 ? DAY_EN[i] : day;
}

const MONTH_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Nombre del mes 0..11 en el idioma dado. `capitalized` para títulos. */
export function monthName(index: number, lang: Lang, capitalized = false): string {
  const name = (lang === 'en' ? MONTH_EN : MONTH_ES)[index] ?? '';
  return capitalized ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

const MONTH_ABBR_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTH_ABBR_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Abreviatura del mes 0..11 ("sep" / "Sep"). */
export function monthAbbr(index: number, lang: Lang): string {
  return (lang === 'en' ? MONTH_ABBR_EN : MONTH_ABBR_ES)[index] ?? '';
}
