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

// Import graph: real quickcart edges. Nothing imports payments; orders reaches it over HTTP via SERVICES.payments (a "calls" edge).
const { buildGraph, dependenciesOf, dependentsOf, affectedBy, graphFacts, graphGossip } = await import('../src/lib/graph.ts');
const { buildRepo } = await import('../src/lib/analyze.ts');
const { default: qc } = await import('../src/data/demoRepo.json', { with: { type: 'json' } });
const qr = buildRepo(qc.name, qc.files, qc.url);
const qg = buildGraph(qr.files, qr.modules);
const edgeList = (g, kind = 'imports') => g.edges.filter((e) => e.kind === kind).map((e) => `${e.from}>${e.to}:${e.weight}`);
assert.deepEqual(edgeList(qg), ['gateway>auth:1', 'gateway>utils:2', 'orders>gateway:2', 'orders>inventory:1', 'orders>utils:2', 'payments>utils:1']);
// calls: the gateway's name→URL service map, and orders' SERVICES.payments lookup
assert.deepEqual(edgeList(qg, 'calls'), ['gateway>auth:1', 'gateway>inventory:1', 'gateway>orders:1', 'gateway>payments:1', 'orders>payments:1']);
const op = qg.imports.find((r) => r.kind === 'calls' && r.from === 'orders' && r.to === 'payments');
assert.deepEqual([op.file, op.line, op.endLine], ['orders/checkout.ts', 21, 30]); // the forward(...) call spans 21-30
assert.deepEqual(dependentsOf(qg, 'payments', { calls: false }), []);
assert.deepEqual(dependentsOf(qg, 'payments').map((e) => e.from), ['gateway', 'orders']);
assert.deepEqual(affectedBy(qg, 'payments').map((a) => `${a.id}@${a.hops}`), ['gateway@1', 'orders@1']);
assert.deepEqual(dependenciesOf(qg, 'orders', { calls: false }).map((e) => e.to), ['gateway', 'inventory', 'utils']);
assert.deepEqual(affectedBy(qg, 'auth'), [{ id: 'gateway', hops: 1, via: 'auth' }, { id: 'orders', hops: 2, via: 'gateway' }]);
assert.deepEqual(affectedBy(qg, 'utils').map((a) => `${a.id}@${a.hops}`), ['gateway@1', 'orders@1', 'payments@1']);
assert.deepEqual(qg.external.auth, ['node:assert/strict', 'node:crypto', 'node:test']);
assert.ok(qg.imports.some((r) => r.file === 'auth/middleware.ts' && r.target === 'auth/tokens.ts')); // file level keeps intra-module imports
const facts = graphFacts(qg, 'gateway', qr.files, (id) => id);
assert.equal(facts.dependents[0], "orders, 2 imports:\n    [orders/checkout.ts:1] import { SERVICES } from '../gateway/config';\n    [orders/checkout.ts:2] import { forward, UpstreamTimeoutError } from '../gateway/proxy';");
assert.equal(graphGossip(qg, 'gateway', (id) => id), 'orders imports me 2 times and has never once said thanks.');
assert.equal(graphGossip(qg, 'payments', (id) => id), null);

// express-shaped: require('../'), require('./router') → router/index.js, packages counted
const G = (entries) => {
  const fs = entries.map(([path, content]) => ({ path, content, lineCount: content.split('\n').length }));
  return buildGraph(fs, buildRepo('x', fs).modules);
};
const ex = G([
  ['lib/express.js', "var Router = require('./router');\nvar app = require('./application');\n" + 'x\n'.repeat(80)],
  ['lib/application.js', "var debug = require('debug')('express:app');\nvar View = require('./view.js');\nimport('./view');"],
  ['lib/view.js', 'module.exports = 1;'],
  ['lib/router/index.js', "const { x } = require(\n  '../view'\n);"],
  ['index.js', "module.exports = require('./lib/express');"],
  ['test/app.js', "var express = require('../');\nvar after = require('after');\nvar missing = require('./fixtures/nope');"],
  ['examples/x/index.js', "var express = require('../..');\nimport {\n  a,\n  b,\n} from '../../lib/view'"],
]);
assert.deepEqual(edgeList(ex), ['(root)>lib:1', 'examples>(root):1', 'examples>lib:1', 'lib>lib/router:1', 'lib/router>lib:1', 'test>(root):1']);
assert.deepEqual([ex.external.lib, ex.external.test], [['debug'], ['after']]);
assert.deepEqual(ex.imports.filter((r) => r.file === 'examples/x/index.js').map((r) => [r.line, r.endLine]), [[2, 5], [1, 1]]);

// flask-shaped: relative imports, src/ layout, `import json` stays stdlib even though flask/json/ exists
const fl = G([
  ['src/flask/__init__.py', 'from .app import Flask\nfrom . import json as json\n' + 'x\n'.repeat(80)],
  ['src/flask/app.py', 'import os\nfrom .globals import g\nfrom .json.provider import DefaultJSONProvider\nfrom werkzeug import Response'],
  ['src/flask/globals.py', 'import typing as t'],
  ['src/flask/json/__init__.py', 'import json\nfrom ..globals import current_app'],
  ['src/flask/json/provider.py', 'import json'],
  ['tests/test_basic.py', 'import flask\nfrom flask.json import dumps\nimport pytest'],
]);
assert.deepEqual(edgeList(fl), ['tests>src/flask:2']);
const tgt = (file) => fl.imports.filter((r) => r.file === file).map((r) => r.target);
assert.deepEqual(tgt('src/flask/__init__.py'), ['src/flask/app.py', 'src/flask/json/__init__.py']);
assert.deepEqual(tgt('src/flask/app.py'), ['src/flask/globals.py', 'src/flask/json/provider.py']);
assert.deepEqual(tgt('src/flask/json/__init__.py'), ['src/flask/globals.py']);
assert.deepEqual(fl.external['src/flask'], ['json', 'os', 'typing', 'werkzeug']);

// other languages: import-like line naming another module's folder (Go import block)
const go = G([['api/server.go', 'package api\nimport (\n  "fmt"\n  "example.com/app/store"\n)\n// store is great'], ['store/db.go', 'package store']]);
assert.deepEqual(edgeList(go), ['api>store:1']);
console.log('graph checks ok');

// Diffs: bare @@ hunks (the Tribunal's), wrong line numbers, a dropped context space, and makeDiff round trips
const { parseDiff, applyDiff, makeDiff } = await import('../src/lib/diff.ts');
const { default: trib } = await import('../src/data/demoTribunal.json', { with: { type: 'json' } });
const checkout = qc.files.find((f) => f.path === 'orders/checkout.ts').content;
const [fd] = parseDiff(trib.verdict.fix.diff);
const applied = applyDiff(checkout, fd);
assert.equal(fd.path, 'orders/checkout.ts');
assert.deepEqual([applied.changedOld, applied.added, applied.removed], [[24], 1, 0]); // inserted after line 24
assert.equal(applied.text.split('\n')[24], '      idempotency_key: order.id,');
const loose = '@@ -90,2 +90,2 @@\n const MAX_PAYMENT_ATTEMPTS = 2;\n-const x = 1;\n+const x = 2;\n';
assert.equal(applyDiff('a\nconst MAX_PAYMENT_ATTEMPTS = 2;\nconst x = 1;\nb', parseDiff(loose, 'f.ts')[0]).text, 'a\nconst MAX_PAYMENT_ATTEMPTS = 2;\nconst x = 2;\nb');
assert.match(applyDiff('nothing here', parseDiff(loose, 'f.ts')[0]).error, /doesn't match/);
assert.equal(applyDiff('  if (x) {\n    y();\n  }', parseDiff('@@\n if (x) {\n-    y();\n+    z();\n', 'f.ts')[0]).text, '  if (x) {\n    z();\n  }'); // indentation-insensitive match
const before = 'a\nb\nc\nd\ne\nf\ng\nh', after = 'a\nb\nc\nD\nE2\ne\nf\ng\nh';
assert.equal(applyDiff(before, parseDiff(makeDiff('x.ts', before, after))[0]).text, after);
assert.equal(makeDiff('x.ts', before, before), '');
const far = Array.from({ length: 40 }, (_, i) => `line ${i}`);
const farAfter = far.map((l, i) => (i === 3 ? 'changed 3' : i === 35 ? 'changed 35' : l));
farAfter.splice(20, 0, 'inserted');
const farDiff = makeDiff('far.ts', far.join('\n'), farAfter.join('\n'));
assert.equal(farDiff.split('\n').filter((l) => l.startsWith('@@')).length, 3); // three separate hunks, not one block
assert.equal(farDiff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length, 5);
assert.equal(applyDiff(far.join('\n'), parseDiff(farDiff)[0]).text, farAfter.join('\n'));
console.log('diff checks ok');

// What-if impact (deterministic ground truth)
const { computeImpact, renameDiff, deleteDiff, declaredIn, retryOrCheck, QUICKCART_SUGGESTIONS, suggestionDiff, sameChange } = await import('../src/lib/whatif.ts');
const short = (imp) => imp.items.map((i) => `${i.moduleId}:${i.role}@${i.hops}${i.via ? '<' + i.via : ''}`);
const fix = computeImpact(qr.files, qr.modules, qg, trib.verdict.fix.diff);
assert.deepEqual(short(fix), ['orders:changed@0', 'gateway:upstream@1<orders', 'payments:downstream@1<orders']);
assert.deepEqual(fix.items[1].lines.map((c) => `${c.path}:${c.line}`), ['gateway/config.ts:10']); // gateway routes /orders to the orders service
assert.deepEqual(fix.items[2].lines.map((c) => `${c.path}:${c.line}`), ['orders/checkout.ts:21']); // the SERVICES.payments call now carries a new field
assert.deepEqual(fix.symbols, []); // requestCharge is not exported
const timeout = computeImpact(qr.files, qr.modules, qg, suggestionDiff(qr.files, QUICKCART_SUGGESTIONS[2]));
assert.deepEqual(short(timeout), ['gateway:changed@0', 'orders:upstream@1<gateway']);
assert.deepEqual(timeout.symbols, ['UPSTREAM_TIMEOUT_MS']);
assert.deepEqual(timeout.items[0].usages.map((u) => `${u.path}:${u.line}`), ['gateway/proxy.ts:1', 'gateway/proxy.ts:6', 'gateway/proxy.ts:31']);
assert.deepEqual(timeout.items[1].lines.map((c) => `${c.path}:${c.line}-${c.endLine}`), ['orders/checkout.ts:1-1', 'orders/checkout.ts:2-2']);
for (const s of QUICKCART_SUGGESTIONS) assert.ok(suggestionDiff(qr.files, s), s.label);
assert.ok(sameChange(computeImpact(qr.files, qr.modules, qg, suggestionDiff(qr.files, QUICKCART_SUGGESTIONS[0])).files, fix.files)); // same edit as the Tribunal fix
assert.match(computeImpact(qr.files, qr.modules, qg, '--- a/nope.ts\n+++ b/nope.ts\n@@\n-x\n+y').error, /not in the loaded files/);
// Rename an exported function: the declaration changes, callers keep the old name and are cited
const rn = G([
  ['lib/utils.js', "exports.etag = createETagGenerator({ weak: false });\nexports.wetag = createETagGenerator({ weak: true });\n" + 'x\n'.repeat(80)],
  ['lib/response.js', "var etag = require('./utils').etag;\nres.send = function send(body) { etag(body); };"],
  ['test/utils.js', "var utils = require('../lib/utils');\ndescribe('utils.etag(body)', function () {\n  utils.etag('express!');\n  utils.wetag('x');\n});"],
]);
const rnRepo = buildRepo('x', [
  { path: 'lib/utils.js', content: "exports.etag = createETagGenerator({ weak: false });\nexports.wetag = createETagGenerator({ weak: true });\n" + 'x\n'.repeat(80), lineCount: 83 },
  { path: 'lib/response.js', content: "var etag = require('./utils').etag;\nres.send = function send(body) { etag(body); };", lineCount: 2 },
  { path: 'test/utils.js', content: "var utils = require('../lib/utils');\ndescribe('utils.etag(body)', function () {\n  utils.etag('express!');\n  utils.wetag('x');\n});", lineCount: 5 },
]);
const utilsJs = rnRepo.files[0].content;
assert.equal(declaredIn(utilsJs, 1, 1).name, 'etag');
const ren = computeImpact(rnRepo.files, rnRepo.modules, rn, renameDiff('lib/utils.js', utilsJs, 1, 1));
assert.deepEqual(ren.symbols, ['etag']);
assert.deepEqual(short(ren), ['lib:changed@0', 'test:upstream@1<lib']);
assert.deepEqual(ren.items.find((i) => i.moduleId === 'test').usages.map((u) => `${u.path}:${u.line}`), ['test/utils.js:2', 'test/utils.js:3']);
assert.deepEqual(ren.items[0].usages.map((u) => `${u.path}:${u.line}`), ['lib/response.js:1', 'lib/response.js:2']); // same module, still breaks
assert.equal(deleteDiff('a.ts', 'a\nb\nc', 2, 2), '--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,2 @@\n a\n-b\n c');
assert.deepEqual([retryOrCheck('for (let attempt = 1;'), retryOrCheck('if (!user) return'), retryOrCheck('const x = 1')], ['retry', 'check', null]);
console.log('what-if checks ok');

// Saved what-if runs (demo replay): each still matches its change on the bundled quickcart, and only lists modules
// the deterministic impact list contains.
const { default: savedWhatIf } = await import('../src/data/demoWhatIf.json', { with: { type: 'json' } });
assert.ok(savedWhatIf.runs.some((r) => r.title === 'Add an idempotency key'));
for (const run of savedWhatIf.runs) {
  const imp = computeImpact(qr.files, qr.modules, qg, run.diff);
  const ids = imp.items.map((i) => i.moduleId);
  assert.deepEqual(run.items.map((i) => i.moduleId), ids, run.title);
  assert.ok(run.items.every((i) => ['breaks', 'at risk', 'fine', 'relieved'].includes(i.verdict) && i.reason && i.reaction), run.title);
  assert.ok(run.summary.update && run.summary.check, run.title);
}
assert.ok(sameChange(computeImpact(qr.files, qr.modules, qg, savedWhatIf.runs[0].diff).files, fix.files)); // replays for "Apply this fix" too
console.log('saved what-if checks ok');

// Diagrams: sanitising AI output, cites, sequence messages, deterministic charts
const { sanitizeDiagram, parseCites, parseSequence, escLabel, moduleChart, fileChart, participantId } = await import('../src/lib/diagram.ts');
const evil = 'flowchart LR\n%%{init: {"securityLevel": "loose"}}%%\n  a["<img src=x onerror=alert(1)>hi"] --> b\n  click a "https://evil.example" "x"\n  click b call alert()\n  b -->|"see https://x.io/a"| c\n  style a fill:red';
const clean = sanitizeDiagram(evil);
assert.ok(!/click|init|<img|https?:|style a/.test(clean), clean);
assert.match(clean, /a\[" hi"\] --> b/);
// Directives anywhere (mid-line, multi-line) and front matter are gone too; labels can't carry one either.
const sneaky = '---\nconfig:\n  securityLevel: loose\n---\nsequenceDiagram\n  participant a as x %%{init: {"securityLevel": "loose"}}%% y\n  a->>b: hi %%{\ninit: {"theme": "dark"}\n}%% there\n  b->>a: %%{ half';
const sneakyClean = sanitizeDiagram(sneaky);
assert.ok(!/%%\{|securityLevel|config:|init:/.test(sneakyClean), sneakyClean);
assert.match(sneakyClean, /^sequenceDiagram/);
assert.equal(escLabel('t %%{init: x}%%'), 't #37;#37;{init: x}#37;#37;');
const seq = 'sequenceDiagram\n  participant orders as orders, the bouncer\n  orders->>gateway: POST /payments/charges\n  %% cite orders/checkout.ts:21-30\n  rect rgb(255, 228, 222)\n  Note over orders,gateway: Where it all went wrong\n  gateway-->>+orders: UpstreamTimeoutError after 2000ms\n  %% cite gateway/proxy.ts:46-48\n  end\n  orders->>gateway: same charge again\n  %% cite m3 orders/x.ts:1';
assert.deepEqual(parseSequence(seq).map((m) => [m.from, m.to, m.fatal, m.cite?.startLine]), [['orders', 'gateway', false, 21], ['gateway', 'orders', true, 46], ['orders', 'gateway', false, undefined]]);
assert.deepEqual(parseCites(seq).map((c) => `${c.target}:${c.path}:${c.startLine}-${c.endLine}`), ['0:orders/checkout.ts:21-30', '1:gateway/proxy.ts:46-48', 'm3:orders/x.ts:1-1']);
assert.equal(escLabel('a "b" <c> #1 `d`'), 'a #quot;b#quot; #lt;c#gt; #35;1 #96;d#96;');
assert.equal(participantId('(root)'), '_root_');
assert.match(sanitizeDiagram('sequenceDiagram\n  Note over a,b,c: x'), /Note over a,c: x/); // Mermaid notes span two participants
const noteCite = 'sequenceDiagram\n  a->>b: one\n  %% cite x.ts:1\n  Note over a: aside\n  %% cite y.ts:9\n  b->>a: two';
assert.deepEqual(parseSequence(noteCite).map((m) => m.cite?.path), ['x.ts', undefined]); // a cite under a note isn't a message's
assert.deepEqual(parseCites(noteCite).map((c) => c.path), ['x.ts']);
const mc = moduleChart(qr.modules, qg, (id) => id, new Set(['gateway>orders']));
assert.equal(mc.edges.length, qg.edges.length);
assert.match(mc.code, /-\.->\|"talks over the network"\|/);
assert.match(mc.code, /-->\|"imports 2×"\|/);
assert.match(mc.code, /stroke:#d9381e/); // the cycle edge
const fc = fileChart(qr.modules.find((m) => m.id === 'utils'), qr.files, qg, (id) => id);
assert.match(fc.code, /validation\.ts<br\/>417 lines · the load-bearing file/);
console.log('diagram checks ok');

// The Landlord: tour order, graph bf, lines
const { tourOrder, buildingFacts, captions, landlordIntro, landlordLine, landlordOutro, closingLine } = await import('../src/lib/landlord.ts');
const tour = tourOrder(qg, qr.modules);
// gateway first, then the services in the order its config lists them, then what they import; misc is never reached
assert.deepEqual(tour.order, ['gateway', 'auth', 'orders', 'payments', 'inventory', 'utils', '(misc)']);
assert.equal(tour.firstUnreachable, 6);
const bf = buildingFacts(qg, qr.modules);
assert.deepEqual(bf.cycles, [['orders', 'gateway']]); // orders imports gateway, gateway calls orders
assert.deepEqual([...bf.cycleEdges].sort(), ['gateway>orders', 'orders>gateway']);
assert.deepEqual(bf.hub, { id: 'utils', n: 3 });
assert.deepEqual(bf.orphans, ['(misc)']);
assert.deepEqual(bf.needy, { id: 'gateway', n: 5, givesBack: 1 });
for (const spice of ['clean', 'unhinged', 'feral', 'nuclear']) {
  const cap = captions(bf, spice, (id) => id);
  assert.deepEqual([...cap.keys()].sort(), ['(misc)', 'gateway', 'orders', 'utils'], spice);
  assert.match(cap.get('utils'), /3 MODULES|3 modules/);
  const caps = [...cap.values(), landlordIntro('m1ssmee/quickcart', qr.files, qr.modules, spice), landlordOutro('q', qg, qr.modules, bf, spice), closingLine(spice, 2, 3, 'x')];
  for (const l of caps) {
    assert.ok(!/\{\w+\}/.test(l), l); // every placeholder filled
    if (spice === 'clean') assert.ok(!/\b(damn|shit|fuck|hell)/i.test(l), l);
    assert.ok((l.match(/\b[A-Z]{3,}(?:\s+[A-Z']{2,})*\b/g) ?? []).filter((w) => !/^(TODOs?)$/.test(w)).length <= 4, l); // one outburst at most
  }
}
assert.match(landlordIntro('m1ssmee/quickcart', qr.files, qr.modules, 'clean'), /21 files.*7 (tenants|modules).*(5|\d+) TODOs/);
assert.match(landlordLine(qr.modules.find((m) => m.id === 'utils'), qg, bf, 'clean', (id) => id), /503 lines.*3 tenants|3 other modules/);
assert.match(landlordLine(qr.modules.find((m) => m.id === 'payments'), qg, bf, 'clean', (id) => id), /Used by gateway and orders\. Needs utils\./);
assert.match(landlordOutro('q', qg, qr.modules, bf, 'clean'), /7 tenants, 11 connections, 1 codependent pair/);
// express-shaped: index.js at the root is where a request starts; tests and examples are never reached
const exTour = tourOrder(ex, buildRepo('x', [['lib/express.js', 'x\n'.repeat(80)], ['lib/application.js', ''], ['lib/view.js', ''], ['lib/router/index.js', ''], ['index.js', ''], ['test/app.js', ''], ['examples/x/index.js', '']].map(([path, content]) => ({ path, content, lineCount: content.split('\n').length }))).modules);
assert.equal(exTour.entry, '(root)');
console.log('landlord checks ok');

// Saved hearing: the verdict diagram cites real lines and the fix diff is still the one every saved What-if run matches.
assert.ok(sameChange(computeImpact(qr.files, qr.modules, qg, trib.verdict.fix.diff).files, fix.files));
const msgs = parseSequence(sanitizeDiagram(trib.verdict.diagram));
assert.equal(sanitizeDiagram(trib.verdict.diagram), trib.verdict.diagram.trim()); // nothing to strip
assert.ok(msgs.length >= 4 && msgs.length <= 10 && msgs.some((m) => m.fatal));
for (const m of msgs) {
  const f = qc.files.find((x) => x.path === m.cite?.path);
  assert.ok(f && m.cite.endLine <= f.lineCount, `${m.text} → ${JSON.stringify(m.cite)}`);
}
console.log('saved hearing checks ok');

// The saved stacked sequence: the Tribunal fix (payments shrugs, follow-up offered), then the payments side.
const parentRun = savedWhatIf.runs.find((r) => r.title === 'Add an idempotency key');
const followRun = savedWhatIf.runs.find((r) => r.parent === parentRun.title);
assert.ok(parentRun.summary.followUps.some((f) => f.moduleId === 'payments' && f.path === 'payments/processor.ts'));
assert.equal(parentRun.items.find((i) => i.moduleId === 'payments').verdict, 'fine');
assert.deepEqual(followRun.followUp, { moduleId: 'payments', path: 'payments/processor.ts' });
const proc0 = qc.files.find((f) => f.path === 'payments/processor.ts').content;
const procAfter = applyDiff(proc0, parseDiff(followRun.patch)[0]);
assert.ok(!procAfter.error && /chargesByKey\.get\(req\.idempotency_key\)/.test(procAfter.text));
const stacked = computeImpact(qr.files, qr.modules, qg, followRun.diff);
assert.deepEqual(stacked.items.map((i) => `${i.moduleId}:${i.role}`), ['orders:changed', 'payments:changed', 'gateway:upstream']);
assert.ok(followRun.items.every((i) => ['fine', 'relieved'].includes(i.verdict)) && followRun.items.find((i) => i.moduleId === 'payments').verdict === 'relieved');
console.log('saved follow-up checks ok');

// Saved cast: the Landlord's lines exist for every quickcart module and state the real counts.
const { default: savedCast } = await import('../src/data/demoCharacters.json', { with: { type: 'json' } });
assert.match(savedCast.landlord.intro, /21 files, 7 modules, and 4 TODOs/);
for (const c of savedCast.characters) assert.ok(c.about && c.landlordLine, c.moduleId);
assert.match(savedCast.characters.find((c) => c.moduleId === 'gateway').landlordLine, /leans on 5 other modules/);
console.log('saved cast checks ok');
