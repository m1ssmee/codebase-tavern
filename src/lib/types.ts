export type RepoFile = { path: string; content: string; lineCount: number };

export type ModuleStats = {
  fileCount: number;
  totalLines: number;
  biggestFile: { path: string; lines: number };
  todoCount: number;
  maxNesting: number;
  hasTests: boolean;
};

export type Module = { id: string; name: string; path: string; filePaths: string[]; stats: ModuleStats };

export type Character = {
  moduleId: string;
  name: string;
  personality: string;
  catchphrase: string;
  speechStyle: string;
  voicePitch: number;
  color: string;
};

export type Mood = 'idle' | 'talking' | 'accused' | 'guilty' | 'happy';

export type Citation = { path: string; startLine: number; endLine: number };

export type ChatMessage = {
  id: string;
  role: 'user' | 'character' | 'system';
  characterId?: string;
  text: string;
  citations: Citation[];
};

export type SpiceLevel = 'clean' | 'spicy' | 'unhinged';
export type ExplainMode = 'beginner' | 'expert';

export type Repo = { name: string; url?: string; files: RepoFile[]; modules: Module[] };
