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
assert.deepEqual(parseCitations('no cites [here] or [x: 3]'), ['no cites [here] or [x: 3]']);

// GitHub URLs
const slug = (s) => parseGitHubUrl(s)?.slug;
assert.equal(slug('https://github.com/expressjs/express'), 'expressjs/express');
assert.equal(slug('https://github.com/expressjs/express.git/'), 'expressjs/express');
assert.equal(slug('github.com/a/b/tree/dev/lib/x/'), 'a/b/tree/dev/lib/x');
assert.equal(slug('owner/repo'), 'owner/repo');
assert.equal(slug('foo/foo.github.io'), 'foo/foo.github.io');
assert.deepEqual([parseGitHubUrl('a/b/tree/main/src').ref, parseGitHubUrl('a/b/tree/main/src').subpath], ['main', 'src']);
for (const bad of ['', 'hello', 'https://gitlab.com/a/b', 'https://github.com/a', 'https://github.com/a/b/blob/main/x.ts'])
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
