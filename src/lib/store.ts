import { create } from 'zustand';
import type { Character, ChatMessage, Citation, ExplainMode, Mood, Repo, RepoFile, SpiceLevel } from './types';
import { buildRepo, entryFile } from './analyze';

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

  loadRepo: (repo: Repo) => void;
  setCharacters: (characters: Character[]) => void;
  selectModule: (moduleId: string | null) => void;
  openFile: (path: string) => void;
  highlightCitation: (c: Citation) => void;
  addMessage: (moduleId: string, msg: ChatMessage) => void;
  appendToMessage: (moduleId: string, messageId: string, chunk: string) => void;
  setMood: (moduleId: string, mood: Mood) => void;
  setSpice: (spice: SpiceLevel) => void;
  setMode: (mode: ExplainMode) => void;
  toggleMute: () => void;
  setLoading: (isLoading: boolean) => void;
};

export const useTavern = create<TavernState>()((set) => ({
  repo: null,
  characters: {},
  moods: {},
  selectedModuleId: null,
  openFilePath: null,
  highlight: null,
  chats: {},
  spice: 'spicy',
  mode: 'beginner',
  muted: false,
  isLoading: false,

  // Modules come sorted by size, so [0] is the largest; open its most important file.
  loadRepo: (repo) =>
    set({
      repo,
      characters: {},
      moods: {},
      chats: {},
      selectedModuleId: repo.modules[0]?.id ?? null,
      highlight: null,
      openFilePath: (repo.modules[0] && entryFile(repo.modules[0])) ?? repo.files[0]?.path ?? null,
    }),
  setCharacters: (list) => set({ characters: Object.fromEntries(list.map((c) => [c.moduleId, c])) }),
  selectModule: (selectedModuleId) => set({ selectedModuleId }),
  openFile: (openFilePath) => set({ openFilePath }),
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
  setMood: (moduleId, mood) => set((s) => ({ moods: { ...s.moods, [moduleId]: mood } })),
  setSpice: (spice) => set({ spice }),
  setMode: (mode) => set({ mode }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setLoading: (isLoading) => set({ isLoading }),
}));

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
      useTavern.getState().loadRepo(repo);
      return repo;
    })().finally(() => inflight.delete(input));
    inflight.set(input, p);
  }
  return p;
}
