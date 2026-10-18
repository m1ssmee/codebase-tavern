// What a character says while it waits on an AI call (the thinking cue): no AI, a few words in its own voice. Four
// lines per archetype, the Landlord and the Judge included: two openers (one is picked per wait), the line after
// 5 s, and the "still going" line after 12 s. Clean has no swearing; nuclear shouts the start of the "still going"
// line (one outburst).
// Pure, so scripts/check.mjs runs it directly.
import type { Archetype } from './cast.ts';
import type { SpiceLevel } from './types.ts';

type Four = [opener: string, alt: string, second: string, still: string];
export const THINKING: Record<Archetype, { clean: Four; spicy: Four }> = {
  bouncer: {
    clean: ['Checking the list.', 'Arms crossed. Thinking.', 'Running it past the list again.', 'Still checking. The list is long.'],
    spicy: ['Checking the damn list.', 'Arms crossed. Thinking.', 'Running it past the list again.', 'Still checking. The list is long as hell.'],
  },
  accountant: {
    clean: ['Recounting.', 'Carrying the one.', 'Checking it against the ledger.', 'Still counting. Twice, as usual.'],
    spicy: ['Recounting.', 'Carrying the damn one.', 'Checking it against the ledger.', 'Still counting. Twice, as fucking usual.'],
  },
  clerk: {
    clean: ['Taking a number.', 'Your request is in the tray.', 'Stamping. Slowly.', "Still in the queue. You're next, probably."],
    spicy: ['Taking a number.', 'Your damn request is in the tray.', 'Stamping. Slowly.', "Still in the queue. You're next, probably. Hell."],
  },
  doorman: {
    clean: ['One moment.', 'Checking the watch.', 'Holding the door.', 'Still holding the door. My arm is tired.'],
    spicy: ['One moment.', 'Checking the damn watch.', 'Holding the door.', 'Still holding the door. My arm is shot to hell.'],
  },
  hoarder: {
    clean: ["It's in here somewhere.", 'Digging.', 'Moving the old things out of the way.', 'Still digging. Found a rubber duck.'],
    spicy: ["It's in here somewhere.", 'Digging through this crap.', 'Moving the old junk out of the way.', 'Still digging. Found a damn rubber duck.'],
  },
  inspector: {
    clean: ['Inspecting.', 'Looking closer.', 'Taking notes.', 'Still inspecting. There is a lot to see.'],
    spicy: ['Inspecting.', 'Looking closer. Ugh.', 'Taking notes. Bad ones.', 'Still inspecting. There is a hell of a lot to see.'],
  },
  junkDrawer: {
    clean: ['Rummaging.', 'Somewhere between the batteries and the string.', 'Opening the drawer.', 'Still rummaging. Everything is in here.'],
    spicy: ['Rummaging.', 'Somewhere between the dead batteries and the string.', 'Opening the damn drawer.', 'Still rummaging. Every damn thing is in here.'],
  },
  plumber: {
    clean: ['Following the pipe.', 'Checking for leaks.', 'Tightening something.', "Still under the sink. It's wet down here."],
    spicy: ['Following the pipe.', 'Checking for leaks. There are leaks.', 'Tightening some damn valve.', "Still under the sink. It's wet as hell down here."],
  },
  star: {
    clean: ['Finding my light.', 'One more take.', 'Checking my angles.', 'Still in makeup.'],
    spicy: ['Finding my light.', 'One more damn take.', 'Checking my angles.', 'Still in makeup. It takes a hell of a while.'],
  },
  librarian: {
    clean: ['Looking it up.', 'Checking the index.', 'Pulling the right volume.', 'Still in the stacks. Someone shelved it wrong.'],
    spicy: ['Looking it up.', 'Checking the damn index.', 'Pulling the right volume.', 'Still in the stacks. Someone shelved it wrong, damn it.'],
  },
  landlord: {
    clean: ["I'll get to it. Eventually.", 'Checking the lease.', 'Counting the keys.', 'Still on it. Rent is still due.'],
    spicy: ["I'll get to it. Eventually.", 'Checking the damn lease.', 'Counting the keys.', 'Still on it. Rent is still due, by the way.'],
  },
  judge: {
    clean: ['The court is thinking.', 'Reviewing the evidence.', 'Consulting the bench.', 'The court is still deliberating. Sit down.'],
    spicy: ['The court is thinking.', 'Reviewing the damn evidence.', 'Consulting the bench.', 'The court is still deliberating. Sit the hell down.'],
  },
};

/** All four lines at a spice level (nuclear: the first sentence of the "still going" line in capitals, its one outburst). */
export function thinkingLines(arch: Archetype, spice: SpiceLevel): Four {
  const t = THINKING[arch] ?? THINKING.clerk;
  if (spice === 'clean') return t.clean;
  return spice === 'nuclear' ? [t.spicy[0], t.spicy[1], t.spicy[2], shout(t.spicy[3])] : t.spicy;
}
export const shout = (line: string) => line.replace(/^[^.!?]*[.!?]/, (s) => s.toUpperCase());

/** The line to show `ms` into a wait: an opener (picked by `seed`), the second line after 5 s, "still going" after 12 s. */
export function thinkingLine(arch: Archetype, spice: SpiceLevel, ms: number, seed = 0): string {
  const [a, b, second, still] = thinkingLines(arch, spice);
  return ms >= 12_000 ? still : ms >= 5_000 ? second : seed % 2 ? b : a;
}
