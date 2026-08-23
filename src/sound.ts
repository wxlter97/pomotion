/**
 * Chimes cortos sintetizados con Web Audio API — sin archivos de audio ni
 * dependencias nuevas. Avisan que terminó una fase del pomodoro (trabajo o
 * descanso) sin tener que estar mirando la pestaña.
 */

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
    .webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  return audioContext;
}

/**
 * Los navegadores solo dejan arrancar/reanudar audio a partir de un gesto
 * real del usuario. Un pomodoro termina solo, sin click en ese momento —
 * así que esto se llama al presionar "Iniciar" (gesto real) para dejar el
 * contexto listo de antemano, y el chime más tarde no se bloquea.
 */
export function unlockAudio(): void {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

function tone(ctx: AudioContext, freq: number, startAt: number, duration: number, gainPeak = 0.15) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

export type ChimeKind = 'work-done' | 'break-done';

export function playChime(kind: ChimeKind): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  if (kind === 'work-done') {
    // Dos notas ascendentes: "listo, a descansar".
    tone(ctx, 880, now, 0.18);
    tone(ctx, 1174.66, now + 0.16, 0.22);
  } else {
    // Una nota: "se acabó el descanso".
    tone(ctx, 659.25, now, 0.28, 0.12);
  }
}
