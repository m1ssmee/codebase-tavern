import { create } from 'zustand';
import type { Character, ChatMessage, Citation, ExplainMode, Mood, Repo, RepoFile, SpiceLevel } from './types';
import type { RoastCard } from './roast';
import { buildRepo, entryFile, nesting } from './analyze';
import { affectedBy, buildGraph, dependenciesOf, dependentsOf, type Graph } from './graph';
import { buildingFacts, tourOrder } from './landlord';
import { toCharacters, toRaw, type RawCharacter } from './characters';
import demoCharacters from '@/data/demoCharacters.json';

/** One hop of a ripple: `up` travels from `via` to a module that imports or calls it, `down` from `via` to a module it calls. */
export type RippleStep = { id: string; hops: number; via: string; dir: 'up' | 'down' };
export type Landlord = { intro: string; outro: string };
/** A generated roast: the card at the active spice level and clean, and their signed share payloads. */
export type RoastResult = { cards: { spicy: RoastCard; clean: RoastCard }; links: { spicy: string; clean: string } | null; source: string };
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
  tourOn: boolean; // the Landlord's guided tour, in the Diagram tab
  landlord: Landlord | null; // the Landlord's intro and outro for this repo (model-written; null = templates)
  landlordSays: string | null; // the What-if closing beat
  roastOpen: boolean;
  roasts: Record<string, RoastResult>; // per repo, for this session
  rippleFrom: { ids: string[]; at: number; steps?: RippleStep[]; label?: string } | null; // set while a ripple plays on the map
  whatIf: { id: number; change: WhatIfChange } | null; // right panel in What-if mode
  whatIfDiff: { path: string; before: string; after: string }[] | null; // the previewed change, for the diff view
  bubbles: Record<string, string>; // speech bubbles over map nodes

  loadRepo: (repo: Repo) => void;
  setCharacters: (characters: Character[]) => void;
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
        selectedModuleId: repo.modules[0]?.id ?? null,
        highlight: null,
        tribunal: false,
        demo: false,
        openFilePath: (repo.modules[0] && entryFile(repo.modules[0])) ?? repo.files[0]?.path ?? null,
      }),
    setCharacters: (list) => {
      set({ characters: Object.fromEntries(list.map((c) => [c.moduleId, c])) });
      // First visit to this repo: open the Diagram tab on the Landlord's tour (the chat greeting waits).
      if (!tourSeen(get().repo)) return set({ tourOn: true, view: 'diagram' });
      greet(get().selectedModuleId);
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

type IngestResponse = { name: string; url: string; branch: string; files: RepoFile[]; skipped: Repo['skipped']; error?: string };

const inflight = new Map<string, Promise<Repo>>();

/** Fetch a GitHub repo via /api/ingest, analyse it client-side, load it. Throws Error(in-character message). */
export function summonRepo(input: string): Promise<Repo> {
  // Dedupe concurrent calls (React StrictMode runs effects twice in dev).
  let p = inflight.get(input);
  if (!p) {
    p = (async () => {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input }),
      }).catch(() => null);
      const data: IngestResponse | null = await res?.json().catch(() => null);
      if (!res?.ok || !data?.files) throw new Error(data?.error ?? "Couldn't reach the server. Check your connection and try again.");
      const repo = { ...buildRepo(data.name, data.files, data.url), branch: data.branch, skipped: data.skipped };
      await loadWithCharacters(repo);
      return repo;
    })().finally(() => inflight.delete(input));
    inflight.set(input, p);
  }
  return p;
}

const savedLandlord = (demoCharacters as { landlord?: Landlord }).landlord ?? null;

/**
 * Characters (and the Landlord's tour lines) for every module in one /api/characters call; any failure falls back
 * to stat templates. Never throws.
 */
export async function generateCharacters(repo: Repo): Promise<{ characters: Character[]; landlord: Landlord | null }> {
  const byPath = new Map(repo.files.map((f) => [f.path, f.content]));
  const modules = repo.modules.map((m) => ({
    ...m,
    filePaths: m.filePaths.slice(0, 40),
    keyFiles: [...new Set([entryFile(m), m.stats.biggestFile.path])]
      .filter((p): p is string => !!p && byPath.has(p))
      .slice(0, 2)
      .map((p) => ({ path: p, head: byPath.get(p)!.split('\n', 40).join('\n') })),
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
  let raw: RawCharacter[] = [];
  let landlord: Landlord | null = null;
  let live = false;
  try {
    const s = useTavern.getState();
    const res = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName: repo.name, modules: withLinks, building, spice: s.spice, mode: s.mode }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await res.json();
    raw = data.characters ?? [];
    landlord = data.landlord?.intro && data.landlord?.outro ? { intro: String(data.landlord.intro), outro: String(data.landlord.outro) } : null;
    live = data.source === 'llm';
  } catch {
    // network/timeout: toRaw below fills every module from templates
  }
  // Demo safety: on the demo repo, a failed generation uses the saved cast instead of stat templates.
  if (!live && repo.url?.includes('/quickcart') && demoCharacters.characters.length) {
    raw = demoCharacters.characters as RawCharacter[];
    landlord = savedLandlord;
  }
  return { characters: toCharacters(repo.modules, toRaw(repo.modules, raw)), landlord };
}

/** Runs while the loading screen is up: characters first, then load, so the tavern opens fully populated. */
export async function loadWithCharacters(repo: Repo) {
  const { characters, landlord } = await generateCharacters(repo);
  useTavern.getState().loadRepo(repo);
  useTavern.getState().setLandlord(landlord);
  useTavern.getState().setCharacters(characters);
}

/** quickcart from the bundled snapshot with the saved cast and gossip: no GitHub or AI calls (fast demo load). */
export async function loadSavedDemo(): Promise<Repo> {
  const { default: d } = await import('@/data/demoRepo.json');
  const repo = { ...buildRepo(d.name, d.files, d.url), branch: d.branch, skipped: d.skipped };
  useTavern.getState().loadRepo(repo);
  useTavern.getState().setLandlord(savedLandlord);
  useTavern.getState().setCharacters(toCharacters(repo.modules, toRaw(repo.modules, demoCharacters.characters as RawCharacter[])));
  return repo;
}
