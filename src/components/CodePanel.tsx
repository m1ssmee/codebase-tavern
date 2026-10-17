'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Editor, { DiffEditor, type BeforeMount, type OnMount } from '@monaco-editor/react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useTavern, type WhatIfChange } from '@/lib/store';
import { declaredIn, deleteDiff, renameDiff, retryOrCheck } from '@/lib/whatif';
import type { RepoFile } from '@/lib/types';
import { languageFor } from '@/lib/lang';
import Gossip from './Gossip';
import { sendChat } from './ChatPanel';

type Ed = Parameters<OnMount>[0];

// three.js + R3F only download when someone opens the map.
const MapView = dynamic(() => import('./map/MapView'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-[#fbfaf8] text-muted">Drawing the map…</div>,
});

const defineTheme: BeforeMount = (monaco) =>
  monaco.editor.defineTheme('tavern', {
    base: 'vs',
    inherit: true,
    rules: [{ token: 'comment', foreground: '8a8a8a', fontStyle: 'italic' }],
    colors: {
      'editor.background': '#ffffff',
      'editorLineNumber.foreground': '#b8b8b8',
      'editorLineNumber.activeForeground': '#171717',
      'editor.lineHighlightBackground': '#00000000',
      'editor.selectionBackground': '#ffd60a55',
    },
  });

export default function CodePanel() {
  const { repo, openFilePath, highlight, tribunal, whatIf, whatIfDiff, view, setView } = useTavern();
  const [menu, setMenu] = useState(false); // the "What if I change this?" presets
  const [diffIdx, setDiffIdx] = useState(0);
  const shownDiff = whatIfDiff?.[Math.min(diffIdx, whatIfDiff.length - 1)];
  // Floating "Explain this" button for a non-empty selection, positioned at the selection's end.
  const [sel, setSel] = useState<{ start: number; end: number; top: number; left: number; height: number } | null>(null);
  const file = repo?.files.find((f) => f.path === openFilePath);
  const editorRef = useRef<Ed | null>(null);
  const [ready, setReady] = useState(false);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    // next/font hashes the family name; read the real one so Monaco measures the right font.
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-jetbrains');
    if (mono) editor.updateOptions({ fontFamily: mono });
    document.fonts.ready.then(() => monaco.editor.remeasureFonts());
    // Buttons sit under the selection's end; a scroll (Monaco reveals the cursor a frame later) moves them along,
    // and they hide only when that end is out of view.
    const place = () => {
      const selection = editor.getSelection();
      const pos = selection && !selection.isEmpty() ? editor.getScrolledVisiblePosition(selection.getEndPosition()) : null;
      const visible = pos && pos.top >= 0 && pos.top < editor.getLayoutInfo().height - pos.height;
      const height = editor.getLayoutInfo().height;
      setSel(visible ? { start: selection!.startLineNumber, end: selection!.endLineNumber, top: pos.top + pos.height + 4, left: pos.left, height } : null);
    };
    editor.onDidChangeCursorSelection(() => {
      setMenu(false);
      place();
    });
    editor.onDidScrollChange(place);
    setReady(true);
  };

  // Citation → reveal + glowing decoration that fades (CSS) and is removed after 4s.
  // Editor's own effect swaps the model first (child effects run before parent), so the lines exist here.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ready || !ed || !highlight || highlight.path !== file?.path) return;
    const last = ed.getModel()?.getLineCount() ?? 1;
    const start = Math.min(highlight.startLine, last);
    const end = Math.min(Math.max(highlight.endLine, start), last);
    ed.revealLinesInCenter(start, end);
    const deco = ed.createDecorationsCollection([
      {
        range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 },
        options: { isWholeLine: true, className: 'tavern-hl-line', linesDecorationsClassName: 'tavern-hl-gutter' },
      },
    ]);
    const t = setTimeout(() => deco.clear(), 4000);
    return () => {
      clearTimeout(t);
      deco.clear();
    };
  }, [highlight, file?.path, ready]);

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-edge px-3 py-2 font-mono text-sm whitespace-nowrap text-muted">
        {file ? (
          file.path.split('/').map((part, i, all) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} />}
              <span className={i === all.length - 1 ? 'text-cream' : ''}>{part}</span>
            </span>
          ))
        ) : (
          <span>no file open</span>
        )}
        <div className="ml-auto flex shrink-0 rounded-full border border-edge p-0.5 font-sans">
          {(whatIfDiff ? (['code', 'map', 'diff'] as const) : (['code', 'map'] as const)).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-0.5 text-xs transition-colors ${view === v ? 'bg-amber text-ink' : 'text-muted hover:text-cream'}`}
            >
              {v === 'code' ? 'Code' : v === 'map' ? 'Map' : 'Diff'}
            </button>
          ))}
        </div>
      </div>
      <div className="relative flex-1">
        {file ? (
          <Editor
            path={file.path}
            value={file.content}
            language={languageFor(file.path)}
            theme="tavern"
            beforeMount={defineTheme}
            onMount={onMount}
            loading={<div className="p-4 text-muted">Pouring the code…</div>}
            options={{
              readOnly: true,
              domReadOnly: true,
              minimap: { enabled: false },
              fontSize: 15,
              lineHeight: 22,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderLineHighlight: 'none',
              padding: { top: 12 },
            }}
          />
        ) : (
          <div className="grid h-full place-items-center text-muted">Pick a file from the tree.</div>
        )}
        {view === 'map' && (
          <div className="absolute inset-0 z-10">
            <MapView />
          </div>
        )}
        {view === 'diff' && shownDiff && (
          <div className="absolute inset-0 z-10 flex flex-col bg-panel">
            <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              <span>Preview only. Nothing was changed.</span>
              {whatIfDiff!.length > 1 &&
                whatIfDiff!.map((d, i) => (
                  <button key={d.path} type="button" onClick={() => setDiffIdx(i)} className={`rounded-full px-2 font-mono ${d === shownDiff ? 'bg-amber-200' : ''}`}>
                    {d.path}
                  </button>
                ))}
              <span className="ml-auto font-mono">{shownDiff.path}: before | after</span>
            </div>
            <div className="flex-1">
              <DiffEditor
                key={shownDiff.path}
                original={shownDiff.before}
                modified={shownDiff.after}
                language={languageFor(shownDiff.path)}
                theme="tavern"
                beforeMount={defineTheme}
                options={{ readOnly: true, originalEditable: false, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false, minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true }}
              />
            </div>
          </div>
        )}
        {sel && file && !tribunal && view === 'code' && (
          // Near the bottom the presets open upwards (the button row stays put under the selection).
          <div
            className={`absolute z-30 flex items-start gap-1 ${sel.top + 250 > sel.height ? 'flex-col-reverse' : 'flex-col'}`}
            style={sel.top + 250 > sel.height ? { bottom: sel.height - sel.top - 26, left: Math.max(8, sel.left - 40) } : { top: sel.top, left: Math.max(8, sel.left - 40) }}
          >
            <div className="flex gap-1">
              {!whatIf && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // keep Monaco's selection while clicking
                  onClick={() => {
                    void sendChat(`Explain these lines [${file.path}:${sel.start}-${sel.end}]`);
                    setSel(null);
                  }}
                  className="bounce-hover rounded-full border border-edge bg-amber px-3 py-1 text-xs font-bold text-ink shadow-md"
                >
                  Explain this
                </button>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMenu((m) => !m)}
                className="bounce-hover flex items-center gap-1 rounded-full border border-edge bg-panel px-3 py-1 text-xs font-bold text-cream shadow-md"
              >
                <Sparkles size={12} /> What if I change this?
              </button>
            </div>
            {menu && (
              <WhatIfMenu
                file={file}
                start={sel.start}
                end={sel.end}
                onPick={(change) => {
                  setMenu(false);
                  setSel(null);
                  useTavern.getState().openWhatIf(change);
                }}
              />
            )}
          </div>
        )}
        <Gossip />
      </div>
    </div>
  );
}

/** Presets for a selection. Delete and Rename build their diff here; the rest are described to the model. */
function WhatIfMenu({ file, start, end, onPick }: { file: RepoFile; start: number; end: number; onPick: (c: WhatIfChange) => void }) {
  const [text, setText] = useState('');
  const where = `${file.path}:${start}${end > start ? `-${end}` : ''}`;
  const code = file.content.split('\n').slice(start - 1, end).join('\n');
  const decl = declaredIn(file.content, start, end);
  const kind = retryOrCheck(code);
  const describe = (description: string, title = description) => onPick({ kind: 'describe', description, title, path: file.path, startLine: start, endLine: end });
  const presets: [string, () => void][] = [
    ['Delete this', () => onPick({ kind: 'diff', diff: deleteDiff(file.path, file.content, start, end), title: `Delete ${where}`, path: file.path })],
    ...(decl
      ? [['Rename it', () => onPick({ kind: 'diff', diff: renameDiff(file.path, file.content, start, end)!, title: `Rename ${decl.name} to ${decl.name}V2 (callers not updated)`, path: file.path })] as [string, () => void]]
      : []),
    ['Make it slower', () => describe(`Make the code at ${where} slower: add a deliberate delay of about 3000ms before it does its work.`, `Make ${where} about 3000ms slower`)],
    ...(kind
      ? [[kind === 'retry' ? 'Remove this retry' : 'Remove this check', () => describe(kind === 'retry' ? `Remove the retry at ${where} so it tries only once.` : `Remove the check at ${where}.`)] as [string, () => void]]
      : []),
  ];
  return (
    <div className="w-64 rounded-xl border border-edge bg-panel p-1.5 text-sm shadow-lg">
      {presets.map(([label, run]) => (
        <button key={label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={run} className="block w-full rounded-lg px-2 py-1 text-left text-cream hover:bg-wood">
          {label}
        </button>
      ))}
      <form
        className="mt-1 flex gap-1 border-t border-edge pt-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) describe(`${text.trim()} (at ${where})`, text.trim());
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe a change"
          className="min-w-0 flex-1 rounded-full border border-edge bg-ink px-2.5 py-1 text-xs text-cream focus:border-amber focus:outline-none"
        />
        <button type="submit" disabled={!text.trim()} className="rounded-full bg-amber px-2.5 text-xs font-medium text-ink disabled:opacity-40">
          Go
        </button>
      </form>
    </div>
  );
}
