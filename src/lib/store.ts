import { create } from 'zustand';
import type { Character, ChatMessage, Citation, ExplainMode, Mood, Repo, RepoFile, SpiceLevel } from './types';
import type { RoastCard } from './roast';
import { buildRepo, entryFile, nesting, parseGitHubUrl } from './analyze';
import { affectedBy, buildGraph, dependenciesOf, dependentsOf, type Graph } from './graph';
import { buildingFacts, tourOrder } from './landlord';
import { fallbackCharacter, personaBatches, toCharacters, toRaw, type RawCharacter } from './characters';
import { idbGet, idbSet } from './idb';
import type { Module } from './types';
import demoCharacters from '@/data/demoCharacters.json';
import { useStage } from '@/components/stage/store';

/** One hop of a ripple: `up` travels from `via` to a module that imports or calls it, `down` from `via` to a module it calls. */
export type RippleStep = { id: string; hops: number; via: string; dir: 'up' | 'down' };
export type Landlord = { intro: string; outro: string };
/** A generated roast: the card at the active spice level and clean, and their signed share payloads. */
export type RoastResult = { cards: { spicy: RoastCard; clean: RoastCard }; links: { spicy: string; clean: string } | null; source: string; verified?: boolean };
export type WhatIfChange =
  | { kind: 'diff'; diff: string; title: string; path?: string }
  | { kind: 'describe'; description: string; title: string; path: string; startLine: number; endLine: number };

type TavernState = {
  repo: Repo | null;
  graph: Graph | null; // import graph, rebuilt on every loadRepo
  characters: Record<string, Character>;
  moods: Record<string, Mood>;
  selectedModuleId: string | null;
  openFilePath: string | null;
  highlight: Citation | null;
  chats: Record<string, ChatMessage[]>;
  spice: SpiceLevel;
  mode: ExplainMode;
  muted: boolean;
  isLoading: boolean;
  tribunal: boolean;
  demo: boolean; // /tavern?demo=1: saved quickcart, saved cast, saved Tribunal, zero AI calls for those
  // Code-smell reaction for the module whose file was just opened (not in clean).
  smell: { moduleId: string; cloud: boolean; green: boolean; at: number } | null;
  view: 'code' | 'map' | 'diagram' | 'diff'; // middle panel
  tourOn: boolean; // the Landlord's guided tour, in the Blueprint tab
  landlord: Landlord | null; // the Landlord's intro and outro for this repo (model-written; null = templates)
  landlordSays: string | null; // the What-if closing beat
  roastOpen: boolean;
  roasts: Record<string, RoastResult>; // per repo, for this session
  rippleFrom: { ids: string[]; at: number; steps?: RippleStep[]; label?: string } | null; // set while a ripple plays on the map
  whatIf: { id: number; change: WhatIfChange } | null; // right panel in What-if mode
  whatIfDiff: { path: string; before: string; after: string }[] | null; // the previewed change, for the diff view
  bubbles: Record<string, string>; // speech bubbles over map nodes
  /** The loading show while a repo downloads: the real steps so far, then the tenants once modules are known. */
  ingest: { slug: string; steps: string[]; tenants: Module[] | null } | null;
  /** 'pending' while AI personas are still coming in (the cast shows template placeholders until then). */
  personas: 'pending' | 'done';
  arrivals: Record<string, number>; // when each module's AI persona replaced its placeholder (the settling-in animation)

  loadRepo: (repo: Repo) => void;
  setCharacters: (characters: Character[]) => void;
  /** AI personas arriving for some modules: replaces their placeholders, an untouched greeting included. */
  mergeCharacters: (characters: Character[]) => void;
  /**
   * A character's gossip, written when asked (the click menu): cached lines for this repo@commit, spice and mode, else
   * /api/gossip (3 variants, filter, comedy editor). Fills characters[id].gossip and returns it; on failure, the
   * template lines it already has. ?demo=1: the saved gossip, no call.
   */
  getGossip: (moduleId: string) => Promise<string[]>;
  selectModule: (moduleId: string | null) => void;
  openFile: (path: string) => void;
  highlightCitation: (c: Citation) => void;
  addMessage: (moduleId: string, msg: ChatMessage) => void;
  appendToMessage: (moduleId: string, messageId: string, chunk: string) => void;
  updateMessage: (moduleId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  setMood: (moduleId: string, mood: Mood) => void;
  setSpice: (spice: SpiceLevel) => void;
  setMode: (mode: ExplainMode) => void;
  toggleMute: () => void;
  setLoading: (isLoading: boolean) => void;
  setTribunal: (on: boolean) => void;
  setView: (view: 'code' | 'map' | 'diagram' | 'diff') => void;
  startTour: () => void;
  endTour: () => void; // remembers, per repo, that the tour was seen
  setLandlord: (l: Landlord | null) => void;
  setLandlordSays: (text: string | null) => void;
  setRoastOpen: (open: boolean) => void;
  setRoast: (repoKey: string, r: RoastResult) => void;
  /**
   * Pulse from module(s) hop by hop on the map (switches to it): by default to everything that imports or calls
   * them; what-if passes explicit steps, including `down` hops to modules whose call sites changed.
   */
  ripple: (from: string | string[], opts?: { steps?: RippleStep[]; label?: string }) => void;
  openWhatIf: (change: WhatIfChange) => void;
  closeWhatIf: () => void;
  setWhatIfDiff: (d: TavernState['whatIfDiff']) => void;
  setBubble: (moduleId: string, text: string | null) => void;
};

export const useTavern = create<TavernState>()((set, get) => {
  // First visit to a module: its greeting becomes the first message, face talks for ~2s. No API call.
  const greet = (id: string | null) => {
    const s = get();
    const c = id ? s.characters[id] : undefined;
    if (!id || !c || s.chats[id]?.length) return;
    s.addMessage(id, { id: crypto.randomUUID(), role: 'character', characterId: id, text: c.greeting, citations: [] });
    s.setMood(id, 'talking');
    setTimeout(() => get().moods[id] === 'talking' && get().setMood(id, 'idle'), 2000);
  };

  return {
    repo: null,
    graph: null,
    characters: {},
    moods: {},
    selectedModuleId: null,
    openFilePath: null,
    highlight: null,
    chats: {},
    spice: 'unhinged',
    mode: 'beginner',
    muted: false,
    isLoading: false,
    tribunal: false,
    demo: false,
    smell: null,
    view: 'code',
    tourOn: false,
    landlord: null,
    landlordSays: null,
    roastOpen: false,
    roasts: {},
    rippleFrom: null,
    whatIf: null,
    whatIfDiff: null,
    bubbles: {},
    ingest: null,
    personas: 'done',
    arrivals: {},

    // Modules come sorted by size, so [0] is the largest; open its most important file.
    loadRepo: (repo) =>
      set({
        repo,
        graph: buildGraph(repo.files, repo.modules),
        rippleFrom: null,
        whatIf: null,
        whatIfDiff: null,
        bubbles: {},
        view: 'code',
        tourOn: false,
        landlord: null,
        landlordSays: null,
        roastOpen: false,
        characters: {},
        moods: {},
        chats: {},
        arrivals: {},
        selectedModuleId: repo.modules[0]?.id ?? null,
        highlight: null,
        tribunal: false,
        demo: false,
        openFilePath: (repo.modules[0] && entryFile(repo.modules[0])) ?? repo.files[0]?.path ?? null,
      }),
    setCharacters: (list) => {
      set({ characters: Object.fromEntries(list.map((c) => [c.moduleId, c])) });
      // First visit to this repo: open the Blueprint tab on the Landlord's tour (the chat greeting waits).
      if (!tourSeen(get().repo)) return set({ tourOn: true, view: 'diagram' });
      greet(get().selectedModuleId);
    },
    mergeCharacters: (list) => {
      const now = Date.now();
      set((s) => {
        const characters = { ...s.characters };
        const chats = { ...s.chats };
        const arrivals = { ...s.arrivals };
        for (const c of list) {
          const old = characters[c.moduleId];
          const thread = chats[c.moduleId];
          // Nobody answered the placeholder's greeting yet: the new character says its own.
          if (old && thread?.length === 1 && thread[0].role === 'character' && thread[0].text === old.greeting) chats[c.moduleId] = [{ ...thread[0], text: c.greeting }];
          // Gossip someone already asked for outlives the persona swap (personas come without it).
          const asked = gossipLines.get(gossipKey(get(), c.moduleId));
          characters[c.moduleId] = asked ? { ...c, gossip: asked } : c;
          arrivals[c.moduleId] = now;
        }
        return { characters, chats, arrivals };
      });
      // Settling in: a brief happy beat on every face, 2D or 3D, unless it's busy with something else (talking, or on
      // stage pointing at a line or in a scene).
      for (const c of list) {
        const id = c.moduleId;
        if ((get().moods[id] ?? 'idle') !== 'idle' || useStage.getState().busy[id]) continue;
        get().setMood(id, 'happy');
        setTimeout(() => get().moods[id] === 'happy' && get().setMood(id, 'idle'), 1400);
      }
    },
    selectModule: (selectedModuleId) => {
      set({ selectedModuleId });
      greet(selectedModuleId);
    },
    openFile: (openFilePath) => {
      const s = get();
      const f = s.repo?.files.find((x) => x.path === openFilePath);
      const mod = s.repo?.modules.find((m) => m.filePaths.includes(openFilePath));
      const cloud = !!f && f.lineCount > 400;
      const green = !!f && nesting(f) >= 6;
      const smelly = s.spice !== 'clean' && mod && (cloud || green);
      set({ openFilePath, view: 'code', smell: smelly ? { moduleId: mod.id, cloud, green, at: Date.now() } : null });
    },
    // New object every call, so clicking the same chip twice re-triggers the glow.
    highlightCitation: (c) => set({ openFilePath: c.path, highlight: { ...c } }),
    addMessage: (moduleId, msg) =>
      set((s) => ({ chats: { ...s.chats, [moduleId]: [...(s.chats[moduleId] ?? []), msg] } })),
    appendToMessage: (moduleId, messageId, chunk) =>
      set((s) => ({
        chats: {
          ...s.chats,
          [moduleId]: (s.chats[moduleId] ?? []).map((m) => (m.id === messageId ? { ...m, text: m.text + chunk } : m)),
        },
      })),
    updateMessage: (moduleId, messageId, patch) =>
      set((s) => ({
        chats: { ...s.chats, [moduleId]: (s.chats[moduleId] ?? []).map((m) => (m.id === messageId ? { ...m, ...patch } : m)) },
      })),
    setMood: (moduleId, mood) => set((s) => ({ moods: { ...s.moods, [moduleId]: mood } })),
    setSpice: (spice) => set({ spice }),
    setMode: (mode) => set({ mode }),
    toggleMute: () => set((s) => ({ muted: !s.muted })),
    setLoading: (isLoading) => set({ isLoading }),
    setTribunal: (tribunal) => set(tribunal ? { tribunal, whatIf: null } : { tribunal }),
    setView: (view) => set({ view }),
    startTour: () => set({ tourOn: true, view: 'diagram' }),
    endTour: () => {
      rememberTour(get().repo);
      set({ tourOn: false });
      greet(get().selectedModuleId);
    },
    setLandlord: (landlord) => set({ landlord }),
    setLandlordSays: (landlordSays) => set({ landlordSays }),
    setRoastOpen: (roastOpen) => set({ roastOpen }),
    setRoast: (key, r) => set((s) => ({ roasts: { ...s.roasts, [key]: r } })),
    ripple: (from, opts = {}) => {
      const at = Date.now();
      const ids = [from].flat();
      const g = get().graph;
      const steps = opts.steps ?? (g ? ids.flatMap((id) => affectedBy(g, id).map((a) => ({ ...a, dir: 'up' as const }))) : []);
      const hops = Math.max(0, ...steps.map((s) => s.hops));
      set({ view: 'map', rippleFrom: { ids, at, steps, label: opts.label } });
      setTimeout(() => get().rippleFrom?.at === at && set({ rippleFrom: null }), RIPPLE_HOP_MS * hops + 3000);
    },
    openWhatIf: (change) => set({ whatIf: { id: Date.now(), change }, tribunal: false, whatIfDiff: null, bubbles: {} }),
    closeWhatIf: () => set((s) => ({ whatIf: null, whatIfDiff: null, bubbles: {}, rippleFrom: null, landlordSays: null, view: s.view === 'diff' ? 'code' : s.view })),
    setWhatIfDiff: (whatIfDiff) => set({ whatIfDiff }),
    getGossip: async (id) => {
      const s = get();
      const have = s.characters[id]?.gossip ?? [];
      if (!s.repo || !s.characters[id] || s.demo) return have; // the demo's saved gossip: zero AI calls
      const key = gossipKey(s, id);
      const keep = (lines: string[]) => {
        const now = get();
        if (now.repo !== s.repo || !now.characters[id] || !lines.length) return now.characters[id]?.gossip ?? have;
        gossipLines.set(key, lines);
        set({ characters: { ...now.characters, [id]: { ...now.characters[id], gossip: lines } } });
        return lines;
      };
      const ready = gossipLines.get(key);
      if (ready) return keep(ready);
      let p: Promise<string[]> | undefined = gossipAsks.get(key);
      if (!p) {
        const repo = s.repo;
        p = (async (): Promise<string[]> => {
          const saved = repo.key ? await idbGet<string[]>(`gossip:${key}`) : undefined;
          if (saved?.length) return keep(saved);
          const lines = await fetchGossip(repo, id);
          if (!lines) return get().characters[id]?.gossip ?? have; // templates stay, and it can ask again
          if (repo.key) void idbSet(repo.key.split('@')[0], `gossip:${key}`, lines);
          return keep(lines);
        })().finally(() => gossipAsks.delete(key));
        gossipAsks.set(key, p);
      }
      return p;
    },
    setBubble: (id, text) =>
      set((s) => {
        const bubbles = { ...s.bubbles };
        if (text) bubbles[id] = text;
        else delete bubbles[id];
        return { bubbles };
      }),
  };
});

export const RIPPLE_HOP_MS = 400;

// Gossip written on request, per repo@commit, module, spice and mode (getGossip), and the requests in flight.
const gossipLines = new Map<string, string[]>();
const gossipAsks = new Map<string, Promise<string[]>>();
const gossipKey = (s: Pick<TavernState, 'repo' | 'spice' | 'mode'>, id: string) => `${s.repo?.key ?? s.repo?.name ?? ''}|${id}|${s.spice}|${s.mode}`;

// Tour memory per repo. localStorage can be missing or throw (private mode, blocked storage): then it just replays.
const tourKey = (repo: Repo | null) => `tavern:tour:${repo?.url ?? repo?.name ?? ''}`;
function tourSeen(repo: Repo | null): boolean {
  try {
    return localStorage.getItem(tourKey(repo)) === '1';
  } catch {
    return false;
  }
}
export function rememberTour(repo: Repo | null) {
  try {
    localStorage.setItem(tourKey(repo), '1');
  } catch {
    // nothing to remember with
  }
}

type IngestPayload = { name: string; url: string; branch: string; sha?: string; key?: string; files: RepoFile[]; skipped: Repo['skipped'] };
type Event = { type: 'step'; step: string } | { type: 'repo'; repo: IngestPayload } | { type: 'same'; key: string } | { type: 'error'; error: string };

const CONNECTION = "Couldn't reach the server. Check your connection and try again.";
const WALK_IN_MS = 1200; // the tenants walking in, after the download and before the tavern opens
const mark = (name: string) => {
  try {
    performance.mark(name);
  } catch {
    // marks are for measuring only
  }
};

async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<Event> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    buf += dec.decode(value, { stream: !done });
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) yield JSON.parse(line) as Event;
    }
    if (done) return;
  }
}

class Refused extends Error {} // GitHub or the server said no, in character: not worth falling back to a cached copy

const inflight = new Map<string, Promise<Repo>>();

/**
 * Fetch a GitHub repo via /api/ingest (streamed progress for the loading show), analyse it here, then open the
 * tavern at once with template placeholders while the AI personas stream in. A repeat visit in this browser uses
 * the IndexedDB copy if the repo's commit hasn't changed. Throws Error(in-character message).
 */
export function summonRepo(input: string): Promise<Repo> {
  // Dedupe concurrent calls (React StrictMode runs effects twice in dev).
  let p = inflight.get(input);
  if (!p) {
    p = (async () => {
      const slug = parseGitHubUrl(input)?.slug ?? input;
      mark('tavern:summon');
      useTavern.setState({ ingest: { slug, steps: [], tenants: null } });
      const step = (t: string) => useTavern.setState((s) => (s.ingest ? { ingest: { ...s.ingest, steps: [...s.ingest.steps, t] } } : {}));
      const cached = await idbGet<{ key: string; payload: IngestPayload }>(`repo:${slug}`);
      let data: IngestPayload | null = null;
      try {
        const res = await fetch('/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: input, known: cached?.key }) });
        if (!res.ok || !res.body) throw new Refused((await res.json().catch(() => null))?.error ?? CONNECTION);
        for await (const e of events(res.body)) {
          if (e.type === 'step') step(e.step);
          else if (e.type === 'repo') data = e.repo;
          else if (e.type === 'same' && cached) {
            step('Same building as your last visit');
            data = cached.payload;
          } else if (e.type === 'error') throw new Refused(e.error);
        }
      } catch (err) {
        if (err instanceof Refused || !cached) throw new Error(err instanceof Refused ? err.message : CONNECTION);
        step("Can't reach GitHub. Using your last visit");
        data = cached.payload;
      }
      if (!data?.files) throw new Error(CONNECTION);
      if (data.key && data !== cached?.payload) void idbSet(slug, `repo:${slug}`, { key: data.key, payload: data });
      mark('tavern:downloaded');
      const repo: Repo = { ...buildRepo(data.name, data.files, data.url), branch: data.branch, skipped: data.skipped, key: data.key };
      useTavern.setState((s) => ({ ingest: s.ingest && { ...s.ingest, tenants: repo.modules, steps: [...s.ingest.steps, `Found ${repo.modules.length} ${repo.modules.length === 1 ? 'tenant' : 'tenants'}`] } }));
      await new Promise((r) => setTimeout(r, reduced() ? 300 : WALK_IN_MS));
      loadInstant(repo);
      return repo;
    })().finally(() => {
      inflight.delete(input);
      useTavern.setState({ ingest: null });
    });
    inflight.set(input, p);
  }
  return p;
}
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const savedLandlord = (demoCharacters as { landlord?: Landlord }).landlord ?? null;

/** What every /api/characters batch sends: each module with its key files and links, plus the repo-wide facts. */
function personaRequest(repo: Repo) {
  const byPath = new Map(repo.files.map((f) => [f.path, f.content]));
  const modules = repo.modules.map((m) => ({
    ...m,
    filePaths: m.filePaths.slice(0, 20),
    keyFiles: [...new Set([entryFile(m), m.stats.biggestFile.path])]
      .filter((p): p is string => !!p && byPath.has(p))
      .slice(0, 2)
      .map((p) => ({ path: p, head: byPath.get(p)!.split('\n', 24).join('\n') })),
  }));
  // Graph facts for the Landlord's lines: who leans on whom (imports and calls), the tour order, the notable modules.
  const g = buildGraph(repo.files, repo.modules);
  const facts = buildingFacts(g, repo.modules);
  const nameOf = (id: string) => repo.modules.find((m) => m.id === id)?.name ?? id;
  const link = (e: { from: string; to: string; weight: number; kind: string }, id: string) => `${nameOf(id)} (${e.kind === 'calls' ? 'over the network' : `${e.weight} imports`})`;
  const building = {
    files: repo.files.length,
    modules: repo.modules.length,
    todos: repo.modules.reduce((s, m) => s + m.stats.todoCount, 0),
    tourOrder: tourOrder(g, repo.modules).order.map(nameOf),
    mostDependedOn: facts.hub && `${nameOf(facts.hub.id)}: ${facts.hub.n} other modules depend on it`,
    nobodyUses: facts.orphans.map(nameOf),
    dependencyLoops: facts.cycles.map((c) => c.map(nameOf).join(' <-> ')),
    needsTheMost: facts.needy && `${nameOf(facts.needy.id)}: depends on ${facts.needy.n} other modules (it leans on them, not the reverse)`,
  };
  const withLinks = modules.map((m) => ({
    ...m,
    testFiles: m.filePaths.filter((p) => /(^|\/)(__tests__|tests?|spec)\/|[._-](test|spec)\.[a-z]+$/i.test(p)).length,
    links: {
      usedBy: dependentsOf(g, m.id).map((e) => link(e, e.from)),
      uses: dependenciesOf(g, m.id).map((e) => link(e, e.to)),
    },
  }));
  const s = useTavern.getState();
  return { repoName: repo.name, modules: withLinks, building, spice: s.spice, mode: s.mode };
}

/**
 * The AI personas, in parallel batches of 2-3 modules (one also writes the Landlord's intro and outro). Each
 * batch replaces its placeholders the moment it lands; a failed batch keeps them (on the demo repo, the saved
 * cast instead). Cached in IndexedDB per commit, spice and mode. Never throws.
 */
async function streamPersonas(repo: Repo) {
  const s0 = useTavern.getState();
  const alive = () => useTavern.getState().repo === repo;
  const arrive = (raw: RawCharacter[]) => {
    const ids = new Set(raw.map((r) => r.moduleId));
    if (alive() && ids.size) useTavern.getState().mergeCharacters(toCharacters(repo.modules, toRaw(repo.modules, raw).filter((c) => ids.has(c.moduleId))));
  };
  const finish = () => {
    if (!alive()) return;
    mark('tavern:personas');
    useTavern.setState({ personas: 'done' });
  };
  const cacheKey = repo.key && `personas:${repo.key}|${s0.spice}|${s0.mode}`;
  const hit = cacheKey ? await idbGet<{ characters: RawCharacter[]; landlord: Landlord | null }>(cacheKey) : undefined;
  if (hit?.characters?.length) {
    arrive(hit.characters);
    if (alive() && hit.landlord) useTavern.getState().setLandlord(hit.landlord);
    return finish();
  }
  const isDemo = !!repo.url?.includes('/quickcart');
  const body = personaRequest(repo);
  const got: RawCharacter[] = [];
  let landlord: Landlord | null = null;
  let allLive = true;
  await Promise.all(
    personaBatches(repo.modules.map((m) => m.id)).map(async (ids, i) => {
      let raw: RawCharacter[] = [];
      let live = false;
      // The first batch warms OpenAI's prompt cache; the rest follow 0.7s later and pay the cached rate for the shared prompt.
      if (i) await new Promise((r) => setTimeout(r, 700));
      try {
        const res = await fetch('/api/characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, write: ids, landlord: i === 0 }),
          signal: AbortSignal.timeout(40_000),
        });
        const data = await res.json();
        raw = (data.characters ?? []).filter((c: RawCharacter) => ids.includes(c?.moduleId));
        live = data.source === 'llm';
        if (i === 0 && data.landlord?.intro && data.landlord?.outro) landlord = { intro: String(data.landlord.intro), outro: String(data.landlord.outro) };
      } catch {
        // network/timeout: the placeholders stay
      }
      // Demo safety: on the demo repo, a failed batch uses the saved cast instead of the stat templates.
      if (!live && isDemo) {
        raw = (demoCharacters.characters as RawCharacter[]).filter((c) => ids.includes(c.moduleId));
        if (i === 0) landlord = savedLandlord;
      }
      allLive &&= live;
      got.push(...raw);
      if (live || isDemo) arrive(raw);
      if (i === 0 && landlord && alive()) useTavern.getState().setLandlord(landlord);
    }),
  );
  finish();
  if (allLive && cacheKey) void idbSet(repo.key!.split('@')[0], cacheKey, { characters: got, landlord });
}

/** One character's gossip from /api/gossip; null when the server fell back to templates or couldn't be reached. */
async function fetchGossip(repo: Repo, id: string): Promise<string[] | null> {
  const req = personaRequest(repo);
  const res = await fetch('/api/gossip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoName: req.repoName, module: req.modules.find((m) => m.id === id), others: req.modules.filter((m) => m.id !== id), spice: req.spice, mode: req.mode }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  const data: { lines?: unknown; source?: string } | null = await res?.json().catch(() => null);
  const lines = Array.isArray(data?.lines) ? data.lines.filter((l): l is string => typeof l === 'string' && !!l.trim()) : [];
  return data?.source === 'llm' && lines.length ? lines : null;
}

/** Opens the tavern now: template placeholders from real stats, so the tour, map and chat work at once; the AI personas follow. */
export function loadInstant(repo: Repo) {
  const s = useTavern.getState();
  s.loadRepo(repo);
  s.setLandlord(null);
  useTavern.setState({ personas: 'pending' });
  s.setCharacters(toCharacters(repo.modules, repo.modules.map((m) => fallbackCharacter(m, repo.modules))));
  mark('tavern:interactive');
  void streamPersonas(repo);
}

/** Uploads take the same path: open at once, personas after. */
export async function loadWithCharacters(repo: Repo) {
  loadInstant(repo);
}

/** quickcart from the bundled snapshot with the saved cast and gossip: no GitHub or AI calls (fast demo load). */
export async function loadSavedDemo(): Promise<Repo> {
  const { default: d } = await import('@/data/demoRepo.json');
  const repo = { ...buildRepo(d.name, d.files, d.url), branch: d.branch, skipped: d.skipped };
  useTavern.getState().loadRepo(repo);
  useTavern.getState().setLandlord(savedLandlord);
  useTavern.setState({ personas: 'done' });
  useTavern.getState().setCharacters(toCharacters(repo.modules, toRaw(repo.modules, demoCharacters.characters as RawCharacter[])));
  return repo;
}
