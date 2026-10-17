import { rateLimited } from '@/lib/gemini';
import { llmJSON } from '@/lib/llm';
import { VOICE_GUIDE } from '@/lib/voice';
import { extractCitations, parseCitations } from '@/lib/citations';
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
const TRIAL_SCHEMA = obj({
  turns: { type: 'array', items: obj({ moduleId: S, text: S, accuses: { type: 'string', description: 'moduleId being accused, or "" if none' } }) },
  verdict: obj({
    culprits: { type: 'array', items: S },
    rootCause: S,
    evidence: { type: 'array', items: CITE },
    fix: obj({ path: S, diff: { type: 'string', description: 'Small unified diff (---/+++/@@ lines, then -/+ lines).' } }),
    judgeLine: S,
  }),
});

const SPICE: Record<string, string> = {
  clean: 'clean = dry wit, no swearing.',
  spicy: 'spicy = occasional swearing, sharper roasts.',
  unhinged: 'unhinged = frequent swearing, brutal roasts of the code, still factual.',
};

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
      const out = await llmJSON<{ suspects: { moduleId: string; reason: string }[] }>('tribunal-suspects', {
        system: 'You triage bug reports for a codebase. Pick the 2-4 modules most likely involved, including modules whose interaction could cause the bug (callers, callees, timeouts, retries, shared state). Use only the moduleId values given.',
        prompt: `Bug: ${bug}\n\nModules:\n${JSON.stringify(modules)}`,
        schema: SUSPECTS_SCHEMA,
      });
      let suspects = [...new Set(arr<{ moduleId: string }>(out?.suspects, 6).map((s) => s?.moduleId).filter((id) => ids.includes(id)))].slice(0, 4);
      // Always a trial: pad with the biggest remaining modules (client sends them sorted by size).
      for (const id of ids) if (suspects.length < 2 && !suspects.includes(id)) suspects.push(id);
      suspects = suspects.slice(0, 4);
      return Response.json({ suspects });
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

${VOICE_GUIDE}

Spice level: ${SPICE[b.spice] ?? SPICE.clean} Never slurs, hate speech or sexual content.

Rules:
- Find the real root cause from the code, comments and logs shown. Bugs often come from how modules interact: compare timeouts with processing times, look for retries without idempotency keys, check logs for duplicates.
- turns: 6-8 items in two rounds. Round 1: every suspect speaks once (defends itself or accuses another). Round 2: rebuttals. Each turn is 2-3 sentences, first person, in that module's voice.
- In a turn, cite [path:line] or [path:start-end] ONLY from the speaker's own files, using the line numbers shown before "|". Never invent code.
- accuses: the moduleId being accused in that turn, or "" if none.
- verdict.culprits: every moduleId whose code is needed for the bug to happen (often more than one).
- verdict.rootCause: 2 plain sentences, no jokes. verdict.evidence: the key citations from any suspect. verdict.fix: one small unified diff to one file shown that changes behaviour to remove the root cause (e.g. send and honour an idempotency key, or stop retrying a non-idempotent call); never a diff that only edits comments. Context lines must match the code shown. verdict.judgeLine: one dry closing sentence from the judge.
- Use only these moduleIds: ${ids.join(', ')}.`;

    const prompt = `Bug report: ${bug}

Suspects:
${suspects
  .map(
    (s) => `### ${s.id} ("${s.title}") ${s.personality}
Files: ${s.allPaths.join(', ')}
${s.files.map((f) => `=== ${f.path}${f.truncated ? ' [truncated]' : ''} ===\n${numbered(f.content)}`).join('\n\n')}`,
  )
  .join('\n\n')}`;

    type Out = { turns: { moduleId: string; text: string; accuses: string }[]; verdict: { culprits: string[]; rootCause: string; evidence: Citation[]; fix: { path: string; diff: string }; judgeLine: string } };
    const out = await llmJSON<Out>('tribunal-trial', { system, prompt, schema: TRIAL_SCHEMA, timeoutMs: 50_000 });

    const turns = arr<Out['turns'][number]>(out?.turns, 8)
      .filter((t) => ids.includes(t?.moduleId) && str(t?.text, 10))
      .map((t) => ({ moduleId: t.moduleId, text: clean(str(t.text, 600), t.moduleId), accuses: ids.includes(t.accuses) && t.accuses !== t.moduleId ? t.accuses : undefined }));
    const v = out?.verdict;
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
    if (turns.length < 2 || !verdict.culprits.length) throw new Error('trial output unusable');
    return Response.json({ suspects: ids, turns, verdict });
  } catch (err) {
    console.error('[tribunal] failed:', err);
    return Response.json({ error: 'tribunal failed' }, { status: 502 });
  }
}
