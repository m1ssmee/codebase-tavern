'use client';
import { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Check, Download, Link2, RotateCcw, Stamp, X } from 'lucide-react';
import { useTavern } from '@/lib/store';
import { inspect } from '@/lib/roast';
import { qrSvg } from '@/lib/faceSvg';
import RoastCardView, { CARD_SIZE, type CardSize } from './RoastCardView';
import { portraitUri } from './Portrait';
import { thinkWhile } from './stage/store';
import { Cue } from './Thinking';

// The app's own fonts (next/font variables); html-to-image embeds them in the PNG.
const FONTS = {
  sans: 'var(--font-inter-tight), system-ui, sans-serif',
  mono: 'var(--font-jetbrains), ui-monospace, monospace',
  display: 'var(--font-newsreader), Georgia, serif',
};

/**
 * @font-face rules for the PNG, Latin subsets only, with the font files inlined. html-to-image would read every
 * stylesheet itself and trip over Monaco's cross-origin one (a SecurityError), so it gets this instead.
 */
async function fontEmbedCSS(): Promise<string> {
  const rules: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // cross-origin
    }
    for (const r of [...list]) if (r instanceof CSSFontFaceRule && /U\+0000-00FF/i.test(r.cssText)) rules.push(r.cssText);
  }
  const inline = async (css: string) => {
    const m = css.match(/url\(["']?([^"')]+)["']?\)/);
    if (!m) return css;
    const blob = await fetch(new URL(m[1], document.baseURI)).then((r) => r.blob());
    const data = await new Promise<string>((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.readAsDataURL(blob);
    });
    return css.replace(m[0], `url("${data}")`);
  };
  return (await Promise.all(rules.map(inline))).join('\n');
}

/** "Roast this repo": the health-inspection notice, two sizes, PNG export and a signed share link. */
export default function RoastPanel() {
  const repo = useTavern((s) => s.repo)!;
  const key = repo.url ?? repo.name;
  const result = useTavern((s) => s.roasts[key]);
  const spice = useTavern((s) => s.spice);
  const [size, setSize] = useState<CardSize>('landscape');
  const [clean, setClean] = useState(spice === 'clean');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [pics, setPics] = useState<{ faces: Record<string, string>; landlord?: string }>({ faces: {} });
  const frame = useRef<HTMLDivElement>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const close = () => useTavern.getState().setRoastOpen(false);

  // One generation per repo per session (cached in the store); a tick later so StrictMode's remount doesn't double it.
  useEffect(() => {
    if (result) return;
    const ac = new AbortController(); // closing the panel cancels the request (and its cue)
    const t = setTimeout(async () => {
      const s = useTavern.getState();
      if (!s.repo || !s.graph) return;
      const common = { spice: s.spice, mode: s.mode, noAI: s.demo, date: new Date().toLocaleDateString('en-CA') };
      let body: object;
      if (s.repo.url) {
        // A GitHub repo: the server reads it and inspects it itself, so the share link can be signed.
        body = { url: s.repo.url, ...common };
      } else {
        // An upload: only this browser has the files, so the card uses our numbers and gets no share link.
        const name = (id: string) => s.characters[id]?.name ?? s.repo!.modules.find((m) => m.id === id)?.name ?? id;
        const found = inspect(s.repo.files, s.repo.modules, s.graph, name, (id) => s.characters[id]?.color ?? '#f5a524');
        body = { upload: true, repo: s.repo.name, entries: found.entries, violations: found.violations, modules: found.modules, keys: s.repo.modules.length, ...common };
      }
      // The Landlord's thinking cue while the notice is written.
      const data = await thinkWhile(
        ['landlord'],
        fetch('/api/roast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal })
          .then((r) => r.json())
          .catch(() => null),
      );
      if (ac.signal.aborted) return;
      if (data?.cards) s.setRoast(key, data);
      else setFailed(true);
    }, 0);
    return () => (clearTimeout(t), ac.abort());
  }, [result, key, attempt]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => (ro.disconnect(), window.removeEventListener('keydown', esc));
  }, []);

  const { width, height } = CARD_SIZE[size];
  const scale = room.w ? Math.min(1, room.w / width, room.h / height) : 0;
  const card = result && (clean ? result.cards.clean : result.cards.spicy);
  const payload = result?.links && (clean ? result.links.clean : result.links.spicy);
  const share = payload ? `${window.location.origin}/roast?d=${payload}` : '';
  // Portraits as data URIs, so the downloaded PNG carries them (the SVG faces until they arrive).
  useEffect(() => {
    if (!card) return;
    let live = true;
    void Promise.all([
      Promise.all(card.entries.map(async (e) => [e.name, e.arch ? await portraitUri(e.arch, e.face[0], e.name) : null] as const)),
      portraitUri('landlord', undefined),
    ]).then(([faces, landlord]) => live && setPics({ faces: Object.fromEntries(faces.filter((f): f is [string, string] => !!f[1])), landlord: landlord ?? undefined }));
    return () => void (live = false);
  }, [card]);

  const download = async () => {
    if (!cardEl.current) return;
    setBusy(true);
    try {
      const png = await toPng(cardEl.current, { width, height, pixelRatio: 1, cacheBust: true, fontEmbedCSS: await fontEmbedCSS() });
      const a = document.createElement('a');
      a.href = png;
      a.download = `${repo.name.replace(/\W+/g, '-')}-health-inspection-${size === 'landscape' ? '1200x630' : '1080x1080'}.png`;
      a.click();
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!share) return;
    await navigator.clipboard.writeText(share).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const pill = (on: boolean) => `rounded-full px-3 py-1 text-xs transition-colors ${on ? 'bg-amber text-ink' : 'text-muted hover:text-cream'}`;
  const btn = 'bounce-hover flex items-center gap-1.5 rounded-full border border-edge bg-panel px-3 py-1.5 text-sm text-cream hover:border-amber disabled:opacity-50';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={close}>
      <div className="flex h-full max-h-[820px] w-full max-w-6xl flex-col rounded-2xl bg-panel shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Roast my repo">
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3">
          <Stamp size={18} />
          <span className="font-display text-xl italic">Roast my repo</span>
          <div className="ml-3 flex rounded-full border border-edge p-0.5">
            <button type="button" className={pill(size === 'landscape')} onClick={() => setSize('landscape')}>
              Landscape 1200×630
            </button>
            <button type="button" className={pill(size === 'square')} onClick={() => setSize('square')}>
              Square 1080×1080
            </button>
          </div>
          <label className="ml-2 flex cursor-pointer items-center gap-2 text-sm text-cream">
            <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} className="accent-[#171717]" />
            Clean for sharing
          </label>
          <div className="ml-auto flex gap-2">
            <button type="button" className={btn} disabled={!share} onClick={copy} title={share ? share : 'Share links are only for GitHub repos the server can read and check'}>
              {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? 'Copied' : 'Copy share link'}
            </button>
            <button type="button" className={btn} disabled={!card || busy} onClick={download}>
              <Download size={14} /> {busy ? 'Exporting…' : 'Download PNG'}
            </button>
            <button type="button" aria-label="Close" className="rounded-full p-2 text-muted hover:text-cream" onClick={close}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div ref={frame} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
          {card && scale > 0 ? (
            <div style={{ width: width * scale, height: height * scale }}>
              <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <div ref={cardEl}>
                  <RoastCardView card={card} size={size} fonts={FONTS} qr={share ? qrSvg(share) : undefined} url={window.location.host} faces={pics.faces} landlord={pics.landlord} />
                </div>
              </div>
            </div>
          ) : failed ? (
            <div className="text-center">
              <p className="font-display text-xl text-tomato italic">The inspector didn&rsquo;t show up. Try again in a minute.</p>
              <button type="button" className={`${btn} mx-auto mt-3`} onClick={() => (setFailed(false), setAttempt((a) => a + 1))}>
                <RotateCcw size={14} /> Try again
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Cue id="landlord" size={56} />
              <p className="text-muted italic">The inspector is counting violations.</p>
            </div>
          )}
        </div>
        {result && (
          <div className="border-t border-edge px-4 py-2 text-xs text-muted">
            {result.source === 'templates' ? 'Template lines (the AI was unavailable). ' : ''}
            {result.links
              ? 'Grade, violations and stats were worked out by the server from the repo itself; the lines are the roast.'
              : "This repo was uploaded, so the server can't check it: no share link, but Download PNG works."}
          </div>
        )}
      </div>
    </div>
  );
}
