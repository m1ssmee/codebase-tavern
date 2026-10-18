'use client';
// What the characters on stage do: walk to a line and point, talk in bubbles, tour the lines an answer cites, line
// up for "Who needs you?", argue, get flung, hold the Tribunal over the code, pass the What-if hot potato, and react
// to the user (peeks, groans, dizziness, waves, boredom). Loaded lazily (it pulls in three.js through the director).
import { useTavern } from '@/lib/store';
import { extractCitations, isValidCitation } from '@/lib/citations';
import { blipText } from '@/lib/blips';
import { dependentsOf } from '@/lib/graph';
import { entryFile, isCode } from '@/lib/analyze';
import { aiOffLine, flingLine, needsLine, needsSummary, neverMet } from '@/lib/stageLines';
import { quip } from '@/lib/quip';
import type { Citation, ChatMessage } from '@/lib/types';
import demoArgue from '@/data/demoArgue.json';
import { getActor } from '../cast/anim/actor';
import { bonk, bored as boredGag, click as clickActor, completeFix as fixGag, judgeVerdict, outOfScope, roast as roastGag, undo as undoGag } from '../cast/anim/director';
import { reducedMotion } from '../cast/settings';
import { actorOf, addGrudge, grudgeOf, think, useStage, type Anchor, type Bubble, type Member, type MemberKind, type Role } from './store';
import { bus, lineBox, reveal } from './bus';
import { aims, anchorPoint, codeRect, leftBlocked, placed, sizeOf } from './geo';
import { resetPerches } from './perches';

const S = () => useStage.getState();
const T = () => useTavern.getState();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NORMAL = 3; // the speaker and two others
const SCENE = 5;
const STOP_MS = 1200; // at least this long at each line an answer cites

// Hidden on the Neighbourhood and the Blueprint (they have their own casts) and during the Landlord's tour (its own show).
export const visible = () => S().tenants !== 'off' && T().view !== 'map' && T().view !== 'diagram' && !T().tourOn && !!T().repo;
/** Walking and pointing only when tenants are on stage and motion is allowed; else they stand still and an arrow points. */
const walks = () => S().tenants === 'stage' && !reducedMotion();
const kindOf = (id: string): MemberKind => (id === 'judge' ? 'judge' : id === 'landlord' ? 'landlord' : 'module');
/** The Neighbourhood and the Blueprint have their own casts: the same scenes play there, in bubbles over their characters. */
const onMap = () => T().view === 'map' || T().view === 'diagram';
const aid = (id: string) => (T().view === 'map' ? `map:${id}` : T().view === 'diagram' ? `bp:${id}` : actorOf(id));
const actor = (id: string) => getActor(aid(id));
const nameOf = (id: string) => T().characters[id]?.name ?? T().repo?.modules.find((m) => m.id === id)?.name ?? id;
const key = (c: Citation) => `${c.path}:${c.startLine}-${c.endLine}`;

// ---------- members ----------
export function enter(id: string, anchor: Anchor = { k: 'home' }, temp = false) {
  useStage.setState((s) => {
    if (s.members.some((m) => m.id === id)) return { members: s.members.map((m) => (m.id === id ? { ...m, anchor, temp: !!m.temp && temp } : m)) };
    const members: Member[] = [...s.members, { id, kind: kindOf(id), anchor, temp }];
    const cap = s.scene ? SCENE : NORMAL;
    // Over the cap: the oldest extra leaves (never the speaker, the newcomer, or anyone in the scene).
    while (members.length > cap) {
      const i = members.findIndex((m) => m.id !== s.speaker && m.id !== id && !(s.scene && m.temp));
      if (i < 0) break;
      members.splice(i, 1);
    }
    return { members };
  });
}
export function leave(id: string) {
  useStage.setState((s) => {
    const bubbles = { ...s.bubbles };
    delete bubbles[id];
    return { members: s.members.filter((m) => m.id !== id), bubbles, speaker: s.speaker === id ? null : s.speaker };
  });
}
export const setAnchor = (id: string, anchor: Anchor) => useStage.setState((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, anchor } : m)) }));
const anchorOf = (id: string) => S().members.find((m) => m.id === id)?.anchor;

/** The module the user is talking to stands first in line; up to two others stay on. */
export function speaker(id: string) {
  enter(id, anchorOf(id) ?? { k: 'home' });
  useStage.setState((s) => {
    const me = s.members.find((m) => m.id === id)!;
    return { speaker: id, members: [{ ...me, temp: false }, ...s.members.filter((m) => m.id !== id)] };
  });
}

/**
 * The speaker's companions: its strongest dependency (perches above) and its strongest dependent (beside the chat),
 * by edge weight with imports and calls added up. A missing one is filled by the next-strongest neighbour; none, alone.
 */
export function companions(id: string): { id: string; role: Role }[] {
  const edges = T().graph?.edges ?? [];
  const rank = (other: (e: (typeof edges)[number]) => string | null) => {
    const w = new Map<string, number>();
    for (const e of edges) {
      const k = other(e);
      if (k && k !== id) w.set(k, (w.get(k) ?? 0) + e.weight);
    }
    return [...w].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
  const up = rank((e) => (e.from === id ? e.to : null))[0];
  const side = rank((e) => (e.to === id ? e.from : null)).find((x) => x !== up);
  const rest = rank((e) => (e.from === id ? e.to : e.to === id ? e.from : null)).filter((x) => x !== up && x !== side);
  const pals: { id: string | undefined; role: Role }[] = [
    { id: up ?? rest.shift(), role: 'up' },
    { id: side ?? rest.shift(), role: 'side' },
  ];
  return pals.filter((p): p is { id: string; role: Role } => !!p.id);
}

/** The cast for the selected module: it and its two companions. Those already on stage float to their new perches. */
export function castFor(selected: string | null) {
  const t = T();
  if (!t.repo || !selected) return;
  const pals = companions(selected);
  const keep = new Set([selected, ...pals.map((p) => p.id)]);
  resetPerches();
  useStage.setState((s) => ({
    members: [{ id: selected, kind: 'module', anchor: { k: 'home' } }, ...pals.map((p): Member => ({ id: p.id, kind: 'module', anchor: { k: 'home' }, role: p.role }))],
    speaker: selected,
    bubbles: Object.fromEntries(Object.entries(s.bubbles).filter(([k]) => keep.has(k))),
    scene: null,
    potato: null,
    arrows: {},
    dim: false,
  }));
}

// ---------- talking ----------
export function say(id: string, b: Bubble | null) {
  useStage.setState((s) => {
    const bubbles = { ...s.bubbles };
    if (b) bubbles[id] = b;
    else delete bubbles[id];
    return { bubbles };
  });
}
const busy = (id: string, on: boolean) => useStage.setState((s) => ({ busy: { ...s.busy, [id]: on } }));
export const isBusy = (id: string) => !!S().busy[id] || (T().isLoading && T().selectedModuleId === id);

/** A bubble that types itself out with the character's voice, then stays `keep` ms. */
export async function typeOut(id: string, text: string, o: { keep?: number; avoid?: Citation | null; link?: string } = {}) {
  const pitch = T().characters[id]?.voicePitch ?? 1;
  actor(id)?.setTalking(true);
  if (reducedMotion()) say(id, { text, avoid: o.avoid, link: o.link });
  else
    for (let i = 2; i < text.length; i += 2) {
      say(id, { text: text.slice(0, i), avoid: o.avoid, link: o.link });
      blipText(text[i - 1], pitch, T().muted);
      await sleep(40);
    }
  say(id, { text, avoid: o.avoid, link: o.link, until: Date.now() + (o.keep ?? 5000) });
  actor(id)?.setTalking(false);
}

/** Add a line to the transcript (the right panel), in the selected module's history. Returns its element id. */
function transcript(speakerId: string, text: string, role: ChatMessage['role'] = 'character'): string | undefined {
  const t = T();
  const mod = t.selectedModuleId;
  if (!mod) return;
  const id = crypto.randomUUID();
  t.addMessage(mod, { id, role, characterId: speakerId, text, citations: extractCitations(text).filter((c) => isValidCitation(c, t.repo?.files ?? [])) });
  return `msg-${id}`;
}
/** Said in the transcript in full; the bubble gets the quip (the line with the most personality) and links to it. */
async function sayBoth(id: string, text: string, o: { keep?: number; avoid?: Citation | null } = {}) {
  const link = transcript(id, text);
  await typeOut(id, quip(text, T().spice), { keep: 5000, ...o, link });
}

// ---------- pointing ----------
async function until(ok: () => boolean, ms: number) {
  const t0 = Date.now();
  while (!ok() && Date.now() - t0 < ms) await sleep(50);
}
const arrived = (id: string) => {
  const m = S().members.find((x) => x.id === id);
  const p = placed.get(id);
  if (!m || !p) return true;
  const want = anchorPoint(m, null, { w: p.w, h: p.h });
  return !want || Math.hypot(want.x - p.x, want.y - p.y) < 14;
};

/**
 * Walk to a line and point at it in the character's own style (sweeping down a range), keeping it in view. Opens
 * the file first if the line lives elsewhere. At least STOP_MS per stop. Parked or reduced motion: an arrow instead.
 */
export async function pointLine(id: string, c: Citation, o: { hold?: number } = {}) {
  const t = T();
  if (!visible() || !t.repo?.files.some((f) => f.path === c.path)) return;
  const t0 = Date.now();
  if (t.view !== 'code') t.setView('code');
  t.highlightCitation(c);
  await until(() => bus.path === c.path, 1500);
  reveal(c.startLine, c.endLine);
  const side = leftBlocked(id, S().members, c.startLine) ? 'R' : 'L';
  if (!walks()) {
    useStage.setState((s) => ({ arrows: { ...s.arrows, [id]: c } }));
    await sleep(Math.max(STOP_MS, (o.hold ?? 1) * 1000));
    return;
  }
  setAnchor(id, { k: 'line', c, side });
  useStage.setState((s) => ({ bubbles: s.bubbles[id] ? { ...s.bubbles, [id]: { ...s.bubbles[id], avoid: c } } : s.bubbles }));
  await until(() => arrived(id), 1600);
  const aim = aims.get(id);
  const a = actor(id);
  const lines = c.endLine - c.startLine;
  if (a && aim) {
    const hold = o.hold ?? 0.9;
    await Promise.race([a.pointAt(aim.from, lines ? { range: aim.to, sweep: Math.min(1.8, 0.5 + lines * 0.08), hold } : { hold }), sleep(4000)]);
  }
  const left = STOP_MS - (Date.now() - t0);
  if (left > 0) await sleep(left);
}

/** Back to its spot after a while, unless something else moved it since. */
function settle(id: string, ms = 5000) {
  const was = anchorOf(id);
  setTimeout(() => {
    if (anchorOf(id) === was && !isBusy(id)) {
      setAnchor(id, S().scene === 'tribunal' && id !== 'judge' ? anchorOf(id)! : { k: 'home' });
      useStage.setState((s) => {
        const arrows = { ...s.arrows };
        delete arrows[id];
        return { arrows };
      });
    }
  }, ms);
}

/** Visit each valid citation in a growing text, in order, until it is complete (at most 6 stops). */
async function tour(id: string, text: () => string, done: () => boolean) {
  const files = T().repo?.files ?? [];
  let i = 0;
  let last = '';
  for (let stops = 0; stops < 6; ) {
    const cites = extractCitations(text()).filter((c) => isValidCitation(c, files));
    if (i < cites.length) {
      const c = cites[i++];
      if (key(c) === last) continue;
      last = key(c);
      stops++;
      await pointLine(id, c);
      continue;
    }
    if (done()) break;
    await sleep(150);
  }
}

// ---------- chat answers ----------
/**
 * A chat turn on stage: the speaker goes to the line the user named the moment it is sent, then the answer streams
 * into its bubble while it hops to every line it cites.
 */
export async function answer(mod: string, msgId: string, focus: Citation | null) {
  const msg = () => T().chats[mod]?.find((m) => m.id === msgId);
  // On the Neighbourhood and the Blueprint: the answer streams into a bubble over its character.
  if (onMap()) {
    say(mod, { text: '', msg: { mod, id: msgId } });
    await until(() => !T().isLoading || msg()?.role === 'system', 60_000);
    useStage.setState((s) => (s.bubbles[mod]?.msg?.id === msgId ? { bubbles: { ...s.bubbles, [mod]: { ...s.bubbles[mod], until: Date.now() + 5000 } } } : {}));
    return;
  }
  if (!visible()) return;
  speaker(mod);
  busy(mod, true);
  say(mod, { text: '', msg: { mod, id: msgId }, avoid: focus });
  if (focus) await pointLine(mod, focus, { hold: 1.4 });
  // Somebody else's code: "Not mine." It points at the owner (who floats in if it isn't here), then the gesture.
  const owner = focus ? ownerOf(focus.path) : undefined;
  if (focus && owner && owner !== mod && walks()) {
    const here = S().members.some((m) => m.id === owner);
    if (!here) enter(owner, { k: 'home' }, true);
    await sleep(here ? 0 : 900);
    await outOfScope(aid(mod), aid(owner));
    if (!here) setTimeout(() => S().members.find((m) => m.id === owner)?.temp && leave(owner), 2500);
  }
  await tour(mod, () => msg()?.text ?? '', () => !T().isLoading || msg()?.role === 'system');
  busy(mod, false);
  useStage.setState((s) => (s.bubbles[mod]?.msg?.id === msgId ? { bubbles: { ...s.bubbles, [mod]: { ...s.bubbles[mod], until: Date.now() + 5000 } } } : {}));
  settle(mod, 6000);
}

// ---------- the click menu ----------
export async function gossip(id: string) {
  const t = T();
  const c = t.characters[id];
  const lines = c?.gossip?.filter(Boolean) ?? [];
  if (!lines.length) return;
  speaker(id);
  const line = lines[Math.floor(Math.random() * lines.length)];
  await sayBoth(id, line);
}

/** "Roast me": the character roasts itself (a chat turn), the neighbours on stage laugh; it holds a grudge after. */
export async function roastMe(id: string, send: (text: string, moduleId: string) => Promise<void>) {
  speaker(id);
  addGrudge(id, 'roasts');
  const laughing = onMap() ? companions(id).map((p) => p.id) : S().members.filter((m) => m.id !== id && m.kind === 'module').map((m) => m.id);
  void roastGag(aid(id), laughing.map(aid));
  await send('Roast yourself: your worst code, with the exact lines.', id);
}

/** "What if I change you?": the code panel selects the module's first declaration and opens its presets. */
export function whatIfMe(id: string) {
  const t = T();
  const mod = t.repo?.modules.find((m) => m.id === id);
  if (!mod || !t.repo) return;
  const entry = entryFile(mod);
  const path = entry && isCode(entry) ? entry : mod.stats.biggestFile.path;
  const file = t.repo.files.find((f) => f.path === path);
  if (!file) return;
  const lines = file.content.split('\n');
  const at = lines.findIndex((l) => /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|def)\b|^\s*export\s+(const|let)\s+\w+\s*=|^\s*(module\.)?exports\.\w+\s*=/.test(l));
  const line = at >= 0 ? at + 1 : 1;
  t.openFile(path);
  useStage.setState({ whatIfFor: { path, start: line, end: line, at: Date.now() }, menu: null });
}

// ---------- who needs you ----------
type Send = (text: string, moduleId: string) => Promise<void>;

/** Its dependents walk in and line up; each points at its import or call line; then the subject answers. */
export async function whoNeedsYou(id: string, send: Send) {
  const t = T();
  const g = t.graph;
  if (!t.repo || !g) return;
  const deps = dependentsOf(g, id).sort((a, b) => b.weight - a.weight).slice(0, 4);
  const refs = deps.map((e) => {
    const r = g.imports.find((x) => x.from === e.from && x.to === id && x.kind === e.kind)!;
    return { e, c: { path: r.file, startLine: r.line, endLine: r.kind === 'calls' ? r.line : r.endLine } };
  });
  t.selectModule(id);
  if (!visible()) return send('Who depends on you? Which other files import or use you?', id);
  useStage.setState({ scene: 'who' });
  speaker(id);
  setAnchor(id, { k: 'row', i: 0, n: deps.length + 1 });
  deps.forEach((e, i) => {
    const r = codeRect();
    enter(e.from, { k: 'at', x: (r?.right ?? innerWidth) + 80, y: (r?.bottom ?? innerHeight) - 6 }, true);
    setTimeout(() => setAnchor(e.from, { k: 'row', i: i + 1, n: deps.length + 1 }), 60 + i * 250);
  });
  await sleep(900 + deps.length * 250);
  for (const [i, { e, c }] of refs.entries()) {
    const line = needsLine({ id: e.from, name: nameOf(e.from), stats: t.repo.modules.find((m) => m.id === e.from)!.stats }, nameOf(id), { ...c, kind: e.kind }, e.weight, t.spice);
    busy(e.from, true);
    await Promise.all([pointLine(e.from, c, { hold: 1.2 }), sayBoth(e.from, line, { keep: 2500, avoid: c })]);
    busy(e.from, false);
    setAnchor(e.from, { k: 'row', i: i + 1, n: deps.length + 1 });
  }
  if (t.demo || !deps.length) {
    const text = needsSummary(nameOf(id), refs.map(({ e, c }) => ({ name: nameOf(e.from), weight: e.weight, kind: e.kind, ref: c })), t.spice);
    busy(id, true);
    await Promise.all([sayBoth(id, text), tour(id, () => text, () => true)]);
    busy(id, false);
  } else await send('Who depends on you? Which other files import or use you?', id);
  await sleep(3500);
  endScene();
}

/** A scene is over: its temporary members leave, everyone else goes home. */
export function endScene() {
  useStage.setState((s) => ({ scene: null, potato: null, road: null, members: s.members.filter((m) => !m.temp).map((m) => ({ ...m, anchor: { k: 'home' } })), arrows: {} }));
}

// ---------- arguments ----------
type Turn = { moduleId: string; text: string };
const saved = (demoArgue as { pairs: { a: string; b: string; turns: Turn[] }[] }).pairs;

/** Two modules argue about their real dependency (imports and calls between them), or find they never met. */
export async function argue(a: string, b: string) {
  const t = T();
  const g = t.graph;
  const ma = t.repo?.modules.find((m) => m.id === a), mb = t.repo?.modules.find((m) => m.id === b);
  if (!t.repo || !g || !ma || !mb || a === b) return;
  t.selectModule(a);
  useStage.setState({ scene: 'argue', menu: null, road: { a, b } });
  speaker(a);
  enter(b, anchorOf(b) ?? { k: 'home' }, true);
  setAnchor(a, { k: 'row', i: 0, n: 2 });
  setAnchor(b, { k: 'row', i: 1, n: 2 });
  const refs = g.imports.filter((r) => r.to && ((r.from === a && r.to === b) || (r.from === b && r.to === a)));
  const queue: Turn[] = [];
  let ended = false;
  if (!refs.length) {
    queue.push(...neverMet({ id: a, name: nameOf(a), stats: ma.stats }, { id: b, name: nameOf(b), stats: mb.stats }, t.spice));
    ended = true;
  } else if (t.demo) {
    const pair = saved.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
    queue.push(...(pair?.turns ?? [{ moduleId: a, text: aiOffLine(t.spice, a) }]));
    ended = true;
  } else void streamArgument(a, b, refs, (turn) => queue.push(turn)).finally(() => (ended = true));
  let last: Turn | null = null;
  // Waiting on the AI: both think until the first turn, then whoever speaks next (the cue never stacks).
  let waiting: (() => void) | null = null;
  const wait = (ids: string[]) => (waiting ??= think(ids));
  const stopWaiting = () => (waiting?.(), (waiting = null));
  for (let i = 0; ; ) {
    if (i < queue.length) {
      stopWaiting();
      const turn = queue[i++];
      last = turn;
      const other = turn.moduleId === a ? b : a;
      say(other, null);
      busy(turn.moduleId, true);
      const c = extractCitations(turn.text).find((x) => isValidCitation(x, t.repo!.files));
      await Promise.all([sayBoth(turn.moduleId, turn.text, { avoid: c }), c ? pointLine(turn.moduleId, c, { hold: 1 }) : Promise.resolve()]);
      busy(turn.moduleId, false);
      setAnchor(turn.moduleId, { k: 'row', i: turn.moduleId === a ? 0 : 1, n: 2 });
      await sleep(350);
      continue;
    }
    if (ended) break;
    wait(i ? [last?.moduleId === a ? b : a] : [a, b]);
    await sleep(150);
  }
  stopWaiting();
  if (!queue.length) {
    await typeOut(a, "We're not doing this right now. The AI is out, so there's nobody to write my comebacks.", { keep: 4000 });
  } else if (last) {
    // The last word ends with a bonk (unhinged and up); clean gets a long glare.
    const other = last.moduleId === a ? b : a;
    await sleep(400);
    if (t.spice === 'clean') await actor(last.moduleId)?.play('glare', { priority: 2 });
    else await bonk(aid(last.moduleId), aid(other));
  }
  await sleep(2500);
  endScene();
}

async function streamArgument(a: string, b: string, refs: { file: string; line: number; endLine: number; from: string; to?: string; kind: string }[], push: (t: Turn) => void) {
  const t = T();
  // The lines that connect them, and each side's own main file, so both can point at their own evidence.
  const main = (id: string) => t.repo!.modules.find((m) => m.id === id)?.stats.biggestFile.path;
  const paths = [...new Set([...refs.map((r) => r.file), main(a), main(b)])].filter((p): p is string => !!p).slice(0, 4);
  const character = (id: string) => ({ id, title: nameOf(id), personality: t.characters[id]?.personality ?? '' });
  const res = await fetch('/api/argue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoName: t.repo!.name,
      spice: t.spice,
      mode: t.mode,
      a: character(a),
      b: character(b),
      refs: refs.slice(0, 12).map((r) => ({ from: r.from, to: r.to, kind: r.kind, file: r.file, line: r.line, endLine: r.endLine })),
      files: paths.map((p) => ({ path: p, content: t.repo!.files.find((f) => f.path === p)?.content.slice(0, 16_000) ?? '' })),
    }),
  }).catch(() => null);
  if (!res?.ok || !res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.type === 'turn') push(e.turn);
    }
  }
}

// ---------- dropped and flung ----------
const clicks = new Map<string, number[]>();
/** A click (or a landing after a fling) counts towards pestering: 3 in 5 seconds and it holds a grudge. */
export function poke(id: string) {
  clickActor(aid(id));
  const now = Date.now();
  const list = (clicks.get(id) ?? []).filter((x) => now - x < 5000);
  list.push(now);
  clicks.set(id, list);
  if (list.length >= 3) {
    clicks.set(id, []);
    addGrudge(id, 'pesters');
  }
}

export async function landed(id: string, x: number, y: number) {
  const t = T();
  const mod = t.repo?.modules.find((m) => m.id === id);
  setAnchor(id, { k: 'at', x, y });
  poke(id);
  if (mod) {
    void actor(id)?.play('groan', { priority: 2 });
    await typeOut(id, flingLine({ id, name: nameOf(id), stats: mod.stats }, t.spice, String(Date.now())), { keep: 3500 });
  }
  setTimeout(() => anchorOf(id)?.k === 'at' && setAnchor(id, { k: 'home' }), 2500);
}

// ---------- the Tribunal over the code panel ----------
let before: Member[] | null = null;
export function courtOpen(suspects: string[]) {
  if (!visible()) return;
  before ??= S().members;
  const four = suspects.length > 3;
  useStage.setState({
    scene: 'tribunal',
    dim: true,
    bubbles: {},
    arrows: {},
    members: [
      { id: 'judge', kind: 'judge', anchor: { k: 'judge' }, temp: true },
      ...suspects.map((id, i): Member => ({ id, kind: 'module', anchor: { k: 'court', i, n: suspects.length }, temp: true })),
      ...(four ? [] : [{ id: 'landlord', kind: 'landlord' as const, anchor: { k: 'gallery' as const }, temp: true }]),
    ],
  });
  for (const id of ['judge', 'landlord', ...suspects]) actor(id)?.reset();
}
const home = (id: string) => {
  const m = S().members.find((x) => x.id === id);
  return m?.anchor.k === 'line' ? null : m?.anchor;
};
const seat = new Map<string, Anchor>();
/** A turn starts: an accusation bonks first (accuser to accused), then the speaker walks to its evidence and points. */
export async function courtTurn(turn: { moduleId: string; text: string; accuses?: string }) {
  if (S().scene !== 'tribunal') return;
  const id = turn.moduleId;
  // The turn is in full in the Tribunal's transcript: the bubble types its quip out alongside.
  said.set(id, { q: quip(turn.text, T().spice) });
  useStage.setState((s) => ({ bubbles: { [id]: { text: '', link: 'tribunal-end' } }, busy: { ...s.busy, [id]: true } }));
  const a = home(id);
  if (a) seat.set(id, a);
  if (turn.accuses && walks()) await bonk(actorOf(id), actorOf(turn.accuses));
  const c = extractCitations(turn.text).find((x) => isValidCitation(x, T().repo?.files ?? []));
  if (c) await pointLine(id, c, { hold: 1.4 });
}
const said = new Map<string, { q: string }>();
export const courtSay = (id: string, typed: string) => {
  const w = said.get(id);
  const text = w ? w.q.slice(0, typed.length) : typed; // typed at the panel's pace, so the short quip is up at once
  if (S().scene === 'tribunal') useStage.setState((s) => ({ bubbles: { ...s.bubbles, [id]: { ...s.bubbles[id], text } } }));
};
export function courtTurnEnd(id: string) {
  if (S().scene !== 'tribunal') return;
  useStage.setState((s) => (s.bubbles[id] ? { bubbles: { ...s.bubbles, [id]: { ...s.bubbles[id], until: Date.now() + 5000 } } } : {}));
  busy(id, false);
  setAnchor(id, seat.get(id) ?? { k: 'home' });
  useStage.setState({ arrows: {} });
}
/** The verdict as built: the Judge performs it while everyone's mood waits, then culprits look guilty. */
export async function courtVerdict(culprits: string[], suspects: string[]) {
  if (S().scene !== 'tribunal') return;
  useStage.setState({ holdMoods: true, bubbles: {} });
  for (const s of suspects) actor(s)?.setMood('idle');
  const innocents = suspects.filter((s) => !culprits.includes(s));
  await judgeVerdict(actorOf('judge'), culprits.map(actorOf), innocents.map(actorOf));
  useStage.setState({ holdMoods: false });
}
export function courtClose() {
  if (S().scene !== 'tribunal' && !before) return;
  for (const id of ['judge', 'landlord', ...S().members.map((m) => m.id)]) actor(id)?.reset();
  useStage.setState({ scene: null, dim: false, bubbles: {}, arrows: {}, holdMoods: false, members: (before ?? []).map((m) => ({ ...m, anchor: { k: 'home' } })) });
  before = null;
  seat.clear();
}

// ---------- What-if: the hot potato ----------
/** The change glows and is passed along the ripple order; `hop` ms per pass. Up to five on stage. */
export function potato(order: string[], hop: number) {
  if (!visible()) return false;
  const path = order.slice(0, SCENE);
  useStage.setState((s) => ({
    scene: 'potato',
    members: [...path.map((id, i): Member => ({ id, kind: 'module', anchor: { k: 'row', i, n: path.length }, temp: !s.members.some((m) => m.id === id) })), ...s.members.filter((m) => !path.includes(m.id)).slice(0, Math.max(0, SCENE - path.length))],
    potato: { path, t0: Date.now() + 700, hop },
  }));
  return true;
}
export const potatoEnd = () => S().scene === 'potato' && endScene();

// ---------- reactions to the user (no AI) ----------
const ownerOf = (path: string) => T().repo?.modules.find((m) => m.filePaths.includes(path))?.id;
const cooled = new Map<string, number>();
const cool = (k: string, ms: number) => {
  if ((cooled.get(k) ?? 0) > Date.now()) return false;
  cooled.set(k, Date.now() + ms);
  return true;
};
const free = () => visible() && !S().scene && !S().menu;

/** Selecting code: its owner peeks over the selection for a moment. */
export function peek(path: string, start: number, end: number) {
  const id = ownerOf(path);
  if (!id || !free() || isBusy(id) || !walks() || !cool('peek', 4000)) return;
  const lb = lineBox(start), le = lineBox(end);
  if (!lb || !le) return;
  const was = anchorOf(id);
  const size = sizeOf(id, true);
  enter(id, { k: 'at', x: Math.min(lb.right - size.w / 2 - 12, lb.codeLeft + 320), y: lb.top + 4 }, !was);
  const a = actor(id);
  setTimeout(() => {
    a?.lookAt({ client: [lb.codeLeft + 60, (lb.mid + le.mid) / 2] }, 2.5);
    void a?.play('hop', { priority: 1 });
  }, 500);
  setTimeout(() => (was ? setAnchor(id, was) : anchorOf(id)?.k === 'at' && leave(id)), 3600);
}

/** Opening a file over 400 lines: its owner groans (a fart cloud at unhinged and up; the gag has its own cooldown). */
export function bigFile(path: string, lineCount: number) {
  const id = ownerOf(path);
  if (!id || lineCount <= 400 || !free() || isBusy(id) || !cool(`big:${path}`, 20_000)) return;
  if (!S().members.some((m) => m.id === id)) enter(id, { k: 'home' }, true);
  setTimeout(() => void actor(id)?.play(T().spice === 'clean' ? 'groan' : 'fart', { priority: 1 }), 700);
}

const scrolls: { top: number; t: number }[] = [];
/** Scrolling fast (more than 1500px within a second): whoever owns the file (or the speaker) gets dizzy. */
export function scrolled(path: string | null, top: number) {
  const now = performance.now();
  scrolls.push({ top, t: now });
  while (scrolls.length && now - scrolls[0].t > 1000) scrolls.shift();
  const travelled = scrolls.reduce((d, s, i) => (i ? d + Math.abs(s.top - scrolls[i - 1].top) : 0), 0);
  if (travelled < 1500 || !free()) return;
  scrolls.length = 0;
  const id = (path && ownerOf(path) && S().members.some((m) => m.id === ownerOf(path)) ? ownerOf(path) : S().speaker) ?? null;
  if (id && !isBusy(id) && cool('dizzy', 8000)) void actor(id)?.play('dizzy', { priority: 1 });
}

/** Hovering an import line: the imported module pops in at the screen edge and waves. */
export function hoverLine(path: string, line: number, y: number) {
  const g = T().graph;
  const r = g?.imports.find((x) => x.file === path && x.to && line >= x.line && line <= x.endLine && x.kind === 'imports');
  if (!r?.to || !free() || isBusy(r.to) || !cool(`wave:${r.to}`, 8000) || !cool('wave', 1500)) return;
  const to = r.to;
  // Already on stage: it waves from where it stands.
  if (S().members.some((m) => m.id === to)) return void actor(to)?.play('wave', { priority: 1 });
  enter(to, { k: 'edge', y: y + 40 }, true);
  setTimeout(() => void actor(to)?.play('wave', { priority: 1 }), 500);
  setTimeout(() => S().members.find((m) => m.id === to)?.temp && anchorOf(to)?.k === 'edge' && leave(to), 3000);
}

/** A minute without input: one idle character does its bored gag. */
export function bored() {
  if (!free()) return;
  const ids = S().members.filter((m) => !isBusy(m.id)).map((m) => actorOf(m.id));
  if (ids.length) void boredGag(ids);
}

/** Undo in What-if: everyone on stage groans. */
export const undo = () => visible() && void undoGag(S().members.map((m) => actorOf(m.id)));
/** A complete fix in What-if: everyone on stage celebrates, deadpan, under confetti. */
export const completeFix = () => visible() && void fixGag(S().members.map((m) => actorOf(m.id)));

/** Sulking while it holds a grudge (roasted or pestered in the last 10 minutes): a sulky idle pose. */
export function sulk() {
  for (const m of S().members) {
    if (m.kind !== 'module') continue;
    const g = grudgeOf(m.id);
    const a = actor(m.id);
    if (!a) continue;
    // The sulky face stays on while it holds the grudge, talking included; the pose only when it's idle.
    const on = !!(g.roasted || g.pestered);
    if (a.sulky !== on) {
      a.sulky = on;
      if ((T().moods[m.id] ?? 'idle') === 'idle' || T().moods[m.id] === 'talking') a.setExpression(on ? 'sulky' : 'deadpan');
    }
    if (on && !isBusy(m.id) && !a.cur && !a.holds.length && (T().moods[m.id] ?? 'idle') === 'idle') void a.play('sulk', { priority: 0 });
  }
}

// ---------- the thinking pose ----------
const PREFIXES = ['stage', 'map', 'bp', 'trib', 'chat', 'tour'];
const posing = new Set<string>();
/** Every few hundred ms: whoever is waiting on the AI holds the thinking pose (once it's free), in every cast it's in. */
export function thinkPoses() {
  const waiting = S().thinking;
  const want = reducedMotion() ? [] : Object.keys(waiting).flatMap((id) => PREFIXES.map((p) => `${p}:${id}`));
  for (const key of posing)
    if (!want.includes(key)) {
      getActor(key)?.stopLoop('think');
      posing.delete(key);
    }
  for (const key of want) {
    const a = getActor(key);
    // Not over another clip, a float or a point; the stage's floats take the loop while it travels.
    if (!a || a.cur || a.pointer || (a.loop && a.loop.name !== 'think')) continue;
    if (a.loop?.name !== 'think') void a.play('think', { priority: 0 });
    posing.add(key);
  }
}

/** Positions for drop targets: which member box contains a point (not `self`). */
export function memberAt(x: number, y: number, self: string): string | null {
  for (const m of S().members) {
    const p = placed.get(m.id);
    if (m.id !== self && p && Math.abs(x - p.x) < p.w / 2 + 6 && y < p.y + 6 && y > p.y - p.h - 6) return m.id;
  }
  return null;
}
