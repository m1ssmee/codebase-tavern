'use client';
import type { ReactNode } from 'react';
import { isValidCitation, parseCitations } from '@/lib/citations';
import type { RepoFile } from '@/lib/types';
import CitationChip from './CitationChip';

// ponytail: tiny markdown subset (numbered/bulleted lists, **bold**, `code`, paragraphs); swap for a
// real parser only if replies start using more than this.
type Block = { kind: 'p' | 'ol' | 'ul'; items: string[]; start?: number };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const last = out.at(-1);
    if (ol) {
      if (last?.kind === 'ol') last.items.push(ol[2]);
      else out.push({ kind: 'ol', items: [ol[2]], start: Number(ol[1]) });
    } else if (ul) {
      if (last?.kind === 'ul') last.items.push(ul[1]);
      else out.push({ kind: 'ul', items: [ul[1]] });
    } else if (!line.trim()) {
      if (last && last.kind !== 'p') out.push({ kind: 'p', items: [] }); // a blank line ends a list
      else if (last?.items.length) out.push({ kind: 'p', items: [] });
    } else if (last?.kind === 'p') last.items.push(line);
    else out.push({ kind: 'p', items: [line] });
  }
  return out.filter((b) => b.items.length);
}

/** **bold** and `code`; citations are already split out, so backtick citations still become chips. */
function format(s: string, key: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
    ) : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code key={`${key}-${i}`} className="rounded bg-edge px-1 font-mono text-[0.85em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

function inline(s: string, files: RepoFile[], key: string): ReactNode[] {
  return parseCitations(s).flatMap((seg, i): ReactNode[] =>
    typeof seg === 'string'
      ? format(seg, `${key}-${i}`)
      : isValidCitation(seg, files) // invalid citations (unknown path, bad lines) are dropped
        ? [<CitationChip key={`${key}-c${i}`} citation={seg} />]
        : [],
  );
}

export default function Rich({ text, files }: { text: string; files: RepoFile[] }) {
  return (
    <div className="space-y-1.5">
      {blocks(text).map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>{inline(b.items.join(' '), files, `p${i}`)}</p>
        ) : b.kind === 'ol' ? (
          <ol key={i} start={b.start} className="list-decimal space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, files, `o${i}-${j}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, files, `u${i}-${j}`)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
