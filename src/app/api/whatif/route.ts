import { rateLimited } from '@/lib/gemini';
import { llmJSON, llmStream, parseJSON, type Timing } from '@/lib/llm';
import { levelBlock, PLAIN_WORDS, VOICE_GUIDE } from '@/lib/voice';
import { CiteChecker, parseCitations } from '@/lib/citations';
import { editLines } from '@/lib/editor';
import { codeFacts, knownNumbers, numbersIn, unswear } from '@/lib/guards';
import { applyDiff, makeDiff, parseDiff } from '@/lib/diff';
import { TurnScanner } from '@/lib/verdict';

export const runtime = 'nodejs';
export const maxDuration = 60;

// "What if I change this?": at most two LLM calls. Stage "diff" (only when the change is a description) writes a
// small unified diff, validated against the real file. The client then works out the impact list from the graph
// (deterministic, the ground truth) and stage "assess" judges each module in it, streamed as NDJSON per item.

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const arr = <T,>(v: unknown, n: number): T[] => (Array.isArray(v) ? v.slice(0, n) : []);
const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const S = { type: 'string' };
const VERDICTS = ['breaks', 'at risk', 'fine', 'relieved'] as const;
const DIFF_SCHEMA = obj({ title: S, diff: { type: 'string', description: 'Unified diff: ---/+++ headers, @@ hunks, then " "/-/+ lines.' } });
const ASSESS_SCHEMA = obj({
  items: { type: 'array', items: obj({ moduleId: S, verdict: { type: 'string', enum: [...VERDICTS] }, reason: S, reaction: { type: 'array', items: S, description: '3 variants of the reaction' } }) },
  summary: obj({
    update: S,
    check: S,
    followUps: { type: 'array', items: obj({ moduleId: S, path: S, description: S }), description: 'Other modules that must change for this change to work; [] when complete.' },
  }),
});

const numbered = (lines: string[], first = 1) => lines.map((l, i) => `${first + i}| ${l}`).join('\n');
const publicTimings = (ts: Timing[]) => ts.map((t) => ({ label: t.label, provider: t.provider, ok: t.ok, ms: t.ms, firstChunkMs: t.firstChunkMs, totalMs: t.totalMs }));

export function GET(req: Request) {
  if (new URL(req.url).searchParams.get('warm') !== '1') return new Response('Method Not Allowed', { status: 405 });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: 'busy' }, { status: 429 });
  const b = await req.json().catch(() => null);
  if (b?.stage === 'diff') return writeDiff(b);
  if (b?.stage === 'assess') return assess(b);
  return Response.json({ error: 'bad request' }, { status: 400 });
}

/** Call 1: description → one small diff to one file, checked against the real file before anyone sees it. */
async function writeDiff(b: Record<string, unknown>) {
  const path = str(b.path, 300);
  const content = str(b.content, 400_000);
  const description = str(b.description, 400).trim();
  if (!path || !content || !description) return Response.json({ error: 'bad request' }, { status: 400 });
  const lines = content.split('\n');
  const start = Math.max(1, Math.min(Number(b.startLine) || 1, lines.length));
  const end = Math.max(start, Math.min(Number(b.endLine) || start, lines.length));
  // A window around the selection keeps the prompt small; hunks are located by context, so numbers needn't match.
  const from = Math.max(1, start - 120);
  const window = lines.slice(from - 1, Math.min(lines.length, end + 120));
  const system = `You write one small unified diff for a change a developer wants to preview. Nothing is applied.
- Change only ${path}, as few lines as possible, in the file's own style. Do not fix other problems.
- Context lines start with a space and are copied exactly from the file, without the line numbers. Use "--- a/${path}" and "+++ b/${path}" headers and @@ hunks.
- If the request is unclear, make the smallest change that matches it.
- Reuse the file's existing functions, types and storage where you can (e.g. record a field next to the data the module already keeps) instead of adding new machinery.
- title: under 10 plain words naming the change with real names and values, e.g. "Raise UPSTREAM_TIMEOUT_MS to 5000".`;
  const prompt = `Request: ${description}\nSelected lines: ${path}:${start}-${end}\n\n=== ${path} (lines ${from}-${from + window.length - 1}) ===\n${numbered(window, from)}`;
  const started = Date.now();
  try {
    // The diff must apply cleanly to the real file; if it doesn't, one regeneration with the reason.
    let note = '';
    for (let attempt = 1; ; attempt++) {
      const out = await llmJSON<{ title: string; diff: string }>('whatif-diff', { system, prompt: prompt + note, schema: DIFF_SCHEMA, timeoutMs: Math.min(30_000, 55_000 - (Date.now() - started)) });
      const fd = parseDiff(str(out?.diff, 8000), path).find((f) => f.path === path || path.endsWith('/' + f.path) || !f.path);
      const applied = fd && applyDiff(content, { ...fd, path });
      if (applied && !('error' in applied) && applied.added + applied.removed > 0)
        return Response.json({ title: str(out.title, 120).trim() || description.slice(0, 80), diff: makeDiff(path, content, applied.text) });
      const why = applied && 'error' in applied ? applied.error : `the diff changes nothing in ${path}`;
      const again = attempt === 1 && Date.now() - started < 30_000;
      console.warn(`[whatif] diff did not apply (${why}); ${again ? 'regenerating once' : 'giving up'}`);
      if (!again) return Response.json({ error: 'unusable' }, { status: 422 });
      note = `\n\nYour previous diff was rejected: ${why}. Copy every context and "-" line exactly from the numbered file above, without the line numbers, and change ${path} only.\nPrevious diff:\n${str(out?.diff, 4000)}`;
    }
  } catch (err) {
    console.error('[whatif] diff failed:', err);
    return Response.json({ error: 'llm failed' }, { status: 502 });
  }
}

// A reaction when none of the 3 variants survive: the module's own first listed line, stated flatly.
const REACT: Record<string, [string, string]> = {
  breaks: ['{at} is where this breaks, and I am standing on it.', '{at} is where this breaks, and I am standing on the damn thing.'],
  'at risk': ['{at} still works. For now. I have heard that before.', '{at} still works. For now. I have heard that shit before.'],
  fine: ['Nothing at {at} changes. I will be over here.', 'Nothing at {at} changes. Leave me the hell out of it.'],
  relieved: ['{at} finally stops being my problem.', '{at} finally stops being my damn problem.'],
};
function reactionFallback(i: { name: string; lines: Cite[] }, verdict: string, level: string): string {
  const c = i.lines[0];
  const at = c ? `${c.path.slice(c.path.lastIndexOf('/') + 1)} line ${Number(c.line) || 1}` : i.name.split(',')[0];
  const t = (REACT[verdict] ?? REACT['at risk'])[level === 'clean' ? 0 : 1].replace('{at}', at);
  return t[0].toUpperCase() + t.slice(1);
}

type InItem = { moduleId: string; name: string; role: string; hops: number; via?: string; why: string; lines: Cite[]; usages: (Cite & { symbol: string })[] };
type Cite = { path: string; line: number; endLine: number; code?: string };

/** Call 2: one verdict per module in the deterministic list, streamed as each one closes. */
async function assess(b: Record<string, unknown>) {
  const cite = (c: Cite) => `[${str(c?.path, 300)}:${Number(c?.line) || 1}${Number(c?.endLine) > Number(c?.line) ? `-${Number(c.endLine)}` : ''}]`;
  const items = arr<InItem>(b.items, 12).map((i) => ({
    moduleId: str(i?.moduleId, 200),
    name: str(i?.name, 100),
    role: ['changed', 'upstream', 'downstream'].includes(i?.role) ? i.role : 'upstream',
    hops: Math.max(0, Math.min(9, Number(i?.hops) || 0)),
    via: str(i?.via, 200),
    why: str(i?.why, 200),
    lines: arr<Cite>(i?.lines, 8),
    usages: arr<Cite & { symbol: string }>(i?.usages, 16),
  }));
  const ids = items.map((i) => i.moduleId).filter(Boolean);
  // Models sometimes answer with the module's plain name ("root" for "(root)"): map those back to the id.
  const alias = new Map(items.flatMap((i) => [[i.moduleId, i.moduleId], [i.moduleId.replace(/[()]/g, ''), i.moduleId], [i.name.split(',')[0].trim(), i.moduleId]]).map(([k, v]) => [k.toLowerCase(), v]));
  const diff = str(b.diff, 8000);
  if (!ids.length || !diff) return Response.json({ error: 'bad request' }, { status: 400 });

  let budget = 110_000; // trust boundary: the code we show is re-capped here
  const files = arr<{ path: string; content: string }>(b.files, 40).flatMap((f) => {
    const content = str(f?.content, Math.max(0, budget));
    budget -= content.length;
    return content ? [{ path: str(f?.path, 300), lines: content.replace(/\n$/, '').split('\n'), truncated: content.length < (f?.content?.length ?? 0) }] : [];
  });
  const lineCount = new Map(files.map((f) => [f.path, f.lines.length]));
  // Keep only citations to code the model was shown, each checked against the lines it points at.
  const checker = new CiteChecker(new Map(files.map((f) => [f.path, f.lines])));
  const clean = (text: string, keepCites = true) =>
    parseCitations(keepCites ? checker.text(text) : text)
      .map((seg) =>
        typeof seg === 'string'
          ? seg
          : keepCites && seg.startLine >= 1 && seg.endLine <= (lineCount.get(seg.path) ?? 0)
            ? `[${seg.path}:${seg.startLine}${seg.endLine !== seg.startLine ? `-${seg.endLine}` : ''}]`
            : '',
      )
      .join('')
      .replace(/ +([.,;])/g, '$1')
      .trim();
  const beginner = b.mode !== 'expert';
  const level = typeof b.spice === 'string' && ['clean', 'unhinged', 'feral', 'nuclear'].includes(b.spice) ? b.spice : 'unhinged';

  const system = `You narrate "What if I change this?" in Codebase Tavern: code modules are characters, and a developer is previewing a change. Nothing has been applied.

${levelBlock(b.spice)}
- Here the reaction is the only place for swearing and attitude: at this level each reaction carries it. The reason and summary sentences stay plain, clear and free of swearing at every level.

${VOICE_GUIDE}

Rules:
- Return exactly one item per module in the impact list, with the same moduleId, in the same order. Never add a module. Code from other modules is evidence only: cite it, but never give those modules a verdict.
- The diff may be several stacked changes: judge them together, as one change.
- Judge against the code as it is. A limitation the module already has (for example it keeps all its data only in memory, like an in-memory ledger) is not a new risk when the change follows the same approach; mention it at most as a follow-up note.
- verdict:
  - "breaks": after the change this module's code fails or misbehaves (it still uses a renamed or deleted symbol, reads a field that is gone, gets input it rejects).
  - "at risk": it still works, but an assumption it relies on becomes fragile (timing, a missing check, a problem now hidden instead of fixed).
  - "fine": nothing it does changes in practice.
  - "relieved": the change removes a problem it had or makes its job safer, even if follow-up work remains (say what).
  - A module whose problem is only made rarer, not removed, is "at risk", never "relieved".
- reason: 1-2 plain sentences${beginner ? ' a beginner can follow (define technical terms in parentheses on first use, never square brackets)' : ''}, citing [path:line] or [path:start-end] from the numbered code below. Use the lines listed for that module where they apply. Never invent code.
- reaction: 3 variants of one line in that module's own voice, first person, under 25 words, at the active spice level, each built on a real fact (a number, a name, a line) and each a different joke; an editor picks the best. No citations in the reaction.
- If the change makes a failure rarer without removing its cause (for example a longer timeout while a retry without an idempotency key still exists), say it hides the problem rather than fixing it, and name the failure that remains and when it still happens (e.g. "a charge slower than 5000ms is still sent twice"). Say this in the affected modules' reasons, in at least one reaction, and in the first sentence of summary.update. Check the numbers in the code (timeouts, typical and worst-case times) before saying a change makes something more or less likely.
- Remember how timeouts work across services: when a caller stops waiting, the service it called may still finish the work. A caller that then retries without an idempotency key (a unique ID that lets the receiver spot a repeat) can make the work happen twice, e.g. a second charge. Use this when a change touches timeouts or retries.
- summary.update: 1-3 sentences: what else must change for this to be complete (files and functions), with citations.
- summary.check: 1-3 sentences: which tests to run or add and which behaviours to verify.
- summary.followUps: one entry per module in the list that must also change for this change to actually work (for example it now receives a field it ignores, or calls something that does not exist yet): moduleId from the list, path = that module's file shown above that needs the change, description = one imperative sentence under 25 words naming the exact function and field (e.g. "Make processCharge() return the earlier charge when idempotency_key was already recorded."). Leave it empty when the change works on its own.${beginner ? `\n- ${PLAIN_WORDS}` : ''}`;

  const prompt = `Repo: ${str(b.repoName, 200)}
Change: ${str(b.title, 200)}
Diff (a preview, not applied):
${diff}

Impact list (from the import graph; comment on these modules only):
${items
  .map((i) => {
    const role = i.role === 'changed' ? 'changed by this diff' : i.role === 'upstream' ? `upstream, ${i.hops} hop${i.hops === 1 ? '' : 's'}: ${i.why}` : `downstream: ${i.why}`;
    const lines = i.lines.map((c) => `    ${cite(c)} ${str(c.code, 160)}`).join('\n');
    const uses = i.usages.map((u) => `    uses ${str(u.symbol, 80)} at ${cite(u)} ${str(u.code, 160)}`).join('\n');
    return `- ${i.moduleId} ("${i.name}"): ${role}\n${lines}${uses ? '\n' + uses : ''}`;
  })
  .join('\n')}

Code (line numbers before "|"):
${files.map((f) => `=== ${f.path}${f.truncated ? ' [truncated]' : ''} ===\n${numbered(f.lines)}`).join('\n\n')}

Reminder: ACTIVE SPICE LEVEL: ${level.toUpperCase()}. ${level === 'clean' ? 'No swearing anywhere.' : 'Swear only in the reactions, at this level; the reason and summary sentences stay plain, with no swearing.'} Cite every claim in reasons and summary. Aim it at the code, never at people.`;

  const started = Date.now();
  const timings: Timing[] = [];
  try {
    const llm = await llmStream('whatif-assess', { system, messages: [{ role: 'user', text: prompt }], schema: ASSESS_SCHEMA, maxTokens: 4000, timeoutMs: 45_000, timings });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
        const scanner = new TurnScanner('items');
        const seen = new Set<string>();
        const reactions = new Map<string, { variants: unknown; verdict: string }>();
        let full = '';
        let firstItemMs: number | undefined;
        const emit = (raw: unknown) => {
          const x = raw as { moduleId?: string; verdict?: string; reason?: string; reaction?: unknown };
          const id = alias.get(str(x?.moduleId, 200).trim().toLowerCase()) ?? '';
          if (!ids.includes(id) || seen.has(id)) return; // only modules in the deterministic list, once each
          seen.add(id);
          firstItemMs ??= Date.now() - started;
          const verdict = (VERDICTS as readonly string[]).includes(x.verdict ?? '') ? x.verdict! : 'at risk';
          reactions.set(id, { variants: x.reaction, verdict });
          // The reaction follows once the comedy editor has picked it (type 'reactions', below).
          send({ type: 'item', item: { moduleId: id, verdict, reason: unswear(clean(str(x.reason, 600))), reaction: '' } }); // reasons stay plain
        };
        try {
          const reader = llm.getReader();
          const dec = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = dec.decode(value, { stream: true });
            full += text;
            scanner.push(text).forEach(emit);
          }
          type Out = { items?: unknown[]; summary?: { update?: string; check?: string; followUps?: unknown } };
          // Unparseable or off-schema: one retry (not streamed); the items already sent stand.
          const parsed = parseJSON(full, ASSESS_SCHEMA);
          let out: Out;
          if (typeof parsed !== 'string') out = parsed.value as Out;
          else {
            const left = 50_000 - (Date.now() - started);
            console.warn(`[whatif] assess returned ${parsed}; ${left > 12_000 ? 'retrying once' : 'too late to retry'}`);
            if (left <= 12_000) throw new Error(`assess output unusable: ${parsed}`);
            out = await llmJSON<Out>('whatif-assess-retry', { system, prompt, schema: ASSESS_SCHEMA, timeoutMs: left, timings });
          }
          arr(out?.items, 12).forEach(emit); // anything the scanner missed
          // One verdict per listed module is part of the contract: a skipped module counts as a schema failure, asked once.
          const missing = ids.filter((id) => !seen.has(id));
          const left = 50_000 - (Date.now() - started);
          if (missing.length && left > 12_000) {
            console.warn(`[whatif] assess skipped ${missing.join(', ')}; asking once for those`);
            try {
              const again = await llmJSON<Out>('whatif-assess-missing', {
                system,
                prompt: `${prompt}\n\nYour previous answer skipped these modules from the impact list: ${missing.join(', ')}. Return items for exactly those modules.`,
                schema: ASSESS_SCHEMA,
                timeoutMs: left - 8_000,
                timings,
              });
              arr(again?.items, 12).forEach(emit);
            } catch (err) {
              console.warn('[whatif] asking for the skipped modules failed:', String(err).slice(0, 160));
            }
          }
          // Follow-ups: only modules in the list, only files the model was shown, once per module.
          const followUps = arr<{ moduleId?: string; path?: string; description?: string }>(out?.summary?.followUps, 4)
            .map((f) => ({ moduleId: alias.get(str(f?.moduleId, 200).trim().toLowerCase()) ?? '', path: str(f?.path, 300), description: clean(str(f?.description, 240), false) }))
            .filter((f, i, all) => ids.includes(f.moduleId) && lineCount.has(f.path) && f.description && all.findIndex((x) => x.moduleId === f.moduleId) === i);
          send({ type: 'summary', summary: { update: unswear(clean(str(out?.summary?.update, 800))), check: unswear(clean(str(out?.summary?.check, 800))), followUps } });
          // Reactions: 3 variants each → the filter → the comedy editor; no survivor → a template on the module's own line.
          const known = knownNumbers(prompt);
          const facts = codeFacts(prompt);
          // A real fact for a reaction: a module's name, a code name or number from the diff, or from that module's own lines.
          const codeWords = (t: string) => [...(t.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((w) => w.length > 3 && /_|[a-z][A-Z]|^[A-Z]{2,}/.test(w)), ...numbersIn(t).filter((x) => Number(x) >= 10)];
          const changed = diff.split('\n').filter((l) => /^[+-](?![+-])/.test(l)).join(' ');
          const shared = [...items.map((i) => i.name.split(',')[0].trim()), ...items.map((i) => i.moduleId), ...codeWords(changed)];
          const own = (i: (typeof items)[number]) => [...i.lines.map((c) => `${str(c.code, 160)} ${c.path.split('/').pop()}`), ...i.usages.map((u) => `${str(u.symbol, 80)} ${str(u.code, 160)}`)].flatMap((t) => [...codeWords(t), ...t.split(/\s+/).filter((w) => /\.\w{1,4}$/.test(w))]);
          const picked = await editLines(
            'whatif',
            [...reactions].map(([id, r]) => {
              const it = items.find((i) => i.moduleId === id)!;
              return { id, variants: r.variants, rules: { needs: [...shared, ...own(it)], facts, source: prompt, known, clean: level === 'clean', maxWords: 28 }, about: `${it.name}: ${r.verdict}` };
            }),
            level,
            Math.min(6000, 55_000 - (Date.now() - started)),
            (x) => clean(str(x, 240), false),
          );
          send({ type: 'reactions', reactions: Object.fromEntries([...reactions].map(([id, r]) => [id, picked.get(id) ?? reactionFallback(items.find((i) => i.moduleId === id)!, r.verdict, level)])) });
        } catch (err) {
          console.error('[whatif] assess failed mid-stream:', err);
          send({ type: 'error' });
        }
        console.info('[cites] whatif', JSON.stringify(checker.counts), checker.changes.join('; '));
        const summary = { firstItemMs, totalMs: Date.now() - started, items: seen.size, of: ids.length };
        console.info('[whatif] assess timings', JSON.stringify({ ...summary, calls: timings }));
        send({ type: 'timings', ...summary, calls: publicTimings(timings) });
        controller.close();
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[whatif] assess failed:', err);
    return Response.json({ error: 'llm failed' }, { status: 502 });
  }
}
