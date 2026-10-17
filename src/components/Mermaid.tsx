'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { parseCites } from '@/lib/diagram';
import type { Citation } from '@/lib/types';

type MermaidApi = typeof import('mermaid').default;
let loading: Promise<MermaidApi> | null = null;
// Loaded on first use only (~1MB). Strict security; themed like the app: white, black ink, readable on a projector.
const load = () =>
  (loading ??= import('mermaid').then(({ default: m }) => {
    const font = `${getComputedStyle(document.documentElement).getPropertyValue('--font-inter-tight').trim() || 'system-ui'}, system-ui, sans-serif`;
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // Keys a %%{init}%% directive may never override (sanitizeDiagram strips directives too; this is the backstop).
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'htmlLabels', 'flowchart', 'sequence', 'dompurifyConfig'],
      theme: 'base',
      fontFamily: font,
      themeVariables: {
        background: '#ffffff',
        fontFamily: font,
        fontSize: '16px',
        primaryColor: '#ffffff',
        primaryBorderColor: '#171717',
        primaryTextColor: '#171717',
        secondaryColor: '#f5f5f5',
        tertiaryColor: '#fbfaf8',
        lineColor: '#8a8580',
        textColor: '#171717',
        edgeLabelBackground: '#ffffff',
        actorBkg: '#ffffff',
        actorBorder: '#171717',
        actorTextColor: '#171717',
        actorLineColor: '#b8b2a8',
        signalColor: '#171717',
        signalTextColor: '#171717',
        noteBkgColor: '#fff6d6',
        noteBorderColor: '#e2c44c',
        noteTextColor: '#171717',
      },
      flowchart: { curve: 'basis', padding: 14, nodeSpacing: 70, rankSpacing: 95 },
      sequence: { mirrorActors: false, wrap: true, width: 170, messageFontSize: 15, noteFontSize: 14, actorFontSize: 15 },
    });
    return m;
  }));

let seq = 0;

/** Sequence-diagram messages in order, each with its text element(s) (a wrapped label is several) and its arrow. */
export function messageGroups(svg: SVGSVGElement): Element[][] {
  const groups: Element[][] = [];
  let texts: Element[] = [];
  svg.querySelectorAll('.messageText, .messageLine0, .messageLine1').forEach((el) => {
    if (el.classList.contains('messageText')) return void texts.push(el);
    groups.push([...texts, el]);
    texts = [];
  });
  return groups;
}
type Box = [number, number, number, number];
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type MermaidHandle = {
  svg: () => SVGSVGElement | null;
  /** Animate the view onto these elements; `inset` keeps that many px free at the bottom (for an overlay). */
  focus: (els: Element[], opts?: { pad?: number; inset?: number; instant?: boolean }) => void;
  reset: (instant?: boolean) => void;
};

type Props = {
  code: string;
  fill?: boolean; // fill the box, with pan and zoom; otherwise the diagram's natural size
  validCite?: (c: Citation) => boolean;
  onCite?: (c: Citation) => void;
  onReady?: (svg: SVGSVGElement | null, renderId: string) => void; // null: the diagram didn't parse and was dropped
  className?: string;
};

/**
 * Renders Mermaid text. Invalid text renders nothing. `%% cite NODE path:a-b` (flowcharts) and `%% cite path:a-b`
 * under a message (sequence diagrams) become click targets for valid citations.
 */
export default forwardRef<MermaidHandle, Props>(function Mermaid({ code, fill, validCite, onCite, onReady, className }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const view = useRef<Box | null>(null);
  const home = useRef<Box | null>(null);
  const anim = useRef(0);
  const dragged = useRef(false);
  const [dropped, setDropped] = useState(false);
  const cb = useRef({ validCite, onCite, onReady });
  useEffect(() => void (cb.current = { validCite, onCite, onReady }));

  const apply = (b: Box) => {
    view.current = b;
    svgRef.current?.setAttribute('viewBox', b.join(' '));
  };
  // Match the box's aspect so focus maths is exact.
  const fit = (b: Box): Box => {
    const el = box.current;
    if (!el || !el.clientWidth || !el.clientHeight) return b;
    const aspect = el.clientWidth / el.clientHeight;
    const [x, y, w, h] = b;
    return w / h > aspect ? [x, y - (w / aspect - h) / 2, w, w / aspect] : [x - (h * aspect - w) / 2, y, h * aspect, h];
  };
  const animate = (to: Box, instant?: boolean) => {
    cancelAnimationFrame(anim.current);
    const from = view.current ?? to;
    if (instant || reducedMotion()) return apply(to);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 650);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      apply(from.map((v, i) => v + (to[i] - v) * e) as Box);
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  useImperativeHandle(ref, () => ({
    svg: () => svgRef.current,
    focus: (els, { pad = 60, inset = 0, instant } = {}) => {
      const svg = svgRef.current;
      const el = box.current;
      const ctm = svg?.getScreenCTM()?.inverse();
      if (!svg || !el || !ctm || !els.length) return;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const e of els) {
        const r = e.getBoundingClientRect();
        for (const [px, py] of [[r.left, r.top], [r.right, r.bottom]]) {
          const p = new DOMPoint(px, py).matrixTransform(ctm);
          [x0, y0, x1, y1] = [Math.min(x0, p.x), Math.min(y0, p.y), Math.max(x1, p.x), Math.max(y1, p.y)];
        }
      }
      const [W, H] = [el.clientWidth, el.clientHeight - inset];
      const [bw, bh] = [x1 - x0 + pad * 2, y1 - y0 + pad * 2];
      const s = Math.min(W / bw, H / bh); // px per unit
      const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
      animate([cx - el.clientWidth / s / 2, cy - H / s / 2, el.clientWidth / s, el.clientHeight / s], instant);
    },
    reset: (instant) => home.current && animate(fit(home.current), instant),
  }));

  useEffect(() => {
    let alive = true;
    (async () => {
      const m = await load();
      // Our own charts never contain a directive and AI text has them stripped: anything left is refused.
      if (/%%\{/.test(code) || !(await m.parse(code, { suppressErrors: true }))) {
        if (alive) setDropped(true);
        cb.current.onReady?.(null, '');
        return;
      }
      const rid = `mmd${++seq}`;
      const { svg } = await m.render(rid, code);
      if (!alive || !box.current) return;
      // Mermaid's own output under securityLevel "strict" (labels go through its DOMPurify); AI-written text was
      // already stripped of click/init directives, HTML and URLs by sanitizeDiagram before it got here.
      box.current.innerHTML = svg;
      const el = box.current.querySelector('svg');
      if (!el) return;
      svgRef.current = el;
      setDropped(false);
      if (fill) {
        el.removeAttribute('style');
        el.setAttribute('width', '100%');
        el.setAttribute('height', '100%');
        el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        const vb = (el.getAttribute('viewBox') ?? '0 0 100 100').split(/[\s,]+/).map(Number) as Box;
        home.current = [vb[0] - 20, vb[1] - 20, vb[2] + 40, vb[3] + 40];
        apply(fit(home.current));
      }
      // Citations we validated ourselves become click targets: nodes by id, messages by order.
      const messages = messageGroups(el);
      for (const c of parseCites(code)) {
        const cite = { path: c.path, startLine: c.startLine, endLine: c.endLine };
        if (!cb.current.validCite?.(cite)) continue;
        const targets = typeof c.target === 'number' ? (messages[c.target] ?? []) : [el.querySelector(`[id^="${rid}-flowchart-${c.target}-"]`)];
        for (const t of targets) {
          if (!t) continue;
          t.classList.add('cite-target');
          t.addEventListener('click', () => cb.current.onCite?.(cite));
        }
      }
      cb.current.onReady?.(el, rid);
    })().catch((err) => {
      console.warn('[mermaid]', err);
      if (alive) setDropped(true);
      cb.current.onReady?.(null, '');
    });
    return () => {
      alive = false;
      cancelAnimationFrame(anim.current);
    };
  }, [code, fill]);

  // Pan (drag) and zoom (wheel) in fill mode; a drag never counts as a click.
  useEffect(() => {
    const el = box.current;
    if (!fill || !el) return;
    let start: { x: number; y: number; b: Box } | null = null;
    const down = (e: PointerEvent) => {
      if (!view.current) return;
      start = { x: e.clientX, y: e.clientY, b: view.current };
      dragged.current = false;
    };
    const move = (e: PointerEvent) => {
      if (!start || !el.clientWidth) return;
      const k = start.b[2] / el.clientWidth;
      const [dx, dy] = [e.clientX - start.x, e.clientY - start.y];
      if (Math.hypot(dx, dy) > 4) dragged.current = true;
      if (dragged.current) {
        cancelAnimationFrame(anim.current);
        apply([start.b[0] - dx * k, start.b[1] - dy * k, start.b[2], start.b[3]]);
      }
    };
    const up = () => void (start = null);
    const click = (e: MouseEvent) => {
      if (!dragged.current) return;
      e.stopPropagation();
      e.preventDefault();
      dragged.current = false;
    };
    const wheel = (e: WheelEvent) => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM()?.inverse();
      if (!view.current || !ctm) return;
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
      const z = Math.min(4, Math.max(0.25, Math.pow(1.0015, e.deltaY)));
      const [x, y, w, h] = view.current;
      apply([p.x - (p.x - x) * z, p.y - (p.y - y) * z, w * z, h * z]);
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('click', click, true);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('click', click, true);
      el.removeEventListener('wheel', wheel);
    };
  }, [fill]);

  return <div ref={box} className={`${className ?? ''} ${dropped ? 'hidden' : ''}`} />;
});
