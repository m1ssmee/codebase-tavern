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
// the Landlord narrates and the Judge only sits the Tribunal; neither is ever a module's character
for (const extra of ['landlord', 'judge']) {
  assert.ok(ARCHETYPES.includes(extra));
  assert.ok(![demo.files, express.modules].some((x) => Object.values(castOf(Array.isArray(x) && x[0]?.stats ? x : detectModules(x))).includes(extra)));
}
console.log('cast checks ok');

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
// A Tribunal fix in the model's style (bare @@ hunks): the idempotency key, the same edit as the "Add an idempotency key" chip.
const KEY_FIX = "--- a/orders/checkout.ts\n+++ b/orders/checkout.ts\n@@\n import { SERVICES } from '../gateway/config';\n import { forward, UpstreamTimeoutError } from '../gateway/proxy';\n import { reserveStock, releaseReservation } from '../inventory/reservations';\n import { getOrder, orderTotal, updateStatus, type Order } from './orders';\n import { log } from '../utils/logger';\n@@\n async function requestCharge(order: Order, paymentMethodId: string): Promise<ChargeResponse> {\n   return forward<ChargeResponse>(SERVICES.payments, {\n     method: 'POST',\n     path: '/payments/charges',\n     body: {\n+      idempotency_key: order.id,\n       order_id: order.id,\n       amount: orderTotal(order),\n       currency: order.currency,\n       payment_method_id: paymentMethodId,\n     },\n   });\n }\n";
const checkout = qc.files.find((f) => f.path === 'orders/checkout.ts').content;
const [fd] = parseDiff(KEY_FIX);
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
const fix = computeImpact(qr.files, qr.modules, qg, KEY_FIX);
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
assert.ok(sameChange(computeImpact(qr.files, qr.modules, qg, savedWhatIf.runs.find((r) => r.title === 'Add an idempotency key').diff).files, fix.files)); // the chip replays
const tribFix = computeImpact(qr.files, qr.modules, qg, trib.verdict.fix.diff, trib.verdict.fix.path);
assert.ok(savedWhatIf.runs.some((r) => sameChange(computeImpact(qr.files, qr.modules, qg, r.diff).files, tribFix.files))); // so does "Apply this fix"
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
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) assert.doesNotMatch(closingLine(spice, 1, 4, seed), /\b1 changes|\{/); // one change, said right
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

// Saved hearing: one innocent (the verdict shows it ducking), a fix that applies to a culprit's file, real diagram cites.
assert.equal(trib.suspects.filter((id) => !trib.verdict.culprits.includes(id)).length, 1);
assert.ok(!('error' in tribFix) && tribFix.items[0].role === 'changed' && trib.verdict.culprits.includes(tribFix.items[0].moduleId));
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

// Roast My Repo: violations and the grade from the real stats and graph; every template line filled and in voice.
const { inspect, gradeFor, fallbackLine, fallbackHeadline, toCompact, fromCompact, SWEARING, STAMP } = await import('../src/lib/roast.ts');
const qi = inspect(qr.files, qr.modules, qg, (id) => id, () => '#f5a524');
assert.deepEqual([qi.grade, qi.violations, qi.modules], ['C', 6, 6]); // utils 2, gateway 1, payments 1, inventory 1, the gateway/orders loop 1
assert.deepEqual(qi.entries.map((e) => e.stat), ['validation.ts: 417 lines, no tests', 'gateway: no tests, codependent with orders', 'orders: codependent with gateway', 'payments: no tests']);
assert.equal(STAMP[qi.grade], 'PASSED WITH CONCERNS');
assert.deepEqual(['A', 'B', 'C', 'D', 'F'], [gradeFor(0, 4), gradeFor(1, 4), gradeFor(6, 6), gradeFor(5, 4), gradeFor(9, 4)]);
// tested by a test module that imports it (express keeps tests in test/); dot-folders and docs aren't inspected
const tf = (path, content) => ({ path, content, lineCount: content.split('\n').length });
const tfiles = [tf('lib/a.js', 'x\n'.repeat(400)), tf('test/a.js', "require('../lib/a')\n" + 'x\n'.repeat(500)), tf('docs/conf.py', 'x = 1'), tf('.devcontainer/setup.sh', 'echo hi')];
const tmods = buildRepo('x', tfiles).modules;
const ti = inspect(tfiles, tmods, buildGraph(tfiles, tmods), (id) => id, () => '#000');
assert.deepEqual([ti.modules, ti.violations, ti.entries[0].stat], [2, 1, 'a.js: 401 lines']); // lib: big file only; test files are exempt
assert.deepEqual(ti.entries.map((e) => e.stat), ['a.js: 401 lines', 'test: no violations found']); // topped up with a clean module
for (const spice of ['clean', 'unhinged', 'feral', 'nuclear']) {
  const lines = [...qi.entries.map((e) => fallbackLine(e, spice)), fallbackHeadline(qi, spice, 'q'), fallbackLine({ ...qi.entries[0], facts: {} }, spice)];
  for (const l of lines) {
    assert.ok(!/\{\w+\}/.test(l) && /\d|[a-z]+\.ts|gateway|orders|payments|utils/.test(l), l); // filled, and built on a real fact
    if (spice === 'clean') assert.ok(!SWEARING.test(l), l);
  }
}
const card = { repo: 'm1ssmee/quickcart', date: '2026-10-18', grade: qi.grade, violations: 6, modules: 6, headline: 'h', keys: 7, clean: false, entries: qi.entries.map((e) => ({ ...e, line: 'l' })) };
const back = fromCompact(JSON.parse(JSON.stringify(toCompact(card))));
assert.deepEqual([back.repo, back.grade, back.entries.length, back.entries[0].stat, back.entries[0].face], [card.repo, 'C', 4, card.entries[0].stat, card.entries[0].face]);
assert.equal(fromCompact([2, 'x']), null);
console.log('roast checks ok');

// Guards: the line filter in front of the comedy editor, and the schema check behind llmJSON's one retry.
const { lineProblem, survivors, matchesSchema, knownNumbers } = await import('../src/lib/guards.ts');
const LR = { needs: ['utils', 'validation.ts', '417'], known: knownNumbers('validation.ts 417 lines, 2000ms, 2400'), maxWords: 20 };
assert.equal(lineProblem('validation.ts is 417 lines. That is not a helper, it is a landfill.', LR), null);
assert.equal(lineProblem('validation.ts is 417 lines of shit and shirt.', LR), 'garbled: near-duplicate words');
assert.equal(lineProblem('validation.ts is 417 lines and the the exports pile up.', LR), 'garbled: repeated word');
assert.equal(lineProblem('validation.ts is 417 lines and nobody has opened it since', LR), 'unfinished sentence');
assert.equal(lineProblem('validation.ts is 417 lines, which is longer than the.', LR), 'unfinished sentence');
assert.equal(lineProblem('This file is a landfill with exports.', LR), 'no real stat or name');
assert.equal(lineProblem('validation.ts is 4170 lines. Impressive.', LR), 'invented number 4170');
assert.equal(lineProblem('Fun fact: validation.ts is 417 lines.', LR), 'banned by the voice guide');
assert.equal(lineProblem('validation.ts is 417 lines lol.', LR), 'banned by the voice guide');
assert.equal(lineProblem('validation.ts is 417 lines 😅.', LR), 'emoji or non-English characters');
assert.equal(lineProblem('validation.ts is 417 lines!!', LR), 'exclamation marks');
assert.equal(lineProblem('Whoever wrote validation.ts owes us 417 lines of apology.', LR), 'aimed at people');
assert.equal(lineProblem('validation.ts is 417 lines of sexy helpers.', LR), 'blocklist');
assert.equal(lineProblem('validation.ts is 417 damn lines.', { ...LR, clean: true }), 'swearing in a clean line');
assert.equal(lineProblem('validation.ts is 417 lines, and every single one of them is load-bearing in a way that nobody in this building has ever measured.', LR), 'too long');
assert.equal(lineProblem('Six violations, C grade. Rent is due.', { needs: ['C', '6'] }), null); // number words and the grade count
assert.equal(lineProblem('Violations everywhere. Rent is due.', { needs: ['C', '6'] }), 'no real stat or name');
assert.equal(lineProblem('2000 MILLISECONDS. THAT IS IT. ALSO PAYMENTS IS SLOW. WHY ARE YOU LIKE THIS.', {}), 'more than one outburst');
assert.equal(lineProblem('2000 MILLISECONDS IS THE WHOLE TIMEOUT. utils is fine.', {}), null);
assert.equal(lineProblem('The order and the orders module disagree about `order_id`.', {}), null); // plurals aren't garbles
assert.deepEqual(survivors(['validation.ts: 417 lines of landfill.', 'Validation.ts: 417 lines of landfill.', 'nothing here'], LR), { kept: ['validation.ts: 417 lines of landfill.'], dropped: ['unfinished sentence'] });
const SCH = { type: 'object', required: ['a', 'b'], properties: { a: { type: 'array', items: { type: 'string' } }, b: { type: 'integer' }, c: { type: 'string', enum: ['x', 'y'] } } };
assert.ok(matchesSchema({ a: ['1'], b: 2 }, SCH) && matchesSchema({ a: [], b: 2, c: 'x' }, SCH));
for (const bad of [{ a: ['1'] }, { a: [1], b: 2 }, { a: [], b: 2.5 }, { a: [], b: 2, c: 'z' }, [], null]) assert.ok(!matchesSchema(bad, SCH), JSON.stringify(bad));
console.log('guard checks ok');

// Citation verification: cited lines (±2) must hold a name or value from the sentence; else re-anchor or drop.
const { CiteChecker, CiteStream, claimTerms } = await import('../src/lib/citations.ts');
assert.deepEqual(claimTerms('If the gateway stops after 2000ms, `checkout()` retries up to `MAX_PAYMENT_ATTEMPTS = 2` on UpstreamTimeoutError.').sort(), ['2000', 'MAX_PAYMENT_ATTEMPTS', 'UpstreamTimeoutError', 'checkout'].sort());
assert.deepEqual(claimTerms('I mark the order paid, step 1 of 3.'), []); // nothing to check against
const qlines = () => new CiteChecker(new Map(qr.files.map((f) => [f.path, f.content.replace(/\n$/, '').split('\n')])));
let cc = qlines();
assert.equal(cc.text('The gateway gives up after 2000ms [gateway/config.ts:16].'), 'The gateway gives up after 2000ms [gateway/config.ts:16].'); // verified
assert.equal(cc.text('The gateway gives up after 2000ms [gateway/config.ts:3].'), 'The gateway gives up after 2000ms [gateway/config.ts:16].'); // re-anchored
assert.equal(cc.text('`MAX_PAYMENT_ATTEMPTS` is 2 [orders/checkout.ts:60-64].'), '`MAX_PAYMENT_ATTEMPTS` is 2 [orders/checkout.ts:50-54].'); // nearest match, same length
assert.equal(cc.text('`requestCharge()` sends it [payments/processor.ts:20].'), '`requestCharge()` sends it.'); // not in that file: dropped
assert.equal(cc.text('I mark the order paid [orders/checkout.ts:67].'), 'I mark the order paid [orders/checkout.ts:67].'); // unchecked
assert.equal(cc.text('`checkout()` retries on `UpstreamTimeoutError` [orders/checkout.ts:44-52] after 2000ms [gateway/config.ts:16].'), '`checkout()` retries on `UpstreamTimeoutError` [orders/checkout.ts:44-52] after 2000ms [gateway/config.ts:16].');
assert.equal(cc.text('validation.ts is 417 lines [utils/validation.ts:1-417].'), 'validation.ts is 417 lines [utils/validation.ts:1-417].'); // a line count is about the cite
assert.deepEqual(cc.counts, { verified: 4, repaired: 2, dropped: 1, unchecked: 1 });
cc = qlines();
assert.equal(cc.text('The gateway aborts after 2000ms [gateway/proxy.ts:31].'), 'The gateway aborts after 2000ms [gateway/proxy.ts:31].'); // through UPSTREAM_TIMEOUT_MS = 2000
assert.equal(cc.text('Raising the timeout to 5000ms leaves the abort in place [gateway/proxy.ts:31].'), 'Raising the timeout to 5000ms leaves the abort in place [gateway/proxy.ts:31].'); // 5000 isn't in the code yet
assert.equal(cc.text('`processCharge()` [payments/processor.ts:29] calls `recordCharge()` [payments/processor.ts:38].'), '`processCharge()` [payments/processor.ts:29] calls `recordCharge()` [payments/processor.ts:38].');
assert.equal(cc.text('`checkout()` and `processCharge()` both run here [orders/checkout.ts:33] [payments/processor.ts:29].'), '`checkout()` and `processCharge()` both run here [orders/checkout.ts:33] [payments/processor.ts:29].'); // each name to its own file
assert.equal(cc.text('`processThePayment()` does it [payments/processor.ts:29].'), '`processThePayment()` does it [payments/processor.ts:29].'); // a made-up name can't be checked
assert.deepEqual(cc.counts, { verified: 5, repaired: 0, dropped: 0, unchecked: 2 });
cc = qlines(); // false drops seen in live runs: the citation backs another part of the sentence
assert.equal(cc.text('`checkout()` calls payments, which records the charge [payments/processor.ts:38].'), '`checkout()` calls payments, which records the charge [payments/processor.ts:38].');
assert.equal(cc.text('My helpers in `utils/money.ts` round amounts for `processCharge`; none of that stops a repeat [utils/money.ts:1-5].'), 'My helpers in `utils/money.ts` round amounts for `processCharge`; none of that stops a repeat [utils/money.ts:1-5].');
assert.equal(cc.text('Gateway hands orders a false failure at 2212ms [gateway/config.ts:16].'), 'Gateway hands orders a false failure at 2212ms [gateway/config.ts:16].'); // a number from the log never drops it
assert.equal(cc.text('`UpstreamTimeoutError` is caught here [orders/checkout.ts:60].'), '`UpstreamTimeoutError` is caught here [orders/checkout.ts:50].'); // not the import on line 2
assert.deepEqual(cc.counts, { verified: 0, repaired: 1, dropped: 0, unchecked: 3 });
// Streamed in arbitrary chunks, the same result
const answer = 'Payments takes ~2400ms [payments/processor.ts:3], and `UPSTREAM_TIMEOUT_MS` is 2000 [gateway/config.ts:16].';
for (const size of [1, 3, 7, 50]) {
  const cs = new CiteStream(qlines());
  let got = '';
  for (let i = 0; i < answer.length; i += size) got += cs.push(answer.slice(i, i + size));
  got += cs.end();
  assert.equal(got, 'Payments takes ~2400ms [payments/processor.ts:26], and `UPSTREAM_TIMEOUT_MS` is 2000 [gateway/config.ts:16].', `chunk ${size}`);
}
console.log('citation verification checks ok');

const { judgeFallback } = await import('../src/lib/verdict.ts');
for (const spice of ['clean', 'unhinged', 'feral', 'nuclear']) {
  const j = judgeFallback(spice, ['orders', 'gateway'], 'x');
  assert.ok(j.includes('orders and gateway') && lineProblem(j, { needs: ['orders'], clean: spice === 'clean' }) === null, j);
}
console.log('judge template checks ok');
{
  const { codeFacts } = await import('../src/lib/guards.ts');
  const facts = codeFacts('const UPSTREAM_TIMEOUT_MS = 2000; function processCharge(order_id) {} // see checkout.ts, takes ~2400ms');
  assert.deepEqual([...facts].sort(), ['2000', '2400', 'UPSTREAM_TIMEOUT_MS', 'checkout.ts', 'order_id', 'processCharge'].sort());
  assert.equal(lineProblem('I send `order_id` twice now. Tidy work.', { needs: ['orders'], facts }), null); // a real code name counts
  assert.equal(lineProblem('I get one shot; a 2400ms payment still trips the wire.', { needs: ['orders'], facts }), null);
  assert.equal(lineProblem('I pretend the rename did something. Tidy work.', { needs: ['orders'], facts }), 'no real stat or name');
  assert.equal(lineProblem('A 2000ms fuse under a service that needs 2400ms.', {}), null); // numbers aren't garbles
  console.log('real-fact checks ok');
}
{
  const { CiteChecker, claimTerms } = await import('../src/lib/citations.ts');
  assert.deepEqual(claimTerms('It sets `Content-Type` via `res.send()` and `MAX_TRIES = 2`.').sort(), ['MAX_TRIES', 'send'].sort());
  const cc = new CiteChecker(new Map(qr.files.map((f) => [f.path, f.content.replace(/\n$/, '').split('\n')])));
  assert.equal(cc.text('A customer is charged twice when the gateway aborts and `checkout()` retries [gateway/proxy.ts:31].'), 'A customer is charged twice when the gateway aborts and `checkout()` retries [gateway/proxy.ts:31].');
  assert.equal(cc.text('Then `checkout()` retries [payments/ledger.ts:11].'), 'Then `checkout()` retries.'); // names code from elsewhere, never mentions payments
  assert.equal(lineProblem('I still build the same `Location` header. Stubborn.', { needs: ['lib'], source: "res.set('Location', url)" }), null);
  console.log('citation clause checks ok');
}
{
  const { CiteChecker } = await import('../src/lib/citations.ts');
  const cc = new CiteChecker(new Map(qr.files.map((f) => [f.path, f.content.replace(/\n$/, '').split('\n')])));
  assert.equal(cc.text('`checkout()` asks payments for the money here [orders/checkout.ts:46].'), '`checkout()` asks payments for the money here [orders/checkout.ts:46].'); // inside checkout()
  const js = new CiteChecker(new Map([['r.js', ['res.redirect = function redirect(url) {', '  var body;', '  this.format({', '    text: function(){', "      body = 'Redirecting'", '    }', '  });', '};']]]));
  assert.equal(js.text('`redirect()` builds a text body [r.js:4-5].'), '`redirect()` builds a text body [r.js:4-5].');
  assert.deepEqual([cc.counts.verified, js.counts.verified], [1, 1]);
  console.log('enclosing-function checks ok');
}
{
  // Client-sent code can't make the checker crawl: one 120KB line of letters, many citations.
  const { CiteChecker } = await import('../src/lib/citations.ts');
  const long = 'a'.repeat(120_000);
  const cc = new CiteChecker(new Map([['x.js', [long, 'const MAX_TRIES = 2000;', long + ' = 2000']]]));
  const t0 = Date.now();
  const text = Array.from({ length: 100 }, (_, i) => `\`fooBar${i}\` waits 2000ms [x.js:${(i % 3) + 1}].`).join(' ');
  cc.text(text);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
  assert.equal(cc.counts.verified + cc.counts.repaired + cc.counts.dropped + cc.counts.unchecked, 100);
  console.log('citation cost checks ok');
}
{
  const { CiteChecker } = await import('../src/lib/citations.ts');
  const cc = new CiteChecker(new Map(qr.files.map((f) => [f.path, f.content.replace(/\n$/, '').split('\n')])));
  // a wide citation of the retry loop stays put even though `order_id` lives in requestCharge()
  assert.equal(cc.text('I retry the same charge with the same `order_id` [orders/checkout.ts:44-57].'), 'I retry the same charge with the same `order_id` [orders/checkout.ts:44-57].');
  assert.equal(lineProblem('gateway set 2000ms against a 2400ms path, then acted surprised when it failed.', {}), null); // then/when
  console.log('wide-citation and common-word checks ok');
}
{
  const { CiteChecker } = await import('../src/lib/citations.ts');
  const cc = new CiteChecker(new Map(qr.files.map((f) => [f.path, f.content.replace(/\n$/, '').split('\n')])));
  assert.equal(cc.text('The first charge is still running while `orders` fires a second one [gateway/config.ts:15-17].'), 'The first charge is still running while `orders` fires a second one [gateway/config.ts:15-17].'); // a module name, not code
  const src = 'files: orders/checkout.ts, gateway/config.ts';
  assert.equal(lineProblem('orders/checkout.ts tried once and gateway.config.ts answered with 2000ms.', { source: src }), 'invented file name gateway.config.ts');
  assert.equal(lineProblem('orders/checkout.ts tried once and config.ts answered with 2000ms.', { source: src }), null);
  console.log('module-name and file-name checks ok');
}
{
  const { CiteChecker } = await import('../src/lib/citations.ts');
  const cc = new CiteChecker(new Map([['t.js', ["var request = require('supertest');", '', "describe('app', () => {", "  it('works', () => request(app).get('/'));", '});']]]));
  assert.equal(cc.text('Each test drives the app through `supertest` [t.js:3-4].'), 'Each test drives the app through `supertest` [t.js:3-4].'); // not moved onto the require line
  console.log('import-anchor checks ok');
}
{
  const { unswear, SWEARING } = await import('../src/lib/guards.ts');
  const cases = [
    ['That shit turns one slow charge into a duplicate.', 'That mess turns one slow charge into a duplicate.'],
    ['The gateway stays the same damn mess [gateway/config.ts:16].', 'The gateway stays the same mess [gateway/config.ts:16].'],
    ['Encode the URL before it is written to `Location`, not after the fact, damn it.', 'Encode the URL before it is written to `Location`, not after the fact.'],
    ['A MIME lookup is the library’s opinion, and this damn opinion changes underfoot.', 'A MIME lookup is the library’s opinion, and this opinion changes underfoot.'],
    ['The retry is shit for customers and fucks up the totals.', 'The retry is bad for customers and messes up the totals.'],
  ];
  for (const [a, b] of cases) assert.equal(unswear(a), b);
  for (const [, b] of cases) assert.ok(!SWEARING.test(b), b);
  assert.equal(unswear('`checkout()` retries once [orders/checkout.ts:44-52].'), '`checkout()` retries once [orders/checkout.ts:44-52].');
  console.log('plain-sentence checks ok');
}
{
  // OpenAI spend guard: cost from token usage at gpt-5.4-mini prices, a daily budget, reset at 00:00 UTC.
  const { costOf, makeMeter } = await import('../src/lib/spend.ts');
  assert.ok(Math.abs(costOf(1_000_000, 0, 0) - 0.75) < 1e-9);
  assert.ok(Math.abs(costOf(1_000_000, 1_000_000, 1_000_000) - (0.075 + 4.5)) < 1e-9);
  const m = makeMeter(0.01);
  const day1 = new Date('2026-10-18T23:59:00Z');
  m.add(costOf(6000, 0, 1200), day1); // a chat-sized call: $0.0099
  assert.equal(m.over(day1), false);
  m.add(costOf(1000, 0, 100), day1);
  assert.equal(m.over(day1), true);
  assert.equal(m.over(new Date('2026-10-19T00:00:01Z')), false); // a new day
  assert.equal(m.spent(new Date('2026-10-19T00:00:02Z')), 0);
  console.log('spend guard checks ok');
}
{
  // Reservations: a running call counts at its estimate, settles to its real cost, and a call that never started is refunded.
  const { costOf, makeMeter, reserve } = await import('../src/lib/spend.ts');
  const m = makeMeter(1);
  const a = reserve(40_000, 6000, m), b = reserve(4000, 2048, m);
  assert.ok(Math.abs(m.spent() - (costOf(10_000, 0, 6000) + costOf(1000, 0, 2048))) < 1e-12); // both in flight count
  a.settle(costOf(9000, 0, 2500));
  b.refund();
  assert.ok(Math.abs(m.spent() - costOf(9000, 0, 2500)) < 1e-12);
  reserve(4000, 2048, m); // a stream that never reports usage keeps its estimate
  assert.ok(m.spent() > costOf(9000, 0, 2500));
  console.log('spend reservation checks ok');
}
