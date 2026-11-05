// 单元测试：domain/random-picker（Fisher–Yates、规则匹配、跨规则不重复、题量不足汇总）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shuffleInPlace, pickRandom, matchesRule, drawByRules, shortageMessage } from '../src/domain/random-picker.mjs';

function lcg(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
const pool = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, type: 'single', difficulty: i < 2 ? 'easy' : 'hard', tags: i % 2 ? ['网络'] : ['算法'] })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: 10 + i, type: 'judge', difficulty: 'easy', tags: [] })),
];

test('UT-RAND-01 shuffleInPlace 是排列且 rng 可注入复现', () => {
  const a = shuffleInPlace([1, 2, 3, 4, 5, 6], lcg(1));
  const b = shuffleInPlace([1, 2, 3, 4, 5, 6], lcg(1));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(shuffleInPlace([1, 2, 3], () => 0.999999), [1, 2, 3], 'rng→1 时 j=i 不交换');
});

test('UT-RAND-02 pickRandom 不修改原数组、数量正确、无重复', () => {
  const src = [1, 2, 3, 4, 5];
  const out = pickRandom(src, 3, lcg(7));
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
  assert.equal(out.length, 3);
  assert.equal(new Set(out).size, 3);
});

test('UT-RAND-03 matchesRule：题型/难度/标签命中任一', () => {
  const q = { type: 'single', difficulty: 'easy', tags: ['算法', '网络'] };
  assert.ok(matchesRule(q, { type: 'single' }));
  assert.ok(!matchesRule(q, { type: 'judge' }));
  assert.ok(matchesRule(q, { type: 'single', difficulty: 'easy' }));
  assert.ok(!matchesRule(q, { type: 'single', difficulty: 'hard' }));
  assert.ok(matchesRule(q, { type: 'single', tags: ['网络', 'x'] }));
  assert.ok(!matchesRule(q, { type: 'single', tags: ['x'] }));
  assert.ok(matchesRule({ type: 'single' }, { type: 'single', tags: [] }));
});

test('UT-RAND-04 drawByRules：按规则抽题，跨规则不重复，分值来自规则', () => {
  const rules = [{ type: 'single', count: 2, score: 3, difficulty: 'easy' }, { type: 'single', count: 3, score: 2 }, { type: 'judge', count: 2, score: 1 }];
  const r = drawByRules(pool, rules, lcg(3));
  assert.ok(r.items);
  assert.equal(r.items.length, 7);
  const ids = r.items.map((i) => i.question.id);
  assert.equal(new Set(ids).size, 7, '不得重复');
  assert.ok(r.items.filter((i) => i.rule_index === 0).every((i) => i.question.difficulty === 'easy' && i.score === 3));
  assert.ok(r.items.filter((i) => i.rule_index === 2).every((i) => i.question.type === 'judge' && i.score === 1));
});

test('UT-RAND-05 drawByRules：题量不足时汇总全部 shortages', () => {
  const r = drawByRules(pool, [{ type: 'single', count: 9, score: 1 }, { type: 'judge', count: 1, score: 1 }, { type: 'essay', count: 1, score: 5, tags: ['网络'], difficulty: 'hard' }], lcg());
  assert.equal(r.items, undefined);
  assert.deepEqual(r.shortages.map((s) => [s.rule_index, s.available, s.required]), [[0, 5, 9], [2, 0, 1]]);
  assert.equal(shortageMessage(r.shortages[0]), '单选题仅有 5 道，需 9 道');
  assert.equal(shortageMessage(r.shortages[1]), '简答题（难度：困难，知识点：网络）仅有 0 道，需 1 道');
});

test('UT-RAND-06 随机性：1000 次抽 1 题，各题均被抽到', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(drawByRules(pool, [{ type: 'single', count: 1, score: 1 }]).items[0].question.id);
  assert.equal(seen.size, 5);
});
