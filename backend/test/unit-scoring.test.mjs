// 单元测试：domain/scoring（各题型判分、多选全对才得分、填空分值拆分、作答形状校验）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAnswer, splitFillScore, validateResponseShape, normalizeResponse, round1, round2 } from '../src/domain/scoring.mjs';

const opts = (n) => 'ABCDEFGH'.slice(0, n).split('').map((key) => ({ key, text: key }));
const single = { type: 'single', score: 2, answer: 'B', options: opts(4) };
const multiple = { type: 'multiple', score: 4, answer: ['A', 'C'], options: opts(4) };
const judge = { type: 'judge', score: 2, answer: false, options: [] };
const fill = { type: 'fill', score: 5, blank_count: 2, answer: [['北京', 'Beijing'], ['1949']], options: [] };
const essay = { type: 'essay', score: 10, answer: '参考', options: [] };

test('UT-SCORE-01 单选：答对满分，答错/未答 0 分', () => {
  assert.deepEqual(scoreAnswer(single, 'B'), { score: 2, is_correct: true });
  assert.deepEqual(scoreAnswer(single, 'A'), { score: 0, is_correct: false });
  assert.deepEqual(scoreAnswer(single, null), { score: 0, is_correct: false });
  assert.deepEqual(scoreAnswer(single, undefined), { score: 0, is_correct: false });
});

test('UT-SCORE-02 判断：严格布尔比较（"false" 字符串不算对）', () => {
  assert.deepEqual(scoreAnswer(judge, false), { score: 2, is_correct: true });
  assert.deepEqual(scoreAnswer(judge, true), { score: 0, is_correct: false });
  assert.deepEqual(scoreAnswer(judge, 'false'), { score: 0, is_correct: false });
});

test('UT-SCORE-03 多选：完全一致（与顺序无关）得满分', () => {
  assert.deepEqual(scoreAnswer(multiple, ['A', 'C']), { score: 4, is_correct: true });
  assert.deepEqual(scoreAnswer(multiple, ['C', 'A']), { score: 4, is_correct: true });
});

test('UT-SCORE-04 多选：少选/多选/错选均 0 分（设计文档 §4.1-5，无部分得分）', () => {
  assert.deepEqual(scoreAnswer(multiple, ['A']), { score: 0, is_correct: false }, '少选');
  assert.deepEqual(scoreAnswer(multiple, ['A', 'B', 'C']), { score: 0, is_correct: false }, '多选');
  assert.deepEqual(scoreAnswer(multiple, ['A', 'D']), { score: 0, is_correct: false }, '错选');
  assert.deepEqual(scoreAnswer(multiple, []), { score: 0, is_correct: false }, '空数组');
  assert.deepEqual(scoreAnswer(multiple, 'A'), { score: 0, is_correct: false }, '非数组');
});

test('UT-SCORE-05 填空：trim + 忽略大小写，命中任一可接受答案；逐空得分', () => {
  assert.deepEqual(scoreAnswer(fill, [' beijing ', '1949']), { score: 5, is_correct: true });
  assert.deepEqual(scoreAnswer(fill, ['北京', '1950']), { score: 2.5, is_correct: false });
  assert.deepEqual(scoreAnswer(fill, ['上海', '1949']), { score: 2.5, is_correct: false });
  assert.deepEqual(scoreAnswer(fill, ['', '']), { score: 0, is_correct: false });
  assert.deepEqual(scoreAnswer(fill, ['北京']), { score: 2.5, is_correct: false }, '缺空按错');
  assert.deepEqual(scoreAnswer(fill, 'x'), { score: 0, is_correct: false });
});

test('UT-SCORE-06 填空分值拆分：per=floor(score/n×10)/10，最后一空吸收余数', () => {
  assert.deepEqual(splitFillScore(5, 2), [2.5, 2.5]);
  assert.deepEqual(splitFillScore(10, 3), [3.3, 3.3, 3.4]);
  assert.deepEqual(splitFillScore(1, 3), [0.3, 0.3, 0.4]);
  assert.deepEqual(splitFillScore(2, 1), [2]);
  assert.deepEqual(splitFillScore(0.5, 4), [0.1, 0.1, 0.1, 0.2]);
  assert.deepEqual(splitFillScore(3, 0), []);
  for (const [s, n] of [[10, 3], [7.3, 4], [100, 7], [1, 3]]) {
    assert.equal(round1(splitFillScore(s, n).reduce((a, b) => a + b, 0)), s, `${s}/${n} 合计应等于总分`);
  }
  const f3 = { type: 'fill', score: 10, blank_count: 3, answer: [['a'], ['b'], ['c']] };
  assert.deepEqual(scoreAnswer(f3, ['a', 'x', 'c']), { score: 6.7, is_correct: false });
});

test('UT-SCORE-07 简答：交卷时 score=null 待人工', () => {
  assert.deepEqual(scoreAnswer(essay, '我的回答'), { score: null, is_correct: null });
  assert.deepEqual(scoreAnswer(essay, null), { score: null, is_correct: null });
});

test('UT-SCORE-08 validateResponseShape 各题型形状', () => {
  assert.equal(validateResponseShape(single, null), null);
  assert.ok(validateResponseShape(single, undefined));
  assert.equal(validateResponseShape(single, 'D'), null);
  assert.ok(validateResponseShape(single, 'E'));
  assert.ok(validateResponseShape(single, ['A']));
  assert.equal(validateResponseShape(multiple, ['A', 'B']), null);
  assert.ok(validateResponseShape(multiple, ['A', 'A']), '重复');
  assert.ok(validateResponseShape(multiple, ['Z']));
  assert.ok(validateResponseShape(multiple, 'A'));
  assert.equal(validateResponseShape(judge, true), null);
  assert.ok(validateResponseShape(judge, 'yes'));
  assert.equal(validateResponseShape(fill, ['a', 'b']), null);
  assert.ok(validateResponseShape(fill, ['a']));
  assert.ok(validateResponseShape(fill, ['a', 1]));
  assert.ok(validateResponseShape(fill, ['a', 'x'.repeat(501)]));
  assert.equal(validateResponseShape(essay, '文'.repeat(2000)), null);
  assert.ok(validateResponseShape(essay, '文'.repeat(2001)));
  assert.ok(validateResponseShape(essay, 1));
  assert.ok(validateResponseShape({ type: 'xx' }, 'a'));
});

test('UT-SCORE-09 normalizeResponse 多选升序；round1/round2', () => {
  assert.deepEqual(normalizeResponse(multiple, ['C', 'A']), ['A', 'C']);
  assert.equal(normalizeResponse(single, 'B'), 'B');
  assert.equal(round1(0.15), 0.2);
  assert.equal(round1(2.449), 2.4);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(10 / 3), 3.33);
});
