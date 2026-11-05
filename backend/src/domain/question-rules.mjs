// 题目结构校验（契约 QuestionInput）
import { Validator, isPlainObject } from '../core/validator.mjs';

export const QUESTION_TYPES = ['single', 'multiple', 'judge', 'fill', 'essay'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const OBJECTIVE_TYPES = ['single', 'multiple', 'judge', 'fill'];
export const TYPE_ORDER = { single: 1, multiple: 2, judge: 3, fill: 4, essay: 5 };
export const TYPE_LABEL = { single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题', essay: '简答题' };
export const DIFFICULTY_LABEL = { easy: '简单', medium: '中等', hard: '困难' };
const KEYS = 'ABCDEFGH';

export function countBlanks(stem) {
  return typeof stem === 'string' ? stem.split('___').length - 1 : 0;
}

/**
 * 校验并规范化题目输入
 * @returns {{errors: {field,message}[], value: object|null}}
 */
export function validateQuestionInput(input, prefix = '') {
  const vd = new Validator(input, { prefix });
  if (!isPlainObject(input)) {
    return { errors: [{ field: prefix || 'body', message: '题目必须为对象' }], value: null };
  }
  const type = vd.enum('type', QUESTION_TYPES, { required: true, label: '题型' });
  const stem = vd.str('stem', { required: true, min: 1, max: 2000, label: '题干' });
  const difficulty = vd.enum('difficulty', DIFFICULTIES, { required: true, label: '难度' });
  const score = vd.score('score', { required: true, gt: true, min: 0, max: 100, label: '分值' });
  const analysis = vd.str('analysis', { max: 2000, def: '', label: '解析' }) ?? '';
  const tags = vd.strArray('tags', { max: 5, itemMax: 20, label: '标签' });

  let options = [];
  let answer = null;
  let blank_count = 0;
  const rawAnswer = input.answer;

  if (type === 'single' || type === 'multiple') {
    const opts = input.options;
    if (!Array.isArray(opts)) vd.err('options', '选项必须为数组');
    else if (opts.length < 2 || opts.length > 8) vd.err('options', '选项数量须为 2~8 个');
    else {
      let ok = true;
      opts.forEach((o, i) => {
        if (!isPlainObject(o)) {
          ok = false;
          return vd.err(`options[${i}]`, '选项格式不正确');
        }
        if (o.key !== KEYS[i]) {
          ok = false;
          vd.err(`options[${i}].key`, `选项编号必须依次为 A、B、C…，此处应为 ${KEYS[i]}`);
        }
        if (typeof o.text !== 'string' || o.text.trim() === '') {
          ok = false;
          vd.err(`options[${i}].text`, '选项内容不能为空');
        } else if ([...o.text.trim()].length > 500) {
          ok = false;
          vd.err(`options[${i}].text`, '选项内容不能超过 500 字');
        }
      });
      if (ok) options = opts.map((o) => ({ key: o.key, text: o.text.trim() }));
      const keys = opts.map((_, i) => KEYS[i]);
      if (type === 'single') {
        if (typeof rawAnswer !== 'string' || !keys.includes(rawAnswer)) vd.err('answer', '单选题答案必须为某个选项编号');
        else answer = rawAnswer;
      } else if (!Array.isArray(rawAnswer)) vd.err('answer', '多选题答案必须为选项编号数组');
      else {
        const set = [...new Set(rawAnswer)];
        if (set.length !== rawAnswer.length) vd.err('answer', '多选题答案不能重复');
        else if (set.length < 2) vd.err('answer', '多选题答案至少 2 个');
        else if (!set.every((k) => typeof k === 'string' && keys.includes(k))) vd.err('answer', '多选题答案必须为已有选项编号');
        else answer = set.sort();
      }
    }
  } else if (type === 'judge') {
    if (typeof rawAnswer !== 'boolean') vd.err('answer', '判断题答案必须为 true 或 false');
    else answer = rawAnswer;
  } else if (type === 'fill') {
    blank_count = countBlanks(stem);
    if (stem !== undefined && blank_count < 1) vd.err('stem', '填空题题干须用 ___（三个下划线）标记至少 1 个空位');
    if (!Array.isArray(rawAnswer)) vd.err('answer', '填空题答案必须为数组（每空一组可接受答案）');
    else if (blank_count >= 1 && rawAnswer.length !== blank_count) vd.err('answer', `空位数（${blank_count}）与答案组数（${rawAnswer.length}）不一致`);
    else if (blank_count >= 1) {
      let ok = true;
      const out = rawAnswer.map((group, i) => {
        if (!Array.isArray(group) || group.length < 1 || group.length > 10) {
          ok = false;
          vd.err(`answer[${i}]`, `第 ${i + 1} 空须有 1~10 个可接受答案`);
          return null;
        }
        const g = [];
        group.forEach((s, j) => {
          if (typeof s !== 'string' || s.trim() === '') {
            ok = false;
            vd.err(`answer[${i}][${j}]`, `第 ${i + 1} 空的答案不能为空`);
          } else if ([...s.trim()].length > 200) {
            ok = false;
            vd.err(`answer[${i}][${j}]`, '答案长度不能超过 200');
          } else g.push(s.trim());
        });
        return [...new Set(g)];
      });
      if (ok) answer = out;
    }
  } else if (type === 'essay') {
    if (rawAnswer === undefined || rawAnswer === null) answer = null;
    else if (typeof rawAnswer !== 'string') vd.err('answer', '简答题参考答案必须为字符串');
    else if ([...rawAnswer].length > 2000) vd.err('answer', '参考答案不能超过 2000 字');
    else answer = rawAnswer.trim() === '' ? null : rawAnswer;
  }
  if (vd.errors.length) return { errors: vd.errors, value: null };
  return {
    errors: [],
    value: { type, stem, options, answer, analysis, difficulty, tags: tags || [], score, blank_count },
  };
}
