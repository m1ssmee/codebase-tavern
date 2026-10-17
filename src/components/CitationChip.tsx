'use client';
import { FileCode } from 'lucide-react';
import { useTavern } from '@/lib/store';
import type { Citation } from '@/lib/types';

export default function CitationChip({ citation }: { citation: Citation }) {
  const highlightCitation = useTavern((s) => s.highlightCitation);
  const { path, startLine, endLine } = citation;
  const label = `${path.split('/').pop()}:${startLine}${endLine !== startLine ? `-${endLine}` : ''}`;
  return (
    <button
      type="button"
      onClick={() => highlightCitation(citation)}
      title={`Show ${path} lines ${startLine}-${endLine}`}
      className="bounce-hover mx-0.5 inline-flex items-center gap-1 rounded-full border border-amber/60 bg-amber/15 px-2 py-0.5 align-baseline font-mono text-[0.8em] text-amber hover:bg-amber/25"
    >
      <FileCode size={12} />
      {label}
    </button>
  );
}
