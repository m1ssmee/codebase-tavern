// Animal-Crossing-style gibberish: short square/triangle blips while a character's text streams.
let ctx: AudioContext | null = null;
let next = 0; // audio-clock time of the next free blip slot

/** Create/resume on a user gesture (browsers block audio until then). */
export function unlockAudio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
}

/** One blip per letter/digit, ~70ms apart, never queued more than 0.6s ahead (so it stops with the text). */
export function blipText(text: string, pitch: number, muted: boolean) {
  if (!ctx || ctx.state !== 'running' || muted) return;
  const now = ctx.currentTime;
  next = Math.max(next, now);
  for (const ch of text) {
    if (!/[\p{L}\p{N}]/u.test(ch)) continue; // skip spaces and punctuation
    if (next > now + 0.6) break;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = Math.random() < 0.5 ? 'square' : 'triangle';
    osc.frequency.value = 260 * pitch * (0.85 + Math.random() * 0.3);
    const len = 0.04 + Math.random() * 0.02;
    gain.gain.setValueAtTime(0.035, next);
    gain.gain.exponentialRampToValueAtTime(0.0001, next + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(next);
    osc.stop(next + len);
    next += 0.07;
  }
}

/** Verdict airhorn: layered detuned sawtooths through a lowpass, ~0.6s. */
export function airhorn(muted: boolean) {
  unlockAudio();
  if (!ctx || muted) return;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
  gain.gain.setValueAtTime(0.16, now + 0.45);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2600;
  filter.connect(gain).connect(ctx.destination);
  for (const f of [415, 418, 622, 830]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f * 0.94, now); // quick upward bend, like the real thing
    osc.frequency.linearRampToValueAtTime(f, now + 0.07);
    osc.connect(filter);
    osc.start(now);
    osc.stop(now + 0.62);
  }
}
