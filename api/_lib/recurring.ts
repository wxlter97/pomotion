// Lógica pura de "tareas recurrentes": qué textos de la plantilla todavía
// no están en un día. Vive aparte de notionStore para poder testearla sin
// tocar Notion (recurring.test.ts).

import { normalize } from './parse.js';

/**
 * De la lista `recurring`, los textos cuyo equivalente normalizado (sin
 * acentos ni mayúsculas) no aparece en `existing`. Preserva el texto y el
 * orden originales de `recurring` y descarta repetidos y vacíos — es lo que
 * hay que crear en el día para "aplicar recurrentes" sin duplicar.
 */
export function missingRecurringTasks(existing: string[], recurring: string[]): string[] {
  const have = new Set(existing.map(normalize).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of recurring) {
    const key = normalize(text);
    if (!key || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
