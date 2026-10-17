import { create } from 'zustand';
import type { Character, ChatMessage, Citation, ExplainMode, Mood, Repo, RepoFile, SpiceLevel } from './types';
import { buildRepo, entryFile, nesting } from './analyze';
import { toCharacters, toRaw, type RawCharacter } from './characters';
import demoCharacters from '@/data/demoCharacters.json';

type TavernState = {
  repo: Repo | null;
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
  // Code-smell reaction for the module whose file was just opened (not in clean).
  smell: { moduleId: string; cloud: boolean; green: boolean; at: number } | null;

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
    smell: null,

    // Modules come sorted by size, so [0] is the largest; open its most important file.
    loadRepo: (repo) =>
      set({
        repo,
        characters: {},
        moods: {},
        chats: {},
        selectedModuleId: repo.modules[0]?.id ?? null,
        highlight: null,
        tribunal: false,
        openFilePath: (repo.modules[0] && entryFile(repo.modules[0])) ?? repo.files[0]?.path ?? null,
      }),
    setCharacters: (list) => {
      set({ characters: Object.fromEntries(list.map((c) => [c.moduleId, c])) });
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
      set({ openFilePath, smell: smelly ? { moduleId: mod.id, cloud, green, at: Date.now() } : null });
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
    setTribunal: (tribunal) => set({ tribunal }),
  };
});

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

/** Characters for every module in one /api/characters call; any failure falls back to stat templates. Never throws. */
export async function generateCharacters(repo: Repo): Promise<Character[]> {
  const byPath = new Map(repo.files.map((f) => [f.path, f.content]));
  const modules = repo.modules.map((m) => ({
    ...m,
    filePaths: m.filePaths.slice(0, 40),
    keyFiles: [...new Set([entryFile(m), m.stats.biggestFile.path])]
      .filter((p): p is string => !!p && byPath.has(p))
      .slice(0, 2)
      .map((p) => ({ path: p, head: byPath.get(p)!.split('\n', 40).join('\n') })),
  }));
  let raw: RawCharacter[] = [];
  let live = false;
  try {
    const res = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName: repo.name, modules, spice: useTavern.getState().spice }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await res.json();
    raw = data.characters ?? [];
    live = data.source === 'llm';
  } catch {
    // network/timeout: toRaw below fills every module from templates
  }
  // Demo safety: on the demo repo, a failed generation uses the saved cast instead of stat templates.
  if (!live && repo.url?.includes('/quickcart') && demoCharacters.characters.length) raw = demoCharacters.characters as RawCharacter[];
  return toCharacters(repo.modules, toRaw(repo.modules, raw));
}

/** Runs while the loading screen is up: characters first, then load, so the tavern opens fully populated. */
export async function loadWithCharacters(repo: Repo) {
  const characters = await generateCharacters(repo);
  useTavern.getState().loadRepo(repo);
  useTavern.getState().setCharacters(characters);
}
