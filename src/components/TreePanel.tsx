'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';
import { useTavern } from '@/lib/store';
import type { RepoFile } from '@/lib/types';
import CharacterFace from './CharacterFace';

type Node = { name: string; path: string; children?: Node[] };

// "payments, the accountant" → "the accountant" (the module name is already on the row)
const descriptor = (title: string) => title.replace(/^[^,]*,\s*/, '');
const FACE = 30;
const ROW = 'rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber';

function buildTree(files: RepoFile[]): Node[] {
  const root: Node = { name: '', path: '', children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let cur = root;
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      const isFile = i === parts.length - 1;
      let next = cur.children!.find((c) => c.name === name);
      if (!next) cur.children!.push((next = { name, path, children: isFile ? undefined : [] }));
      cur = next;
    });
  }
  const sort = (nodes: Node[]): Node[] =>
    nodes
      .sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name))
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n));
  return sort(root.children!);
}

export default function TreePanel() {
  const { repo, characters, moods, selectedModuleId, openFilePath, selectModule, openFile } = useTavern();
  // User's explicit open/closed choices; default = top level open. Ancestors of the open file are always open,
  // so a citation into a collapsed folder still shows up.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const tree = useMemo(() => buildTree(repo?.files ?? []), [repo]);
  const moduleByPath = useMemo(() => new Map(repo?.modules.map((m) => [m.path, m]) ?? []), [repo]);
  // root / misc modules have no folder of their own; list them above the tree.
  const loose = repo?.modules.filter((m) => !m.path || !repo.files.some((f) => f.path.startsWith(m.path + '/'))) ?? [];

  const isOpen = (path: string, depth: number) => !!openFilePath?.startsWith(path + '/') || (toggled[path] ?? depth === 0);
  const toggle = (path: string, open: boolean) => setToggled((t) => ({ ...t, [path]: open }));

  const render = (nodes: Node[], depth: number) =>
    nodes.map((n) => {
      const pad = { paddingLeft: 8 + depth * 14 };
      if (!n.children) {
        return (
          <button
            key={n.path}
            type="button"
            onClick={() => {
              openFile(n.path);
              const owner = repo?.modules.find((m) => m.filePaths.includes(n.path));
              if (owner) selectModule(owner.id);
            }}
            style={pad}
            className={`${ROW} flex w-full items-center gap-2 py-1 pr-2 text-left font-mono text-sm ${
              openFilePath === n.path ? 'bg-amber/20 text-amber' : 'text-cream/80 hover:bg-wood'
            }`}
          >
            <FileText size={14} className="shrink-0 opacity-60" />
            <span className="truncate">{n.name}</span>
          </button>
        );
      }
      const mod = moduleByPath.get(n.path);
      const char = mod && characters[mod.id];
      const open = isOpen(n.path, depth);
      const Chevron = open ? ChevronDown : ChevronRight;
      return (
        <div key={n.path}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => (mod ? (selectModule(mod.id), toggle(n.path, true)) : toggle(n.path, !open))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}
            style={pad}
            className={`${ROW} flex cursor-pointer items-center gap-2 py-1 pr-2 ${
              mod && selectedModuleId === mod.id ? 'bg-tomato/20 ring-1 ring-tomato/60' : 'hover:bg-wood'
            }`}
          >
            <Chevron
              size={14}
              className="shrink-0 opacity-70 hover:opacity-100"
              onClick={(e) => (e.stopPropagation(), toggle(n.path, !open))}
            />
            {mod ? (
              <CharacterFace size={FACE} name={mod.name} stats={mod.stats} color={char?.color} mood={moods[mod.id]} />
            ) : (
              <Folder size={14} className="shrink-0 text-muted" />
            )}
            <span className={`truncate ${mod ? 'font-bold text-cream' : 'text-cream/80'}`}>{n.name}</span>
            {char && <span className="ml-auto truncate text-xs text-muted">{descriptor(char.name)}</span>}
          </div>
          {open && (
            <div className="relative">
              {/* indent guide, centred under this row's chevron */}
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-edge" style={{ left: 15 + depth * 14 }} />
              {render(n.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b-2 border-edge px-3 py-2 font-display tracking-wide text-amber">The Regulars</div>
      <nav className="flex-1 overflow-auto p-2">
        {loose.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => selectModule(m.id)}
            className={`${ROW} flex w-full items-center gap-2 px-2 py-1 text-left ${
              selectedModuleId === m.id ? 'bg-tomato/20 ring-1 ring-tomato/60' : 'hover:bg-wood'
            }`}
          >
            <CharacterFace size={FACE} name={m.name} stats={m.stats} color={characters[m.id]?.color} mood={moods[m.id]} />
            <span className="truncate font-bold text-cream">{m.name}</span>
            <span className="ml-auto truncate text-xs text-muted">
              {characters[m.id] ? descriptor(characters[m.id].name) : `${m.stats.fileCount} files`}
            </span>
          </button>
        ))}
        {render(tree, 0)}
      </nav>
    </div>
  );
}
