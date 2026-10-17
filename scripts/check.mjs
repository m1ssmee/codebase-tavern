// Run: npm run check  (Node 23+ strips TS types natively)
import assert from 'node:assert/strict';
import { parseCitations, extractCitations } from '../src/lib/citations.ts';
import { parseGitHubUrl, filterFiles, detectModules, entryFile, computeStats } from '../src/lib/analyze.ts';

// citations
assert.deepEqual(parseCitations('see [orders/api.ts:12] and [utils/money.ts:3-9]!'), [
  'see ',
  { path: 'orders/api.ts', startLine: 12, endLine: 12 },
  ' and ',
  { path: 'utils/money.ts', startLine: 3, endLine: 9 },
  '!',
]);
assert.deepEqual(extractCitations('[a.ts:9-2]'), [{ path: 'a.ts', startLine: 2, endLine: 9 }]);
assert.deepEqual(parseCitations('no cites [here] or [x: 3] or [3] or `foo()`'), ['no cites [here] or [x: 3] or [3] or `foo()`']);
assert.deepEqual(extractCitations('[lib/a.js:59-83, 152-178] and [lib/r.js:30, lib/s.js:43] and `index.js:11`'), [
  { path: 'lib/a.js', startLine: 59, endLine: 83 }, { path: 'lib/a.js', startLine: 152, endLine: 178 },
  { path: 'lib/r.js', startLine: 30, endLine: 30 }, { path: 'lib/s.js', startLine: 43, endLine: 43 },
  { path: 'index.js', startLine: 11, endLine: 11 },
]);
assert.deepEqual(parseCitations('see [a.ts:1, oops] ok'), ['see [a.ts:1, oops] ok']); // partial group = text

// GitHub URLs
const slug = (s) => parseGitHubUrl(s)?.slug;
assert.equal(slug('https://github.com/expressjs/express'), 'expressjs/express');
assert.equal(slug('https://github.com/expressjs/express.git/'), 'expressjs/express');
assert.equal(slug('github.com/a/b/tree/dev/lib/x/'), 'a/b/tree/dev/lib/x');
assert.equal(slug('owner/repo'), 'owner/repo');
assert.equal(slug('foo/foo.github.io'), 'foo/foo.github.io');
assert.deepEqual([parseGitHubUrl('a/b/tree/main/src').ref, parseGitHubUrl('a/b/tree/main/src').subpath], ['main', 'src']);
for (const bad of ['', 'hello', 'https://gitlab.com/a/b', 'https://github.com/a', 'https://github.com/a/b/blob/main/x.ts', '../x', 'a/..', 'a/b/tree/../x'])
  assert.equal(parseGitHubUrl(bad), null, bad);

// filterFiles
const e = (path, content = 'x\n') => ({ path, content });
const { files, skipped } = filterFiles([
  e('src/a.ts'), e('node_modules/x/index.js'), e('package-lock.json'), e('logo.png'), e('app.min.js'),
  e('bundle.js', 'x'.repeat(400)), e('blob.bin2', 'a\0b'), e('README.md'), e('package.json'), e('a/b/c/deep.ts'),
]);
assert.deepEqual(files.map((f) => f.path), ['src/a.ts', 'a/b/c/deep.ts', 'package.json', 'README.md']); // code > config > docs, shallow first
assert.equal(skipped.count, 6);
assert.equal(filterFiles(Array.from({ length: 310 }, (_, i) => e(`f${i}.ts`))).files.length, 300);

// detectModules
const f = (path, lines = 10) => ({ path, content: 'x\n'.repeat(lines - 1) + 'x', lineCount: lines });
const dom = detectModules([f('src/api/a.ts', 100), f('src/ui/b.tsx', 80), f('src/index.ts', 5), f('test/t.test.ts', 20), f('package.json'), f('docs/x.md')]);
assert.deepEqual(dom.map((m) => m.id), ['src/api', 'src/ui', 'test', 'src', '(misc)']); // config-only root + docs → misc
assert.deepEqual(dom.at(-1).filePaths, ['package.json', 'docs/x.md']);
assert.ok(dom.find((m) => m.id === 'test').stats.hasTests);
const many = detectModules(Array.from({ length: 10 }, (_, i) => f(`m${i}/x.ts`, 100 - i)));
assert.equal(many.length, 8);
assert.deepEqual(many.at(-1).filePaths, ['m7/x.ts', 'm8/x.ts', 'm9/x.ts']);
assert.equal(detectModules([f('solo.py')])[0].name, 'solo.py');

// stats + entry file
const py = { path: 'm/a.py', content: 'def f():\n    if x:\n        for y in z:\n            pass  # TODO\n', lineCount: 5 };
const js = { path: 'm/index.js', content: 'function a() { if (b) { c({}) } } // FIXME XXX', lineCount: 1 };
const st = computeStats({ filePaths: ['m/a.py', 'm/index.js'] }, [py, js]);
assert.deepEqual([st.maxNesting, st.todoCount, st.hasTests, st.biggestFile.path], [3, 3, false, 'm/a.py']);
assert.equal(entryFile({ filePaths: ['m/z.js', 'm/index.js', 'm/sub/README.md'], stats: st }), 'm/sub/README.md');
assert.equal(entryFile({ filePaths: ['m/z.js', 'm/index.js'], stats: st }), 'm/index.js');

console.log('checks ok');

// characters
const { assignColors, faceTraits, fallbackCharacter, toRaw, toCharacters, statsLine, PALETTE } = await import('../src/lib/characters.ts');
const mods = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, name: `mod${i}` }));
assert.equal(new Set(Object.values(assignColors(mods))).size, 8); // 8 modules → 8 distinct colours
assert.ok(Object.values(assignColors(mods)).every((c) => PALETTE.includes(c)));
const S = (o) => ({ fileCount: 3, totalLines: 412, biggestFile: { path: 'a/big.ts', lines: 120 }, todoCount: 7, maxNesting: 3, hasTests: false, ...o });
assert.deepEqual(
  Object.entries(faceTraits(S({ biggestFile: { path: 'x', lines: 301 }, maxNesting: 6 }))).filter(([, v]) => v === true).map(([k]) => k),
  ['shifty', 'sweaty', 'dizzy', 'shivers'],
);
assert.ok(faceTraits(S({ totalLines: 200, todoCount: 0, hasTests: true })).smug);
assert.ok(!faceTraits(S({ totalLines: 300, todoCount: 0, hasTests: true })).smug);
assert.equal(statsLine(S()), '412 lines · 3 files · 7 TODOs · no tests');
const mod = { id: 'pay', name: 'payments', path: 'payments', filePaths: [], stats: S() };
const fb = fallbackCharacter(mod);
assert.equal(fb.title, 'payments, the procrastinator');
assert.ok(fb.catchphrase.split(' ').length <= 12 && fb.catchphrase.includes('7'));
assert.ok(fb.voicePitch >= 0.6 && fb.voicePitch <= 1.8);
// junk model output → per-module fallback; good output is kept but clamped
const good = { moduleId: 'pay', title: 'payments, the accountant', personality: 'p', catchphrase: 'one two three four five six seven eight nine ten eleven twelve thirteen', greeting: 'g', voicePitch: 9 };
assert.deepEqual(toRaw([mod], 'nonsense'), [fb]);
const kept = toRaw([mod], [good])[0];
assert.deepEqual([kept.title, kept.catchphrase.split(' ').length, kept.voicePitch], ['payments, the accountant', 12, 1.8]);
assert.equal(toCharacters([mod], [kept])[0].name, 'payments, the accountant');
assert.equal(toRaw([mod], [{ ...good, title: '(pay), the ledger' }])[0].title, 'payments, the ledger');

console.log('character checks ok');

// Tribunal fix quality
const { isTimeoutOnlyFix } = await import('../src/lib/verdict.ts');
const bump = '--- a/gateway/config.ts\n+++ b/gateway/config.ts\n@@\n-export const UPSTREAM_TIMEOUT_MS = 2000;\n+export const UPSTREAM_TIMEOUT_MS = 5000;';
const idem = '--- a/orders/checkout.ts\n+++ b/orders/checkout.ts\n@@\n       payment_method_id: paymentMethodId,\n+      idempotency_key: order.id,';
const both = bump + '\n' + idem.split('\n').slice(3).join('\n');
assert.equal(isTimeoutOnlyFix(bump, 'orders retries the charge'), true);
assert.equal(isTimeoutOnlyFix(bump, 'the page loads slowly'), false); // no retry/duplicate in the hearing
assert.equal(isTimeoutOnlyFix(idem, 'orders retries the charge'), false);
assert.equal(isTimeoutOnlyFix(both, 'charged twice'), false); // has a real fix too
assert.equal(isTimeoutOnlyFix('+// raise the timeout\n+// later', 'retry'), false); // comment-only diff is not a timeout bump
console.log('verdict checks ok');

// Streaming turn scanner: same turns, in order, however the JSON is chunked
const { TurnScanner } = await import('../src/lib/verdict.ts');
const doc = JSON.stringify({
  turns: [
    { moduleId: 'orders', text: 'I retry {twice} and say "sorry" \\ never', accuses: 'gateway' },
    { moduleId: 'gateway', text: 'Braces } and ] in text are fine [gateway/config.ts:16].', accuses: '' },
    { moduleId: 'payments', text: 'Last one.', accuses: 'orders' },
  ],
  verdict: { culprits: ['orders'], rootCause: 'x', evidence: [], fix: { path: 'a', diff: '' }, judgeLine: 'y' },
});
for (const size of [1, 3, 7, 50, doc.length]) {
  const sc = new TurnScanner();
  const got = [];
  for (let i = 0; i < doc.length; i += size) got.push(...sc.push(doc.slice(i, i + size)));
  assert.deepEqual(got, JSON.parse(doc).turns, `chunk size ${size}`);
}
console.log('turn scanner checks ok');

// Generalised fix-quality check
const { fixProblem } = await import('../src/lib/verdict.ts');
const culprits = ['orders/checkout.ts', 'gateway/config.ts'];
const F = (path, diff) => ({ path, diff });
const hdr = (p) => `--- a/${p}\n+++ b/${p}\n@@\n`;
assert.match(fixProblem(F('orders/checkout.ts', hdr('orders/checkout.ts') + '+      // retry is not safe here\n-      // retry added to fix flaky checkouts'), culprits, 'retry'), /comments/);
assert.match(fixProblem(F('orders/checkout.ts', hdr('orders/checkout.ts') + '+   \n-'), culprits, 'retry'), /comments or whitespace/);
assert.match(fixProblem(F('test/app.js', hdr('test/app.js') + "+  it('fails on async throw', () => {});"), [], 'hang'), /test files/);
assert.match(fixProblem(F('orders/checkout.test.ts', hdr('orders/checkout.test.ts') + "+test('no double charge', () => {});"), culprits, 'retry'), /test files/);
assert.match(fixProblem(F('utils/money.ts', hdr('utils/money.ts') + '+  return Math.round(x);'), culprits, 'charged twice'), /culprit module/);
assert.match(fixProblem(F('gateway/config.ts', bump), culprits, 'orders retries the charge'), /timeout/);
assert.equal(fixProblem(F('gateway/config.ts', bump), culprits, 'requests are slow on cold start'), null); // timeout fix is fine when it is the cause
assert.equal(fixProblem(F('orders/checkout.ts', idem), culprits, 'retry'), null);
// tests alongside a real code change are fine; a multi-file diff is judged per file header
const mixed = hdr('orders/checkout.test.ts') + "+test('one charge', () => {});\n" + hdr('orders/checkout.ts') + '+      idempotency_key: order.id,';
assert.equal(fixProblem(F('orders/checkout.test.ts', mixed), culprits, 'retry'), null);
assert.match(fixProblem(F('orders/checkout.ts', hdr('orders/checkout.ts') + '+  // TODO\n' + hdr('orders/checkout.test.ts') + "+test('x', () => {});"), culprits, 'retry'), /test files/);
console.log('fix-quality checks ok');

// 3D cast assignment: folder name, then main file names, then the fallbacks; repeats get the alternate variant
const { assignCast, keywordArchetype, tokens, isDocsModule, ARCHETYPES } = await import('../src/lib/cast.ts');
const { readFileSync } = await import('node:fs');
const castOf = (mods) => Object.fromEntries(assignCast(mods).map((c, i) => [mods[i].id, `${c.archetype}${c.variant ? '*' : ''}`]));
const demo = JSON.parse(readFileSync(new URL('../src/data/demoRepo.json', import.meta.url), 'utf8'));
assert.deepEqual(castOf(detectModules(demo.files)), {
  utils: 'junkDrawer', orders: 'clerk', gateway: 'doorman', auth: 'bouncer', payments: 'accountant', inventory: 'hoarder', '(misc)': 'librarian', // misc is 3/4 config and docs
});
const express = JSON.parse(readFileSync(new URL('../src/data/expressModules.json', import.meta.url), 'utf8'));
// express misc (.github workflows) wants Librarian, then Junk Drawer: both taken, so it reuses Librarian as the alternate
assert.deepEqual(castOf(express.modules), { test: 'inspector', '(root)': 'librarian', lib: 'junkDrawer', examples: 'hoarder', '(misc)': 'librarian*' });
assert.deepEqual(tokens('userModels.test.ts'), ['user', 'models', 'test', 'ts']);
assert.equal(keywordArchetype('__tests__'), 'inspector');
assert.equal(keywordArchetype('auth-api'), 'clerk'); // head noun wins
assert.equal(keywordArchetype('feedback'), null); // whole tokens only, no "db" inside words
assert.equal(keywordArchetype('Payment'), 'accountant'); // case and plural folded
const M = (id, filePaths, s = {}) => ({ id, name: id, path: id, filePaths, stats: { fileCount: 1, totalLines: 50, biggestFile: { path: '', lines: 50 }, todoCount: 0, maxNesting: 1, hasTests: false, ...s } });
assert.deepEqual(castOf([M('core', ['core/server.ts', 'core/README.md']), M('x', ['x/a.ts']), M('y', ['y/b.ts'], { todoCount: 5 }), M('z', ['z/z.test.ts'])]), {
  core: 'doorman', x: 'hoarder', y: 'junkDrawer', z: 'clerk', // tests aren't main files
});
// a repeat tries its next-best match before the alternate variant
assert.deepEqual(castOf([M('api', ['api/routes.ts']), M('handlers', ['handlers/db.ts'])]), { api: 'clerk', handlers: 'plumber' });
assert.deepEqual(castOf([M('api', ['api/a.ts']), M('routes', ['routes/b.ts'])]), { api: 'clerk', routes: 'clerk*' });
assert.ok(isDocsModule({ filePaths: ['.github/ci.yml', 'docs/a.md', 'LICENSE', 'tsconfig.json', 'src/x.ts'] }));
assert.ok(!isDocsModule({ filePaths: ['data/fixtures.json', 'data/b.json', 'README.md'] })); // data .json is not config
// the Landlord narrates; it is never a module's character
assert.ok(ARCHETYPES.includes('landlord'));
assert.ok(![demo.files, express.modules].some((x) => Object.values(castOf(Array.isArray(x) && x[0]?.stats ? x : detectModules(x))).includes('landlord')));
console.log('cast checks ok');
