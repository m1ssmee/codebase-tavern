export type RepoFile = { path: string; content: string; lineCount: number };

export type ModuleStats = {
  fileCount: number;
  totalLines: number;
  biggestFile: { path: string; lines: number };
  todoCount: number;
  maxNesting: number;
  hasTests: boolean;
};

export type Module = { id: string; name: string; path: string; filePaths: string[]; stats: ModuleStats; main?: string /* its main file: source code over docs (entryFile) */ };

export type Character = {
  moduleId: string;
  name: string; // the title, e.g. "payments, the accountant"
  personality: string;
  catchphrase: string;
  greeting: string;
  gossip: string[]; // 4 short lines about other modules or itself
  gossipBubbles?: string[]; // each line's speech bubble (same order), when the AI wrote them
  gossipBubblesClean?: string[]; // the saved cast's clean versions, for clean spice
  voicePitch: number;
  color: string;
  about?: string; // one plain sentence on what the module does (tour, beginner mode)
  landlordLine?: string; // the Landlord's line about this module on the tour
};

// horrified/fainted/nervous/shrug: what-if reactions (Character3D expressions: horrified, dead, nervous, deadpan).
export type Mood = 'idle' | 'talking' | 'accused' | 'guilty' | 'happy' | 'horrified' | 'fainted' | 'nervous' | 'shrug';

export type Citation = { path: string; startLine: number; endLine: number };

export type ChatMessage = {
  id: string;
  role: 'user' | 'character' | 'system';
  characterId?: string;
  text: string;
  citations: Citation[];
  /** The speech bubble for this answer (the AI's short in-character version), when it came with one. */
  bubble?: string;
};

export type SpiceLevel = 'clean' | 'unhinged' | 'feral' | 'nuclear'; // clean is hidden (Ctrl+Shift+C)
export type ExplainMode = 'beginner' | 'expert';

export type Repo = {
  name: string;
  url?: string;
  branch?: string;
  key?: string; // owner/repo[/subpath]@commitSHA: the cache key for this exact download
  files: RepoFile[];
  modules: Module[];
  skipped?: { count: number; reasons: Record<string, number> };
};
