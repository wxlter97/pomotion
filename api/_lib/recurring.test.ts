import { describe, expect, it } from 'vitest';
import { missingRecurringTasks } from './recurring.js';

describe('missingRecurringTasks', () => {
  it('devuelve todos si el día está vacío', () => {
    expect(missingRecurringTasks([], ['Standup', 'Revisar correos'])).toEqual([
      'Standup',
      'Revisar correos',
    ]);
  });

  it('no devuelve nada si ya están todos', () => {
    expect(missingRecurringTasks(['Standup', 'Revisar correos'], ['Standup', 'Revisar correos'])).toEqual(
      []
    );
  });

  it('deduplica por acentos y mayúsculas', () => {
    expect(missingRecurringTasks(['revisar CORREOS', 'stand-up'], ['Revisar Correos'])).toEqual([]);
    expect(missingRecurringTasks(['Revisión regional'], ['revision regional'])).toEqual([]);
  });

  it('preserva el orden y el texto original de recurring', () => {
    expect(missingRecurringTasks(['B'], ['A', 'B', 'C'])).toEqual(['A', 'C']);
  });

  it('descarta repetidos dentro de recurring', () => {
    expect(missingRecurringTasks([], ['Standup', 'standup', 'STANDUP'])).toEqual(['Standup']);
  });

  it('ignora textos vacíos', () => {
    expect(missingRecurringTasks(['', '  '], ['Standup', ''])).toEqual(['Standup']);
  });
});
