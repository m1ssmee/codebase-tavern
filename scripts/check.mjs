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

// Import graph: real quickcart edges (nothing imports payments: orders reaches it over HTTP via SERVICES.payments)
const { buildGraph, dependenciesOf, dependentsOf, affectedBy, graphFacts, graphGossip } = await import('../src/lib/graph.ts');
const { buildRepo } = await import('../src/lib/analyze.ts');
const { default: qc } = await import('../src/data/demoRepo.json', { with: { type: 'json' } });
const qr = buildRepo(qc.name, qc.files, qc.url);
const qg = buildGraph(qr.files, qr.modules);
const edgeList = (g) => g.edges.map((e) => `${e.from}>${e.to}:${e.weight}`);
assert.deepEqual(edgeList(qg), ['gateway>auth:1', 'gateway>utils:2', 'orders>gateway:2', 'orders>inventory:1', 'orders>utils:2', 'payments>utils:1']);
assert.deepEqual(dependentsOf(qg, 'payments'), []);
assert.deepEqual(dependenciesOf(qg, 'orders').map((e) => e.to), ['gateway', 'inventory', 'utils']);
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
