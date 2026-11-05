// 随机抽题：Fisher–Yates；rng 可注入以便测试
import { TYPE_LABEL, DIFFICULTY_LABEL } from './question-rules.mjs';

export function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function pickRandom(pool, count, rng = Math.random) {
  return shuffleInPlace(pool.slice(), rng).slice(0, count);
}

export function matchesRule(q, rule) {
  if (q.type !== rule.type) return false;
  if (rule.difficulty && q.difficulty !== rule.difficulty) return false;
  if (rule.tags && rule.tags.length && !(q.tags || []).some((t) => rule.tags.includes(t))) return false;
  return true;
}

export function shortageMessage(s) {
  const conds = [];
  if (s.difficulty) conds.push(`难度：${DIFFICULTY_LABEL[s.difficulty] || s.difficulty}`);
  if (s.tags && s.tags.length) conds.push(`知识点：${s.tags.join('/')}`);
  return `${TYPE_LABEL[s.type] || s.type}${conds.length ? `（${conds.join('，')}）` : ''}仅有 ${s.available} 道，需 ${s.required} 道`;
}

/**
 * @param questions 候选题（含 tags: string[]），已过滤为本人未删除
 * @param rules [{type,count,score,difficulty?,tags?}]
 * @returns {{items:[{rule_index, score, question}]} | {shortages: [...]}}
 */
export function drawByRules(questions, rules, rng = Math.random) {
  const used = new Set();
  const items = [];
  const shortages = [];
  rules.forEach((rule, idx) => {
    const pool = questions.filter((q) => !used.has(q.id) && matchesRule(q, rule));
    if (pool.length < rule.count) {
      shortages.push({
        rule_index: idx, type: rule.type, difficulty: rule.difficulty ?? null, tags: rule.tags || [],
        available: pool.length, required: rule.count,
      });
      pool.forEach((q) => used.add(q.id));
      return;
    }
    for (const q of pickRandom(pool, rule.count, rng)) {
      used.add(q.id);
      items.push({ rule_index: idx, score: rule.score, question: q });
    }
  });
  return shortages.length ? { shortages } : { items };
}
