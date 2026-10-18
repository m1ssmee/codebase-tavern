// Deterministic lines for the stage (no AI): two modules that never met, a character thrown across the room, a
// deflection when it won't answer, a dependent pointing at its import. Dry, factual, swearing only at swearing levels.
import type { Citation, ModuleStats, SpiceLevel } from './types';
import type { Archetype } from './cast';

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

/** A character holding a grudge opens its answer with this (the AI is told it's already said). Never at the user. */
export function sulkyOpener(g: { roasted: number; pestered: number }, spice: SpiceLevel): string {
  const what = g.roasted ? `Roasted ${g.roasted === 1 ? 'once' : `${g.roasted} times`}` : `Pestered ${g.pestered === 1 ? 'once' : `${g.pestered} times`}`;
  const lines: Record<SpiceLevel, string> = {
    clean: `${what} in the last 10 minutes, and I'm still on duty. Fine.`,
    unhinged: `${what} in the last 10 minutes and still answering. Fine, here's how my damn code works.`,
    feral: `${what} in 10 minutes. I'm sulking like hell, but fine, here's the answer.`,
    nuclear: `${what.toUpperCase()} IN 10 MINUTES. Fine. Here's the answer anyway.`,
  };
  return lines[spice];
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

/**
 * When a character won't answer (no saved answer on the demo route, an argument that can't be written): one of four
 * in-character deflections per archetype, in turn, each with its own bubble. Nothing about demos or AI. No swearing,
 * so every one holds at every spice level.
 */
type Deflect = { text: string; bubble: string };
const d = (text: string, bubble: string): Deflect => ({ text, bubble });
export const DEFLECTIONS: Record<Archetype, Deflect[]> = {
  bouncer: [
    d("That question isn't on the list, and nothing gets past me without being listed.", 'Not on the list. Turned away.'),
    d("I check credentials, not curiosity. That one stays outside.", "Curiosity doesn't count as a credential."),
    d('Arms crossed, answer withheld. Come back with a better question.', 'Arms crossed. Question denied.'),
    d("I've seen that question before. It didn't get past me then either.", 'That question bounced last time too.'),
  ],
  accountant: [
    d("That's not in the ledger, and I don't discuss anything off the books.", 'Not in the ledger, not my problem.'),
    d("I'd have to bill you for that answer, and the invoice isn't ready.", 'That answer is billable. Invoice pending.'),
    d('I counted the reasons to answer that. Zero, twice.', 'Counted twice. Still zero reasons.'),
    d("Put it in writing and I'll reconcile it at the end of the quarter.", 'Reconciling that next quarter.'),
  ],
  clerk: [
    d('Wrong window. That request goes in a different queue.', 'Wrong window, wrong queue.'),
    d("I've stamped it as pending. On what, I couldn't tell you.", 'Stamped pending. Indefinitely.'),
    d('That form needs three signatures, and I have none of them.', 'Missing three signatures.'),
    d('Take a number. The number is very large.', 'Your number is very large.'),
  ],
  doorman: [
    d("That door stays shut. I don't make the rules, I just hold the handle.", 'That door stays shut.'),
    d('Your timing is off, and timing is all I have.', 'Bad timing. My only specialty.'),
    d("I'd let that one through, but my watch says no.", 'The watch says no.'),
    d("Not now. Possibly not ever. I'll check the schedule.", 'Checked the schedule. Still no.'),
  ],
  hoarder: [
    d('I had an answer for that somewhere, under the other answers.', "It's under the other answers."),
    d('That one went in the pile, and the pile does not give things back.', "The pile doesn't give things back."),
    d("I'm keeping that answer. It might be useful one day.", 'Saving that answer for later.'),
    d("I'd look for it, but I'd have to move everything else first.", "I'd have to move everything first."),
  ],
  inspector: [
    d('That question failed inspection. Missing details, poor finish.', 'Question failed inspection.'),
    d("I only answer what I can put under the magnifier. That isn't it.", 'Nothing under the magnifier.'),
    d("Noted on the clipboard as unanswerable at this time.", 'Filed under not today.'),
    d("I inspected the question. It's not up to code.", "That question isn't up to code."),
  ],
  junkDrawer: [
    d('Somewhere in this drawer is an answer. Also a dead battery and some string.', "The answer's in the drawer. Somewhere."),
    d('I opened the drawer, looked at the mess, and closed it again.', 'Drawer opened, drawer closed.'),
    d("That answer is wedged behind a takeaway menu. It's staying there.", 'Wedged behind a takeaway menu.'),
    d('Ask me something I can find without emptying the whole drawer.', 'Not emptying the whole drawer for this one.'),
  ],
  plumber: [
    d("That pipe doesn't connect to anything I can open today.", 'That pipe goes nowhere today.'),
    d("I'm mid-leak. Questions will have to wait their turn.", 'Mid-leak. Get in line.'),
    d("I'd answer, but the valve is stuck and I'm not forcing it.", "The valve's stuck. Not forcing it."),
    d("That one's further down the line than I'm willing to crawl.", 'Too far down the line to crawl.'),
  ],
  star: [
    d("I don't do that scene. Talk to my agent.", 'Talk to my agent.'),
    d("That's not in my script, and I don't improvise for free.", 'Not in the script.'),
    d("Wrong lighting for that question. I'm not taking it.", 'Wrong lighting for that one.'),
    d("I'll answer that in my memoir. Chapter twelve.", 'Saving that for the memoir.'),
  ],
  librarian: [
    d('That volume is checked out, and nobody knows who has it.', 'That volume is checked out.'),
    d('Quiet. That question is too loud for this section.', 'Too loud for this section.'),
    d("It's in the reference section, which does not lend.", 'Reference only. Not for lending.'),
    d("I'd look it up, but the index for that page is missing.", 'The index page is missing.'),
  ],
  landlord: [
    d("That's not covered by the lease.", 'Not covered by the lease.'),
    d("Put a request in writing. I'll ignore it in writing.", "Put it in writing. I'll ignore it."),
    d("That's a tenant matter. Ask a tenant.", 'Tenant matter. Ask a tenant.'),
    d("Answers cost extra this month. Rent's going up anyway.", 'Answers cost extra this month.'),
  ],
  judge: [
    d('Overruled. The court declines to answer.', 'Overruled. Next question.'),
    d('That question is out of order.', 'Out of order. Sit down.'),
    d('The court takes that under advisement. Indefinitely.', 'Under advisement. Indefinitely.'),
    d('Inadmissible. Strike it from the record.', 'Struck from the record.'),
  ],
};
const turn = new Map<Archetype, number>();
/** The next deflection for this archetype (they rotate). */
export function deflection(arch: Archetype): Deflect {
  const list = DEFLECTIONS[arch] ?? DEFLECTIONS.clerk;
  const i = turn.get(arch) ?? 0;
  turn.set(arch, i + 1);
  return list[i % list.length];
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
