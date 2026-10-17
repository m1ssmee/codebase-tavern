import { rateLimited } from '@/lib/gemini';
import { llmJSON, llmStream, type Timing } from '@/lib/llm';
import { levelBlock, levelReminder, PLAIN_WORDS, VOICE_GUIDE } from '@/lib/voice';
import { extractCitations, parseCitations } from '@/lib/citations';
import { IDEMPOTENCY_SUGGESTION, isTimeoutOnlyFix, SYMPTOM_FIX_NOTE, TurnScanner } from '@/lib/verdict';
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
  });
const TRIAL_SCHEMA = obj({
  turns: { type: 'array', items: obj({ moduleId: S, text: S, accuses: { type: 'string', description: 'moduleId being accused, or "" if none' } }) },
  verdict: VERDICT,
});
const VERDICT_SCHEMA = obj({ verdict: VERDICT });


type InSuspect = { id: string; title: string; personality: string; files: { path: string; content: string; truncated?: boolean }[]; allPaths: string[] };
const numbered = (code: string) =>
  code
    .replace(/\n$/, '')
    .split('\n')
    .map((l, i) => `${i + 1}| ${l}`)
    .join('\n');

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
      return Response.json({ suspects, timings }); // timings: diagnostics only
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
- verdict.rootCause: ${b.mode === 'expert' ? '2 plain sentences, no jokes, exact mechanism.' : '2-3 plain sentences a beginner can follow, no jokes: plain words, and every technical term defined in parentheses (not square brackets) on first use (e.g. "idempotency key (a unique ID that lets a service spot a repeated request)").'} verdict.evidence: the key citations from any suspect. verdict.fix: one small unified diff to one file shown that changes behaviour; never a diff that only edits comments. Context lines must match the code shown. Prefer the fix that removes the root cause over one that hides the symptom (e.g. an idempotency key over a longer timeout). If both matter, put the root-cause fix first and mention the other in one line. Never make a longer timeout the main fix when the evidence shows a retry without an idempotency key. Fix the duplicate first. verdict.judgeLine: one dry closing sentence from the judge.
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

    type Out = { turns: { moduleId: string; text: string; accuses: string }[]; verdict: { culprits: string[]; rootCause: string; evidence: Citation[]; fix: { path: string; diff: string }; judgeLine: string } };
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
          // Fix quality, enforced: a timeout-only fix for a retry/duplicate bug gets one verdict regeneration.
          let symptomOnly = isTimeoutOnlyFix(str(v?.fix?.diff, 4000), hearing);
          let fixCheck: 'ok' | 'regenerated' | 'kept-timeout-fix' = 'ok';
          if (symptomOnly) {
            const left = 56_000 - (Date.now() - started); // stay inside maxDuration
            console.warn(`[tribunal] timeout-only fix rejected; ${left > 10_000 ? 'regenerating the verdict once' : 'no time left to regenerate'}`);
            if (left > 10_000) {
              try {
                const turnsText = (out?.turns ?? []).map((t) => `${t?.moduleId}: ${t?.text}`).join('\n');
                const again = await llmJSON<{ verdict: Out['verdict'] }>('tribunal-verdict-retry', {
                  system,
                  prompt: `${prompt}\n\nThe hearing so far:\n${turnsText}\n\n${SYMPTOM_FIX_NOTE} Return only the verdict.`,
                  schema: VERDICT_SCHEMA,
                  timeoutMs: left,
                  timings,
                });
                if (again?.verdict) {
                  v = again.verdict;
                  fixCheck = 'regenerated';
                  symptomOnly = isTimeoutOnlyFix(str(v.fix?.diff, 4000), hearing);
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
          };
          // Still a symptom fix after the retry: keep it, but say what the real fix is.
          if (symptomOnly) {
            verdict.rootCause += IDEMPOTENCY_SUGGESTION;
            fixCheck = 'kept-timeout-fix';
          }
          if (sent < 2 || !verdict.culprits.length) throw new Error('trial output unusable');
          send({ type: 'verdict', verdict, fixCheck }); // fixCheck: diagnostics only
        } catch (err) {
          console.error('[tribunal] trial failed mid-stream:', err);
          send({ type: 'error' });
        }
        const summary = { firstTurnMs, totalMs: Date.now() - started, calls: timings };
        console.info('[tribunal] trial timings', JSON.stringify({ suspects: ids, ...summary }));
        send({ type: 'timings', ...summary });
        controller.close();
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[tribunal] failed:', err);
    return Response.json({ error: 'tribunal failed' }, { status: 502 });
  }
}
