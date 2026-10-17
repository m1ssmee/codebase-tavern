'use client';
// Calls into the stage's scenes from anywhere (chat, Tribunal, What-if, the code panel) without pulling three.js into
// those bundles: the scenes load on first use, then every call goes straight through.
type Scenes = typeof import('./scenes');
let mod: Promise<Scenes> | null = null;

export function stageDo<K extends keyof Scenes>(k: K, ...args: Scenes[K] extends (...a: infer A) => unknown ? A : never): Promise<unknown> {
  return (mod ??= import('./scenes')).then((m) => (m[k] as unknown as (...a: unknown[]) => unknown)(...args));
}
