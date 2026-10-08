import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCollection, compareCollections, normalizeRelativePath } from '../core/graph.mjs';

const codes = (mods) => analyzeCollection(mods).findings.map((item) => item.code);
const mod = (id, extra = {}) => ({ id, name: id, game: 'test-game', files: [], dependencies: [], ...extra });

test('normalizes separators, dot segments, and case-folding key', () => {
  assert.deepEqual(normalizeRelativePath('A\\.\\B//File.TXT'), { key: 'a/b/file.txt', display: 'A/B/File.TXT' });
});

test('rejects traversal, absolute, drive-relative, URL, and empty paths', () => {
  for (const path of ['../x', 'a/../x', '/root/x', 'C:\\x', 'C:relative', 'https://host/x', '', './']) {
    assert.equal(normalizeRelativePath(path), null, path);
  }
});

test('reports duplicate IDs once and counts extra records', () => {
  const result = analyzeCollection([mod('a'), mod('a', { files: [{ path: 'ignored.txt' }] }), mod('a')]);
  assert.equal(result.summary.duplicateIdCount, 1);
  assert.equal(result.summary.totalMods, 1);
  assert.equal(result.findings.filter((f) => f.code === 'DUPLICATE_MOD_ID').length, 1);
  assert.equal(result.pathIndex['ignored.txt'], undefined);
});

test('reports missing required dependency but ignores missing optional dependency', () => {
  const result = analyzeCollection([mod('a', { dependencies: [{ id: 'missing' }, { id: 'optional', optional: true }] })]);
  assert.equal(result.findings.filter((f) => f.code === 'MISSING_DEPENDENCY').length, 1);
  assert.equal(result.findings.find((f) => f.code === 'MISSING_DEPENDENCY').missingId, 'missing');
});

test('reports a required dependency that is disabled', () => {
  assert.ok(codes([mod('a', { dependencies: [{ id: 'b' }] }), mod('b', { enabled: false })]).includes('DISABLED_REQUIRED_DEPENDENCY'));
});

test('finds dependency cycles with a closed path', () => {
  const result = analyzeCollection([
    mod('a', { dependencies: [{ id: 'b' }] }),
    mod('b', { dependencies: [{ id: 'c' }] }),
    mod('c', { dependencies: [{ id: 'a' }] }),
  ]);
  const cycle = result.findings.find((f) => f.code === 'DEPENDENCY_CYCLE');
  assert.deepEqual(cycle.path, ['a', 'b', 'c', 'a']);
});

test('iteratively processes deep dependency graph without recursion', () => {
  const mods = Array.from({ length: 12000 }, (_, i) => mod(`m${i}`, { dependencies: i ? [{ id: `m${i - 1}` }] : [] }));
  const result = analyzeCollection(mods);
  assert.equal(result.dependencyGraph.nodes.length, 12000);
  assert.equal(result.dependencyGraph.edges.length, 11999);
  assert.equal(result.findings.some((f) => f.code === 'DEPENDENCY_CYCLE'), false);
});

test('reports load order contradiction and load-after cycle', () => {
  const result = analyzeCollection([
    mod('a', { order: 1, loadAfter: ['b'] }),
    mod('b', { order: 2, loadAfter: ['a'] }),
  ]);
  assert.equal(result.findings.filter((f) => f.code === 'LOAD_ORDER_CONFLICT').length, 1);
  assert.equal(result.findings.filter((f) => f.code === 'LOAD_AFTER_CYCLE').length, 1);
});

test('normalizes paths before collision lookup and exact hash matches', () => {
  const result = analyzeCollection([
    mod('a', { files: [{ path: 'Common\\Ideas\\x.txt', size: 3, hash: 'abc' }] }),
    mod('b', { files: [{ path: 'common/ideas/x.txt', size: 3, hash: 'abc' }] }),
  ]);
  assert.equal(result.summary.uniquePaths, 1);
  assert.ok(result.findings.some((f) => f.code === 'SHARED_PATH'));
  assert.ok(result.findings.some((f) => f.code === 'CONTENT_HASH_MATCH' && f.hash === 'abc'));
});

test('shared path is only a warning even when hashes differ', () => {
  const result = analyzeCollection([
    mod('a', { files: [{ path: 'data/x', hash: 'one' }] }),
    mod('b', { files: [{ path: 'data/x', hash: 'two' }] }),
  ]);
  assert.equal(result.findings.find((f) => f.code === 'SHARED_PATH').severity, 'warning');
  assert.equal(result.findings.some((f) => f.code === 'CONTENT_HASH_MATCH'), false);
});

test('reports unsafe path and excludes service files', () => {
  const result = analyzeCollection([mod('a', { files: [
    { path: '../evil' }, { path: 'README.md' }, { path: 'sub/LICENSE.txt' }, { path: '.git/config' }, { path: 'thumbnail.png' }, { path: 'real/data.txt' },
  ] })]);
  assert.equal(result.findings.filter((f) => f.code === 'UNSAFE_PATH').length, 1);
  assert.deepEqual(Object.keys(result.pathIndex), ['real/data.txt']);
});

test('reports mutual manifest conflict and unilateral declarations distinctly', () => {
  const mutual = analyzeCollection([mod('a', { conflictsWith: ['b'] }), mod('b', { conflictsWith: ['a'] })]);
  assert.equal(mutual.findings.filter((f) => f.code === 'DECLARED_CONFLICT').length, 1);
  const oneSided = analyzeCollection([mod('a', { conflictsWith: ['b'] }), mod('b')]);
  assert.equal(oneSided.findings.filter((f) => f.code === 'UNILATERAL_CONFLICT').length, 1);
});

test('compare reports additions, removals, changes, and order updates', () => {
  const result = compareCollections(
    [mod('a', { order: 1, files: [{ path: 'x', size: 1, hash: 'old' }] }), mod('b')],
    [mod('a', { order: 2, files: [{ path: 'x', size: 2, hash: 'new' }] }), mod('c')],
  );
  assert.deepEqual(result.added.map((x) => x.id), ['c']);
  assert.deepEqual(result.removed.map((x) => x.id), ['b']);
  assert.equal(result.updated[0].changes.order.to, 2);
  assert.equal(result.updated[0].changes.files.changed.length, 1);
});

test('cautiously matches renamed IDs by unique game and name', () => {
  const result = compareCollections([mod('old', { name: 'Same title' })], [mod('new', { name: 'Same title' })]);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
  assert.equal(result.updated[0].matchedBy, 'game+name');
  assert.equal(result.updated[0].previousId, 'old');
});

test('ambiguous game/name matches remain added and removed', () => {
  const result = compareCollections([mod('old1'), mod('old2')], [mod('new')]);
  assert.equal(result.added.length, 1);
  assert.equal(result.removed.length, 2);
});

test('does not mutate inputs and emits stable JSON', () => {
  const input = [mod('b', { files: [{ path: 'z' }] }), mod('a', { dependencies: [{ id: 'b' }] })];
  const snapshot = structuredClone(input);
  const first = JSON.stringify(analyzeCollection(input));
  const second = JSON.stringify(analyzeCollection(input));
  assert.deepEqual(input, snapshot);
  assert.equal(first, second);
});
