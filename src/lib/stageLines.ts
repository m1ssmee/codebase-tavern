// Deterministic lines for the stage (no AI): two modules that never met, a character thrown across the room, the
// demo's "live AI is off", a dependent pointing at its import. Dry, factual, swearing only at the swearing levels.
import type { Citation, ModuleStats, SpiceLevel } from './types';

type Who = { id: string; name: string; stats: ModuleStats };
const pick = <T,>(xs: T[], seed: string) => xs[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % xs.length];
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fmt = (c: Citation) => `[${c.path}:${c.startLine}${c.endLine > c.startLine ? `-${c.endLine}` : ''}]`;

/** Four turns for two modules with no import or call between them. */
export function neverMet(a: Who, b: Who, spice: SpiceLevel): { moduleId: string; text: string }[] {
  const A = a.stats, B = b.stats;
  const lines: Record<SpiceLevel, string[]> = {
    clean: [
      `We've never even met. No imports, no calls, nothing between ${a.name} and ${b.name}.`,
      `${plural(B.totalLines, 'line')} in ${plural(B.fileCount, 'file')}, and not one of them mentions ${a.name}. I'd like to keep it that way.`,
      `${plural(A.totalLines, 'line')} and ${plural(A.todoCount, 'TODO')} here, and still no reason to call you.`,
      `Then this argument is the only thing we share.`,
    ],
    unhinged: [
      `We've never even met. Not one damn import between ${a.name} and ${b.name}.`,
      `${plural(B.totalLines, 'line')} in ${plural(B.fileCount, 'file')}, and none of them mention ${a.name}. Keep it that way.`,
      `${plural(A.totalLines, 'line')}, ${plural(A.todoCount, 'TODO')}, and still no reason to call you. Hell of a coincidence.`,
      `Then this is the only damn thing we share.`,
    ],
    feral: [
      `We've never even met. Zero imports, zero calls, and I'd like that shit to stay zero.`,
      `${plural(B.totalLines, 'line')} in ${plural(B.fileCount, 'file')}, and none of them would touch ${a.name} with a damn stick.`,
      `${plural(A.totalLines, 'line')} and ${plural(A.todoCount, 'TODO')} over here. I have my own mess, I don't need yours.`,
      `Good. Your mess stinks from across the repo anyway.`,
    ],
    nuclear: [
      `WE HAVE NEVER EVEN MET. Not one import, not one call, nothing.`,
      `${plural(B.totalLines, 'line')} in ${plural(B.fileCount, 'file')} and none of them want ${a.name}. Fucking good.`,
      `${plural(A.totalLines, 'line')}, ${plural(A.todoCount, 'TODO')}, and I'd git rm myself before importing you.`,
      `Then why the hell are we arguing. Back to your corner.`,
    ],
  };
  return lines[spice].map((text, i) => ({ moduleId: i % 2 ? b.id : a.id, text }));
}

/** After being flung across the screen. */
export function flingLine(who: Who, spice: SpiceLevel, seed = ''): string {
  const n = who.stats.totalLines;
  const lines: Record<SpiceLevel, string[]> = {
    clean: [`${plural(n, 'line')} of me just hit the floor. None of them handle being thrown.`, `I am ${plural(n, 'line')} of code, not a frisbee.`],
    unhinged: [`${plural(n, 'line')} of me just hit the damn floor.`, `I am ${plural(n, 'line')} of code, not a frisbee. Hell.`],
    feral: [`${plural(n, 'line')} flung across the room. I think my imports came loose, shit.`, `That landing knocked ${plural(who.stats.todoCount, 'TODO')} loose. Damn it.`],
    nuclear: [`I JUST GOT THROWN. ${plural(n, 'line')}, all bruised.`, `${plural(n, 'line')} in the air. One more throw and I git rm myself.`],
  };
  return pick(lines[spice], seed + n);
}

/** The demo route makes no AI calls: one in-character line instead of an answer. */
export function aiOffLine(spice: SpiceLevel, seed = ''): string {
  const lines: Record<SpiceLevel, string[]> = {
    clean: ['Live AI is off in this demo, so I have nothing new to say. Try line 50 of orders/checkout.ts on orders.'],
    unhinged: ['Live AI is off in this demo, so I am not saying a damn thing new. Try line 50 of orders/checkout.ts on orders.'],
    feral: ['Live AI is off in this demo, so you get nothing new from me, shit. Try line 50 of orders/checkout.ts on orders.'],
    nuclear: ['LIVE AI IS OFF. Nothing new from me. Try line 50 of orders/checkout.ts on orders.'],
  };
  return pick(lines[spice], seed);
}

/** A dependent points at the line where it imports (or calls) the module that asked "Who needs you?". */
export function needsLine(dep: Who, subject: string, ref: Citation & { kind: 'imports' | 'calls' }, weight: number, spice: SpiceLevel): string {
  const how = ref.kind === 'calls' ? `call ${subject} over the network` : `import ${subject}`;
  const times = weight === 1 ? 'once' : `${weight} times`;
  const tail: Record<SpiceLevel, string> = { clean: '', unhinged: ' Every damn day.', feral: ' Every day, and it stinks every time.', nuclear: ' EVERY. SINGLE. DAY.' };
  return `I ${how} ${times}, starting here ${fmt(ref)}.${tail[spice]}`;
}

/** The subject's own answer to "Who needs you?" from the graph (the demo route, or when the AI is out). */
export function needsSummary(subject: string, deps: { name: string; weight: number; kind: 'imports' | 'calls'; ref: Citation }[], spice: SpiceLevel): string {
  if (!deps.length) return spice === 'clean' ? 'Nobody imports me and nobody calls me. Quiet life.' : 'Nobody imports me and nobody calls me. Quiet as hell.';
  const parts = deps.map((d) => `${d.name} ${d.kind === 'calls' ? 'calls me' : 'imports me'} ${d.weight === 1 ? 'once' : `${d.weight} times`} ${fmt(d.ref)}`);
  const end: Record<SpiceLevel, string> = { clean: 'Change me and they all notice.', unhinged: 'Change me and they all feel it, damn it.', feral: 'Change me and the whole floor starts whining.', nuclear: 'CHANGE ME AND THEY ALL GO DOWN.' };
  return `${plural(deps.length, 'module')} need me: ${parts.join('; ')}. ${end[spice]}`;
}
