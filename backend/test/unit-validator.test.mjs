// 单元测试：core/validator 与 domain/question-rules（题目结构校验）、csv、shuffle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Validator, isIso, isScore1, isPlainObject } from '../src/core/validator.mjs';
import { AppError } from '../src/core/errors.mjs';
import { validateQuestionInput, countBlanks } from '../src/domain/question-rules.mjs';
import { toCsv } from '../src/domain/csv.mjs';
import { seededShuffle } from '../src/domain/shuffle.mjs';

test('UT-VAL-01 str：必填/trim/长度/pattern/nullable/def', () => {
  const v = new Validator({ a: '  hi  ', b: '', c: 'x'.repeat(5), d: null, e: 5, f: 'abc' });
  assert.equal(v.str('a', { required: true }), 'hi');
  assert.equal(v.str('b', { required: true, label: 'B' }), undefined);
  assert.equal(v.str('c', { max: 4, label: 'C' }), undefined);
  assert.equal(v.str('d', { nullable: true }), null);
  assert.equal(v.str('e'), undefined);
  assert.equal(v.str('f', { pattern: /^\d+$/, patternMsg: '只能数字' }), undefined);
  assert.equal(v.str('zz', { def: 'D' }), 'D');
  assert.deepEqual(v.errors.map((e) => e.field), ['b', 'c', 'e', 'f']);
  assert.equal(v.errors[0].message, 'B不能为空');
  assert.equal(v.errors[1].message, 'C长度不能超过 4');
  assert.equal(v.errors[3].message, '只能数字');
  assert.throws(() => v.check(), (e) => e instanceof AppError && e.code === 40000 && e.data.errors.length === 4 && e.message === '参数校验失败');
});

test('UT-VAL-02 单个错误时 message 即字段提示', () => {
  const v = new Validator({});
  v.str('name', { required: true, label: '姓名' });
  assert.throws(() => v.check(), (e) => e.message === '姓名不能为空');
  assert.doesNotThrow(() => new Validator({}).check());
});

test('UT-VAL-03 int：query 模式字符串转数字、范围', () => {
  const q = new Validator({ page: '2', size: '0', bad: '1.5', empty: '' }, { query: true });
  assert.equal(q.int('page', { min: 1 }), 2);
  assert.equal(q.int('size', { min: 1, max: 100 }), undefined);
  assert.equal(q.int('bad'), undefined);
  assert.equal(q.int('empty', { def: 7 }), 7);
  assert.equal(q.errors.length, 2);
  const b = new Validator({ n: '3' });
  assert.equal(b.int('n'), undefined, 'body 模式不转换字符串');
});

test('UT-VAL-04 score：最多 1 位小数、gt/min/max', () => {
  const v = new Validator({ a: 2.5, b: 2.55, c: 0, d: 101, e: '3', f: -1 });
  assert.equal(v.score('a', { gt: true }), 2.5);
  assert.equal(v.score('b'), undefined);
  assert.equal(v.score('c', { gt: true }), undefined);
  assert.equal(v.score('d'), undefined);
  assert.equal(v.score('e'), undefined);
  assert.equal(v.score('f'), undefined);
  assert.equal(v.errors.length, 5);
  assert.ok(isScore1(0.1 + 0.2));
  assert.ok(!isScore1(0.05));
});

test('UT-VAL-05 bool/enum/iso/intArray/strArray', () => {
  const v = new Validator({ b: 'true', e: 'x', t: '2026-11-05T08:00:00Z', t2: '2026-13-01', ids: [1, 2, 2], bad: [0, 'a'], tags: [' a ', 'a', 'b'], tags2: [''] });
  assert.equal(v.bool('b'), undefined);
  assert.equal(v.enum('e', ['y', 'z']), undefined);
  assert.equal(v.iso('t'), '2026-11-05T08:00:00.000Z');
  assert.equal(v.iso('t2'), undefined);
  assert.deepEqual(v.intArray('ids', { min: 1 }), [1, 2]);
  assert.equal(v.intArray('bad'), undefined);
  assert.deepEqual(v.strArray('tags'), ['a', 'b']);
  assert.equal(v.strArray('tags2'), undefined);
  assert.deepEqual(v.errors.map((e) => e.field), ['b', 'e', 't2', 'bad[0]', 'bad[1]', 'tags2[0]']);
  const q = new Validator({ b: 'false' }, { query: true });
  assert.equal(q.bool('b'), false);
  assert.ok(isIso('2026-11-05T08:00:00+08:00'));
  assert.ok(!isIso('2026-11-05 08:00'));
  assert.ok(!isIso(123));
  assert.ok(isPlainObject({}) && !isPlainObject([]) && !isPlainObject(null));
});

test('UT-VAL-06 prefix 字段名', () => {
  const v = new Validator({}, { prefix: 'rules[0]' });
  v.str('type', { required: true });
  assert.equal(v.errors[0].field, 'rules[0].type');
});

test('UT-QR-01 validateQuestionInput：五种题型合法输入规范化', () => {
  const opts = [{ key: 'A', text: ' a ' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }];
  const s = validateQuestionInput({ type: 'single', stem: ' 题 ', options: opts, answer: 'A', difficulty: 'easy', score: 2, tags: ['x', 'x'] });
  assert.deepEqual(s.errors, []);
  assert.equal(s.value.stem, '题');
  assert.equal(s.value.options[0].text, 'a');
  assert.deepEqual(s.value.tags, ['x']);
  const m = validateQuestionInput({ type: 'multiple', stem: 'q', options: opts, answer: ['C', 'A'], difficulty: 'easy', score: 2 });
  assert.deepEqual(m.value.answer, ['A', 'C']);
  const f = validateQuestionInput({ type: 'fill', stem: 'a ___ b ___', answer: [[' x ', 'x'], ['y']], difficulty: 'easy', score: 2 });
  assert.equal(f.value.blank_count, 2);
  assert.deepEqual(f.value.answer, [['x'], ['y']]);
  const e = validateQuestionInput({ type: 'essay', stem: 'q', answer: '  ', difficulty: 'hard', score: 10 });
  assert.equal(e.value.answer, null);
  const j = validateQuestionInput({ type: 'judge', stem: 'q', answer: false, difficulty: 'easy', score: 1 });
  assert.equal(j.value.answer, false);
});

test('UT-QR-02 validateQuestionInput：非法输入返回字段级错误', () => {
  const fields = (input) => validateQuestionInput(input).errors.map((e) => e.field);
  assert.deepEqual(validateQuestionInput(null).errors[0].field, 'body');
  assert.ok(fields({ type: 'x', stem: '', difficulty: 'x', score: 0 }).includes('type'));
  assert.deepEqual(fields({ type: 'single', stem: 'q', options: [{ key: 'A', text: 'a' }], answer: 'A', difficulty: 'easy', score: 1 }), ['options']);
  assert.deepEqual(fields({ type: 'single', stem: 'q', options: [{ key: 'A', text: 'a' }, { key: 'C', text: '' }], answer: 'A', difficulty: 'easy', score: 1 }), ['options[1].key', 'options[1].text']);
  assert.deepEqual(fields({ type: 'multiple', stem: 'q', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: ['A'], difficulty: 'easy', score: 1 }), ['answer']);
  assert.deepEqual(fields({ type: 'multiple', stem: 'q', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: ['A', 'A'], difficulty: 'easy', score: 1 }), ['answer']);
  assert.deepEqual(fields({ type: 'judge', stem: 'q', answer: 'true', difficulty: 'easy', score: 1 }), ['answer']);
  assert.deepEqual(fields({ type: 'fill', stem: '无空位', answer: [['a']], difficulty: 'easy', score: 1 }), ['stem']);
  assert.deepEqual(fields({ type: 'fill', stem: '___ ___', answer: [['a']], difficulty: 'easy', score: 1 }), ['answer']);
  assert.deepEqual(fields({ type: 'fill', stem: '___', answer: [['']], difficulty: 'easy', score: 1 }), ['answer[0][0]']);
  assert.deepEqual(fields({ type: 'essay', stem: 'q', answer: 'a', difficulty: 'easy', score: 100.5 }), ['score']);
  assert.deepEqual(fields({ type: 'essay', stem: 'x'.repeat(2001), difficulty: 'easy', score: 1 }), ['stem']);
  assert.deepEqual(fields({ type: 'essay', stem: 'q', difficulty: 'easy', score: 1, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), ['tags']);
  assert.equal(countBlanks('a___b___c______'), 4);
  assert.equal(countBlanks(null), 0);
});

test('UT-CSV-01 toCsv：BOM、转义逗号/引号/换行、null 为空', () => {
  const s = toCsv(['a', 'b'], [['x,y', 'he said "hi"'], [null, 'l1\nl2']]);
  assert.equal(s, '﻿a,b\r\n"x,y","he said ""hi"""\r\n,"l1\nl2"\r\n');
});

test('UT-SHUF-01 seededShuffle：同种子结果相同、是排列、不改原数组', () => {
  const src = ['A', 'B', 'C', 'D', 'E'];
  const a = seededShuffle(src, 12345);
  assert.deepEqual(a, seededShuffle(src, 12345));
  assert.deepEqual([...a].sort(), src);
  assert.deepEqual(src, ['A', 'B', 'C', 'D', 'E']);
});
