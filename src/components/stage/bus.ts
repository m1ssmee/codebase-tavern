'use client';
// The code panel's Monaco editor, for the stage: where a line is on screen, which file is open, scrolling.
// Position of a line = its top in the document (getTopForLineNumber) minus scrollTop, plus the editor's offset.
import type { OnMount } from '@monaco-editor/react';

type Ed = Parameters<OnMount>[0];
export const bus: { ed: Ed | null; path: string | null } = { ed: null, path: null };

export type LineBox = { top: number; bottom: number; mid: number; left: number; codeLeft: number; right: number; viewTop: number; viewBottom: number; visible: boolean };

/** The editor's box on screen (the code area), or null when no file is open. */
export function editorBox(): DOMRect | null {
  const dom = bus.ed?.getDomNode();
  return dom ? dom.getBoundingClientRect() : null;
}

/** Where `line` of the open file sits on screen right now (it moves when the editor scrolls). */
export function lineBox(line: number): LineBox | null {
  const ed = bus.ed;
  const dom = ed?.getDomNode();
  if (!ed || !dom) return null;
  const r = dom.getBoundingClientRect();
  const top = r.top + ed.getTopForLineNumber(line) - ed.getScrollTop();
  const h = ed.getTopForLineNumber(line + 1) - ed.getTopForLineNumber(line) || 22;
  const codeLeft = r.left + ed.getLayoutInfo().contentLeft;
  return { top, bottom: top + h, mid: top + h / 2, left: r.left, codeLeft, right: r.right, viewTop: r.top, viewBottom: r.bottom, visible: top + h > r.top && top < r.bottom };
}

/**
 * The line under a screen point in the open file, or null. Worked out from the line positions, not by hit-testing:
 * a character being dragged sits on top of the editor at that point.
 */
export function lineAt(x: number, y: number): number | null {
  const ed = bus.ed;
  const r = ed?.getDomNode()?.getBoundingClientRect();
  if (!ed || !r || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  for (const range of ed.getVisibleRanges())
    for (let l = range.startLineNumber; l <= range.endLineNumber; l++) {
      const b = lineBox(l);
      if (b && y >= b.top && y < b.bottom) return l;
    }
  return null;
}

export function reveal(start: number, end = start) {
  bus.ed?.revealLinesInCenterIfOutsideViewport(start, end);
}
