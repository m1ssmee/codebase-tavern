import { rateLimited } from '@/lib/gemini';
import { llmJSON, llmStream, type Timing } from '@/lib/llm';
import { levelBlock, levelReminder, PLAIN_WORDS, VOICE_GUIDE } from '@/lib/voice';
import { extractCitations, parseCitations } from '@/lib/citations';
import { fixProblem, realFixNeeded, rejectNote, TurnScanner } from '@/lib/verdict';
import { participantId, parseSequence, sanitizeDiagram } from '@/lib/diagram';
import type { Citation } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Two LLM calls total, one per stage: "suspects" picks 2-4 modules, "trial" runs the hearing + verdict.
// The client runs them in order (it holds the repo; only the suspects' code is uploaded for the trial).

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const arr = <T,>(v: unknown, n: number): T[] => (Array.isArray(v) ? v.slice(0, n) : []);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
// Trust boundary: only known numeric stats reach the prompt.
const cleanStats = (s: Record<string, unknown> | undefined) => ({
  fileCount: num(s?.fileCount),
  totalLines: num(s?.totalLines),
  todoCount: num(s?.todoCount),
  maxNesting: num(s?.maxNesting),
  hasTests: s?.hasTests === true,
  biggestFile: { path: str((s?.biggestFile as { path?: unknown })?.path, 200), lines: num((s?.biggestFile as { lines?: unknown })?.lines) },
});
const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const S = { type: 'string' };
const CITE = obj({ path: S, startLine: { type: 'integer' }, endLine: { type: 'integer' } });

const SUSPECTS_SCHEMA = obj({ suspects: { type: 'array', items: obj({ moduleId: S, reason: S }) } });
const VERDICT = obj({
    culprits: { type: 'array', items: S },
    rootCause: S,
    evidence: { type: 'array', items: CITE },
    fix: obj({ path: S, diff: { type: 'string', description: 'Small unified diff (---/+++/@@ lines, then -/+ lines).' } }),
    judgeLine: S,
    diagram: { type: 'string', description: 'Mermaid sequenceDiagram of how the bug happens (see the rules).' },
  });
const TRIAL_SCHEMA = obj({
  turns: { type: 'array', items: obj({ moduleId: S, text: S, accuses: { type: 'string', description: 'moduleId being accused, or "" if none' } }) },
  verdict: VERDICT,
});
const VERDICT_SCHEMA = obj({ verdict: VERDICT });


type InSuspect = { id: string; title: string; personality: string; files: { path: string; content: string; truncated?: boolean }[]; allPaths: string[] };
// Timings for the client: provider, model and durations only. Raw provider errors stay in the server log.
const publicTimings = (ts: Timing[]) =>
  ts.map((t) => ({ label: t.label, provider: t.provider, ok: t.ok, ms: t.ms, firstChunkMs: t.firstChunkMs, totalMs: t.totalMs }));

/**
 * The verdict's sequence diagram, made safe: no click/init/HTML/URLs, only citations to code the court saw, and a
 * "Where it all went wrong" label in every rect. The client still runs mermaid.parse and drops it if invalid.
 */
function cleanDiagram(raw: string, ok: (c: Citation) => boolean): string {
  const text = sanitizeDiagram(raw);
  if (!/^sequenceDiagram\b/.test(text) || !parseSequence(text).length) return '';
  const out: string[] = [];
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    const c = l.match(/^\s*%%\s*cite\s+([^\s:]+):(\d+)(?:-(\d+))?\s*$/);
    if (c && !ok({ path: c[1], startLine: Number(c[2]), endLine: Number(c[3] ?? c[2]) })) return;
    if (/^\s*%%/.test(l) && !c) return; // other comments can carry directives
    out.push(l);
    if (/^\s*rect\b/.test(l) && !/went wrong/i.test(lines[i + 1] ?? '')) {
      const m = lines.slice(i + 1).join('\n').match(/^\s*(\w+)\s*-[->x)]+[+-]?\s*(\w+)\s*:/m);
      if (m) out.push(`  Note over ${m[1] === m[2] ? m[1] : `${m[1]},${m[2]}`}: Where it all went wrong`);
    }
  });
  return out.slice(0, 80).join('\n');
}

const numbered = (code: string) =>
  code
    .replace(/\n$/, '')
    .split('\n')
    .map((l, i) => `${i + 1}| ${l}`)
    .join('\n');

// Pre-warm: /tavern pings this on load so the function is warm before the first click. No model call.
export function GET(req: Request) {
  if (new URL(req.url).searchParams.get('warm') !== '1') return new Response('Method Not Allowed', { status: 405 });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: 'busy' }, { status: 429 });
  const b = await req.json().catch(() => null);
  const bug = str(b?.bug, 500).trim();
  if (!bug) return Response.json({ error: 'bad request' }, { status: 400 });

  try {
    if (b.stage === 'suspects') {
      const modules = arr<{ id: string; title: string; path: string; stats: Record<string, unknown>; filePaths: string[] }>(b.modules, 8).map((m) => ({
        moduleId: str(m?.id, 200),
        title: str(m?.title, 100),
        path: str(m?.path, 200),
        stats: cleanStats(m?.stats),
        files: arr<string>(m?.filePaths, 60).map((p) => str(p, 200)),
      }));
      const ids = modules.map((m) => m.moduleId);
      const t0 = Date.now();
      const timings: Timing[] = [];
      const out = await llmJSON<{ suspects: { moduleId: string; reason: string }[] }>('tribunal-suspects', {
        timings,
        system: 'You triage bug reports for a codebase. Pick the 2-4 modules most likely involved, including modules whose interaction could cause the bug (callers, callees, timeouts, retries, shared state). Use only the moduleId values given.',
        prompt: `Bug: ${bug}\n\nModules:\n${JSON.stringify(modules)}`,
        schema: SUSPECTS_SCHEMA,
      });
      let suspects = [...new Set(arr<{ moduleId: string }>(out?.suspects, 6).map((s) => s?.moduleId).filter((id) => ids.includes(id)))].slice(0, 4);
      // Always a trial: pad with the biggest remaining modules (client sends them sorted by size).
      for (const id of ids) if (suspects.length < 2 && !suspects.includes(id)) suspects.push(id);
      suspects = suspects.slice(0, 4);
      console.info('[tribunal] suspects timings', JSON.stringify({ totalMs: Date.now() - t0, calls: timings }));
      return Response.json({ suspects, timings: publicTimings(timings) }); // timings: diagnostics only
    }

    // --- trial
    let budget = 130_000; // ~120KB of code plus slack, re-capped here (trust boundary)
    const suspects = arr<InSuspect>(b.suspects, 4).map((s) => ({
      id: str(s?.id, 200),
      title: str(s?.title, 100),
      personality: str(s?.personality, 300),
      allPaths: arr<string>(s?.allPaths, 300).map((p) => str(p, 300)),
      files: arr<InSuspect['files'][number]>(s?.files, 100).flatMap((f) => {
        const content = str(f?.content, Math.max(0, budget));
        budget -= content.length;
        return content ? [{ path: str(f?.path, 300), content, truncated: !!f?.truncated || content.length < (f?.content?.length ?? 0) }] : [];
      }),
    }));
    if (suspects.length < 2) return Response.json({ error: 'bad request' }, { status: 400 });
    const ids = suspects.map((s) => s.id);
    // Line counts of what the model actually saw: the only citations we can vouch for.
    const lines = new Map(suspects.flatMap((s) => s.files.map((f) => [f.path, f.content.replace(/\n$/, '').split('\n').length] as const)));
    const owner = new Map(suspects.flatMap((s) => s.files.map((f) => [f.path, s.id] as const)));
    const ok = (c: Citation, speaker?: string) => {
      const n = lines.get(c.path);
      return !!n && c.startLine >= 1 && c.endLine <= n && (!speaker || owner.get(c.path) === speaker);
    };
    // Drop invalid citations from text (unknown path, bad lines, or another module's file).
    const clean = (text: string, speaker: string) =>
      parseCitations(text)
        .map((seg) => (typeof seg === 'string' ? seg : ok(seg, speaker) ? `[${seg.path}:${seg.startLine}${seg.endLine !== seg.startLine ? `-${seg.endLine}` : ''}]` : ''))
        .join('')
        .replace(/ +([.,;])/g, '$1');

    const system = `You run the Incident Tribunal in Codebase Tavern: code modules, played as characters, argue about who caused a bug.

${levelBlock(b.spice)}
- In the turns, every module speaks at this level. The rootCause stays plain and professional; the judgeLine follows the level${b.spice === 'nuclear' ? ' (the judge swears too)' : ''}.

${VOICE_GUIDE}

Rules:
- Find the real root cause from the code, comments and logs shown. Bugs often come from how modules interact: compare timeouts with processing times, look for retries without idempotency keys, check logs for duplicates.
- Turns stay short and avoid undefined jargon${b.mode === 'expert' ? '' : ` (plain words, or define the term in parentheses, never square brackets). ${PLAIN_WORDS}`}; swearing adds emphasis, never replaces information.
- turns: 6-8 items in two rounds. Round 1: every suspect speaks once (defends itself or accuses another). Round 2: rebuttals. Each turn is 2-3 sentences, first person, in that module's voice.
- In a turn, cite [path:line] or [path:start-end] ONLY from the speaker's own files, using the line numbers shown before "|". Never invent code.
- accuses: the moduleId being accused in that turn, or "" if none.
- verdict.culprits: every moduleId whose code is needed for the bug to happen (often more than one).
- verdict.rootCause: ${b.mode === 'expert' ? '2 plain sentences, no jokes, exact mechanism.' : '2-3 plain sentences a beginner can follow, no jokes: plain words, and every technical term defined in parentheses (not square brackets) on first use (e.g. "idempotency key (a unique ID that lets a service spot a repeated request)").'} verdict.evidence: the key citations from any suspect. verdict.fix: one small unified diff to one file shown that changes executable code in at least one culprit module; a diff that only touches comments, whitespace or tests is rejected (tests may be added alongside a real code change). Context lines must match the code shown. Prefer the fix that removes the root cause over one that hides the symptom (e.g. an idempotency key over a longer timeout). If both matter, put the root-cause fix first and mention the other in one line. Never make a longer timeout the main fix when the evidence shows a retry without an idempotency key. Fix the duplicate first. verdict.judgeLine: one dry closing sentence from the judge.
- verdict.diagram: a Mermaid sequenceDiagram showing how the bug happens, step by step, at most 10 messages:
  - First line "sequenceDiagram". One "participant <id> as <title>" line per module involved, using these ids and titles: ${suspects.map((sp) => `${participantId(sp.id)} as ${sp.title.replace(/[:;#]/g, ' ')}`).join('; ')}.
  - Messages ("A->>B: text", "B-->>A: text" for replies) are strictly factual, from the code shown, with real values (function names, 2000ms, field names). Directly under each message, a line "%% cite path:start-end" pointing at the code that does it.
  - 2-4 "Note over <id>: ..." lines (at most two ids per note) with short in-character remarks at key moments (the spice level applies).
  - Wrap the fatal step(s) in "rect rgb(255, 228, 222)" ... "end", with "Note over <ids>: Where it all went wrong" as the first line inside.
  - Nothing else: no click, links, HTML, styling or init lines.
- Use only these moduleIds: ${ids.join(', ')}.`;

    const prompt = `Bug report: ${bug}

Suspects:
${suspects
  .map(
    (s) => `### ${s.id} ("${s.title}") ${s.personality}
Files: ${s.allPaths.join(', ')}
${s.files.map((f) => `=== ${f.path}${f.truncated ? ' [truncated]' : ''} ===\n${numbered(f.content)}`).join('\n\n')}`,
  )
  .join('\n\n')}

${levelReminder(b.spice)}`;

    type Out = { turns: { moduleId: string; text: string; accuses: string }[]; verdict: { culprits: string[]; rootCause: string; evidence: Citation[]; fix: { path: string; diff: string }; judgeLine: string; diagram?: string } };
    const started = Date.now();
    const timings: Timing[] = [];
    // Call 2 streams schema-enforced JSON; provider errors throw here (before anything is sent).
    const llm = await llmStream('tribunal-trial', { system, messages: [{ role: 'user', text: prompt }], schema: TRIAL_SCHEMA, maxTokens: 6000, timeoutMs: 45_000, timings });
    const cleanTurn = (t: unknown) => {
      const x = t as Out['turns'][number];
      if (!x || !ids.includes(x.moduleId) || !str(x.text, 10)) return null;
      return { moduleId: x.moduleId, text: clean(str(x.text, 600), x.moduleId), accuses: ids.includes(x.accuses) && x.accuses !== x.moduleId ? x.accuses : undefined };
    };

    // NDJSON to the client: {type:'turn'} per turn the moment it closes, then {type:'verdict'}, then {type:'timings'}.
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
        const scanner = new TurnScanner();
        let full = '';
        let sent = 0;
        let firstTurnMs: number | undefined;
        let regenerated = false;
        try {
          const reader = llm.getReader();
          const dec = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = dec.decode(value, { stream: true });
            full += text;
            for (const raw of scanner.push(text)) {
              const turn = cleanTurn(raw);
              if (!turn || sent >= 8) continue;
              firstTurnMs ??= Date.now() - started;
              send({ type: 'turn', turn });
              sent++;
            }
          }
          const out = JSON.parse(full) as Out;
          const hearing = [out?.verdict?.rootCause, ...(out?.turns ?? []).map((t) => t?.text), ...(out?.verdict?.evidence ?? []).map((c) => c?.path)].join(' ');
          let v = out?.verdict;
          // Fix quality, enforced: the fix must change executable code in a culprit module (not only comments,
          // whitespace or tests, and not a timeout bump on a retry/duplicate bug). One regeneration, with the reason.
          const culpritFiles = (x?: Out['verdict']) =>
            suspects.filter((sp) => arr<string>(x?.culprits, 4).includes(sp.id)).flatMap((sp) => [...sp.allPaths, ...sp.files.map((f) => f.path)]);
          let problem = fixProblem({ path: str(v?.fix?.path, 300), diff: str(v?.fix?.diff, 4000) }, culpritFiles(v), hearing);
          let fixCheck: 'ok' | 'regenerated' | 'kept-bad-fix' = 'ok';
          if (problem) {
            const left = 56_000 - (Date.now() - started); // stay inside maxDuration
            console.warn(`[tribunal] fix rejected (${problem}); ${left > 10_000 ? 'regenerating the verdict once' : 'no time left to regenerate'}`);
            if (left > 10_000) {
              try {
                const turnsText = (out?.turns ?? []).map((t) => `${t?.moduleId}: ${t?.text}`).join('\n');
                const again = await llmJSON<{ verdict: Out['verdict'] }>('tribunal-verdict-retry', {
                  system,
                  prompt: `${prompt}\n\nThe hearing so far:\n${turnsText}\n\n${rejectNote(problem)} Return only the verdict.`,
                  schema: VERDICT_SCHEMA,
                  timeoutMs: left,
                  timings,
                });
                if (again?.verdict) {
                  v = again.verdict;
                  fixCheck = 'regenerated';
                  regenerated = true;
                  problem = fixProblem({ path: str(v.fix?.path, 300), diff: str(v.fix?.diff, 4000) }, culpritFiles(v), hearing);
                }
              } catch (err) {
                console.error('[tribunal] verdict regeneration failed, keeping the first verdict:', err);
              }
            }
          }
          const verdict = {
            culprits: [...new Set(arr<string>(v?.culprits, 4).filter((id) => ids.includes(id)))],
            rootCause: str(v?.rootCause, 600),
            evidence: [
              ...arr<Citation>(v?.evidence, 10),
              ...extractCitations(str(v?.rootCause, 600)), // the model sometimes cites inline instead
            ].filter((c) => c && ok({ path: str(c.path, 300), startLine: Number(c.startLine), endLine: Number(c.endLine) })),
            fix: { path: str(v?.fix?.path, 300), diff: str(v?.fix?.diff, 4000) },
            judgeLine: str(v?.judgeLine, 300),
            diagram: cleanDiagram(str(v?.diagram, 6000), ok),
          };
          // Still unacceptable after the retry: keep it, but say what the real code change is.
          if (problem) {
            verdict.rootCause += realFixNeeded(hearing, verdict.culprits);
            fixCheck = 'kept-bad-fix';
          }
          if (sent < 2 || !verdict.culprits.length) throw new Error('trial output unusable');
          send({ type: 'verdict', verdict, fixCheck, fixIssue: problem }); // fixCheck/fixIssue: diagnostics only
        } catch (err) {
          console.error('[tribunal] trial failed mid-stream:', err);
          send({ type: 'error' });
        }
        const summary = { firstTurnMs, totalMs: Date.now() - started, regenerated, calls: timings };
        console.info('[tribunal] trial timings', JSON.stringify({ suspects: ids, ...summary }));
        send({ type: 'timings', ...summary, calls: publicTimings(timings) });
        controller.close();
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[tribunal] failed:', err);
    return Response.json({ error: 'tribunal failed' }, { status: 502 });
  }
}
