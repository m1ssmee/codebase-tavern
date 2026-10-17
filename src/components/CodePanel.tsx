'use client';
import { useEffect, useRef, useState } from 'react';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import { ChevronRight } from 'lucide-react';
import { useTavern } from '@/lib/store';
import { languageFor } from '@/lib/lang';
import Gossip from './Gossip';

type Ed = Parameters<OnMount>[0];

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
  const { repo, openFilePath, highlight } = useTavern();
  const file = repo?.files.find((f) => f.path === openFilePath);
  const editorRef = useRef<Ed | null>(null);
  const [ready, setReady] = useState(false);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    // next/font hashes the family name; read the real one so Monaco measures the right font.
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-jetbrains');
    if (mono) editor.updateOptions({ fontFamily: mono });
    document.fonts.ready.then(() => monaco.editor.remeasureFonts());
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
        <Gossip />
      </div>
    </div>
  );
}
