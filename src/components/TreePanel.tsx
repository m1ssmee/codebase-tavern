'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';
import { useTavern } from '@/lib/store';
import type { RepoFile } from '@/lib/types';
import CharacterFace from './CharacterFace';

type Node = { name: string; path: string; children?: Node[] };

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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(repo?.files ?? []), [repo]);
  const moduleByPath = useMemo(() => new Map(repo?.modules.map((m) => [m.path, m]) ?? []), [repo]);

  const toggle = (path: string, open?: boolean) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (open ?? next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const render = (nodes: Node[], depth: number) =>
    nodes.map((n) => {
      const pad = { paddingLeft: 8 + depth * 14 };
      if (!n.children) {
        return (
          <button
            key={n.path}
            type="button"
            onClick={() => openFile(n.path)}
            style={pad}
            className={`flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left font-mono text-sm ${
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
      const isOpen = !collapsed.has(n.path);
      const Chevron = isOpen ? ChevronDown : ChevronRight;
      return (
        <div key={n.path}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => (mod ? (selectModule(mod.id), toggle(n.path, true)) : toggle(n.path))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}
            style={pad}
            className={`flex cursor-pointer items-center gap-2 rounded-md py-1 pr-2 ${
              mod && selectedModuleId === mod.id ? 'bg-tomato/20 ring-1 ring-tomato/60' : 'hover:bg-wood'
            }`}
          >
            <Chevron
              size={14}
              className="shrink-0 opacity-70 hover:opacity-100"
              onClick={(e) => (e.stopPropagation(), toggle(n.path))}
            />
            {mod ? (
              <CharacterFace size={24} color={char?.color} mood={moods[mod.id]} />
            ) : (
              <Folder size={14} className="shrink-0 text-muted" />
            )}
            <span className={`truncate ${mod ? 'font-bold text-cream' : 'text-cream/80'}`}>{n.name}</span>
            {char && <span className="ml-auto truncate text-xs text-muted">{char.name}</span>}
          </div>
          {isOpen && render(n.children, depth + 1)}
        </div>
      );
    });

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b-2 border-edge px-3 py-2 font-display tracking-wide text-amber">The Regulars</div>
      <nav className="flex-1 overflow-auto p-2">{render(tree, 0)}</nav>
    </div>
  );
}
