// 接口集成测试：题库 CRUD 与校验（FR-QB-01~05）、组卷（FR-PAPER-01~03）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, clock, SEED, Q } from './helpers/harness.mjs';

let h, tk;
before(async () => {
  clock.setNow(Date.parse('2026-11-05T02:00:00.000Z'));
  h = await startHarness({ seed: true });
  tk = await h.login(...SEED.teacher1);
});
after(() => h.close());
const mk = async (body) => h.ok(await h.api('POST', '/api/questions', { token: tk, body }), 201);

test('IT-QB-01 新增五种题型：201，返回规范化字段（多选答案排序、填空 blank_count、标签自动创建）', async () => {
  const s = await mk(Q.single({ tags: ['QB新标签'] }));
  assert.equal(s.type, 'single');
  assert.deepEqual(s.tags, ['QB新标签']);
  const m = await mk(Q.multiple({ answer: ['C', 'A'] }));
  assert.deepEqual(m.answer, ['A', 'C']);
  const f = await mk(Q.fill());
  assert.equal(f.blank_count, 2);
  const j = await mk(Q.judge());
  assert.equal(j.answer, true);
  const e = await mk(Q.essay());
  assert.equal(e.answer, '参考答案');
  const tags = h.ok(await h.api('GET', '/api/tags', { token: tk }));
  assert.ok((tags.items || tags).some((t) => t.name === 'QB新标签'));
});

test('IT-QB-02 题目校验失败：40000 + 字段级 errors', async () => {
  const cases = [
    [{ ...Q.single(), options: [{ key: 'A', text: 'x' }] }, 'options'],
    [{ ...Q.single(), answer: 'Z' }, 'answer'],
    [{ ...Q.multiple(), answer: ['A'] }, 'answer'],
    [{ ...Q.judge(), answer: 'yes' }, 'answer'],
    [{ ...Q.fill(), stem: '没有空位' }, 'stem'],
    [{ ...Q.fill(), answer: [['a']] }, 'answer'],
    [{ ...Q.essay(), score: 0 }, 'score'],
    [{ ...Q.essay(), score: 1.25 }, 'score'],
    [{ ...Q.essay(), difficulty: 'super' }, 'difficulty'],
    [{ ...Q.essay(), type: 'code' }, 'type'],
    [{ ...Q.essay(), stem: '   ' }, 'stem'],
  ];
  for (const [body, field] of cases) {
    const r = h.err(await h.api('POST', '/api/questions', { token: tk, body }), 400, 40000);
    assert.ok(r.data.errors.some((e) => e.field === field), `${field}: ${JSON.stringify(r.data.errors)}`);
  }
});

test('IT-QB-03 检索筛选：题型/难度/关键字/标签/exclude_ids/分页 + summary 汇总', async () => {
  const all = h.ok(await h.api('GET', '/api/questions?page_size=100', { token: tk }));
  const singles = h.ok(await h.api('GET', '/api/questions?type=single', { token: tk }));
  assert.ok(singles.items.every((q) => q.type === 'single'));
  assert.equal(singles.total, all.summary.by_type.single);
  const hard = h.ok(await h.api('GET', '/api/questions?difficulty=hard', { token: tk }));
  assert.ok(hard.items.every((q) => q.difficulty === 'hard'));
  const kw = h.ok(await h.api('GET', `/api/questions?keyword=${encodeURIComponent('偶数')}`, { token: tk }));
  assert.equal(kw.total, 1);
  const tg = h.ok(await h.api('GET', `/api/questions?tags=${encodeURIComponent('QB新标签')}`, { token: tk }));
  assert.equal(tg.total, 1);
  const ex = h.ok(await h.api('GET', `/api/questions?page_size=100&exclude_ids=${tg.items[0].id}`, { token: tk }));
  assert.equal(ex.total, all.total - 1);
  const p1 = h.ok(await h.api('GET', '/api/questions?page=1&page_size=3', { token: tk }));
  assert.equal(p1.items.length, 3);
  assert.equal(p1.total, all.total);
  h.err(await h.api('GET', '/api/questions?type=bad', { token: tk }), 400, 40000);
  h.err(await h.api('GET', '/api/questions?exclude_ids=a,b', { token: tk }), 400, 40000);
});

test('IT-QB-04 编辑题目：成功更新；试卷快照不受影响（快照隔离）', async () => {
  const q = await mk(Q.single({ stem: '原题干' }));
  const paper = h.ok(await h.api('POST', '/api/papers', { token: tk, body: { title: '快照卷', items: [{ question_id: q.id, score: 5 }] } }), 201);
  const upd = h.ok(await h.api('PUT', `/api/questions/${q.id}`, { token: tk, body: Q.single({ stem: '新题干', answer: 'C' }) }));
  assert.equal(upd.stem, '新题干');
  const p2 = h.ok(await h.api('GET', `/api/papers/${paper.id}`, { token: tk }));
  assert.equal(p2.questions[0].stem, '原题干');
  assert.equal(p2.questions[0].answer, 'B');
  h.err(await h.api('PUT', `/api/questions/${q.id}`, { token: tk, body: { ...Q.single(), answer: 'Z' } }), 400, 40000);
});

test('IT-QB-05 删除题目：逻辑删除后不可见、返回引用数；再次删除 404', async () => {
  const q = await mk(Q.judge({ stem: '待删除' }));
  h.ok(await h.api('POST', '/api/papers', { token: tk, body: { title: '引用卷', items: [{ question_id: q.id, score: 1 }] } }), 201);
  const r = h.ok(await h.api('DELETE', `/api/questions/${q.id}`, { token: tk }));
  assert.equal(r.ref_count, 1);
  h.err(await h.api('GET', `/api/questions/${q.id}`, { token: tk }), 404, 40400);
  h.err(await h.api('DELETE', `/api/questions/${q.id}`, { token: tk }), 404, 40400);
  const list = h.ok(await h.api('GET', `/api/questions?keyword=${encodeURIComponent('待删除')}`, { token: tk }));
  assert.equal(list.total, 0);
});

test('IT-QB-06 标签管理：创建/重名 40900/重命名/删除', async () => {
  const t = h.ok(await h.api('POST', '/api/tags', { token: tk, body: { name: '临时标签' } }), 201);
  h.err(await h.api('POST', '/api/tags', { token: tk, body: { name: '临时标签' } }), 409, 40900);
  const r = h.ok(await h.api('PUT', `/api/tags/${t.id}`, { token: tk, body: { name: '改名标签' } }));
  assert.equal(r.name, '改名标签');
  h.ok(await h.api('DELETE', `/api/tags/${t.id}`, { token: tk }));
});

test('IT-QB-07 批量导入：部分成功，返回失败下标与错误', async () => {
  const r = h.ok(await h.api('POST', '/api/questions/import', { token: tk, body: { questions: [Q.single({ stem: '导入1' }), { type: 'single' }, Q.essay({ stem: '导入2' })] } }));
  assert.equal(r.success_count, 2);
  assert.equal(r.fail_count, 1);
  assert.equal(r.failures[0].index, 1);
  h.err(await h.api('POST', '/api/questions/import', { token: tk, body: { questions: [] } }), 400, 40000);
});

test('IT-PAPER-01 手动组卷：按题型排序、seq 连续、总分=Σ分值（含 1 位小数）', async () => {
  const s = await mk(Q.single());
  const m = await mk(Q.multiple());
  const e = await mk(Q.essay());
  const p = h.ok(await h.api('POST', '/api/papers', { token: tk, body: { title: '手动卷', items: [{ question_id: e.id, score: 10.5 }, { question_id: m.id, score: 4.2 }, { question_id: s.id, score: 2.1 }] } }), 201);
  assert.deepEqual(p.questions.map((q) => q.type), ['single', 'multiple', 'essay']);
  assert.deepEqual(p.questions.map((q) => q.seq), [1, 2, 3]);
  assert.equal(p.total_score, 16.8);
  assert.equal(p.question_count, 3);
  assert.deepEqual(p.type_stats.map((t) => [t.type, t.count, t.score]), [['single', 1, 2.1], ['multiple', 1, 4.2], ['essay', 1, 10.5]]);
});

test('IT-PAPER-02 组卷校验：空题目、重复题、分值非法、题目不存在', async () => {
  const s = await mk(Q.single());
  h.err(await h.api('POST', '/api/papers', { token: tk, body: { title: 'x', items: [] } }), 400, 40000);
  h.err(await h.api('POST', '/api/papers', { token: tk, body: { title: '', items: [{ question_id: s.id, score: 1 }] } }), 400, 40000);
  h.err(await h.api('POST', '/api/papers', { token: tk, body: { title: 'x', items: [{ question_id: s.id, score: 1 }, { question_id: s.id, score: 1 }] } }), 400, 40000);
  h.err(await h.api('POST', '/api/papers', { token: tk, body: { title: 'x', items: [{ question_id: s.id, score: 0 }] } }), 400, 40000);
  h.err(await h.api('POST', '/api/papers', { token: tk, body: { title: 'x', items: [{ question_id: s.id, score: 1.55 }] } }), 400, 40000);
  const r = await h.api('POST', '/api/papers', { token: tk, body: { title: 'x', items: [{ question_id: 999999, score: 1 }] } });
  assert.ok([400, 404].includes(r.status) && [40000, 40400].includes(r.code), JSON.stringify(r));
});

test('IT-PAPER-03 随机组卷：按规则抽题、分值合计、跨规则不重复；不足 422 汇总 shortages', async () => {
  for (let i = 0; i < 3; i++) await mk(Q.judge({ stem: `随机判断${i}`, difficulty: 'hard', tags: ['随机'] }));
  const d = h.ok(await h.api('POST', '/api/papers/random/generate', { token: tk, body: { rules: [{ type: 'judge', count: 2, score: 3, difficulty: 'hard', tags: ['随机'] }, { type: 'single', count: 2, score: 2.5 }] } }));
  assert.equal(d.items.length, 4);
  assert.equal(d.total_score, 11);
  assert.equal(new Set(d.items.map((i) => i.question.id)).size, 4);
  assert.ok(d.items.filter((i) => i.rule_index === 0).every((i) => i.question.difficulty === 'hard' && i.question.tags.includes('随机')));
  const short = h.err(await h.api('POST', '/api/papers/random/generate', { token: tk, body: { rules: [{ type: 'judge', count: 5, score: 1, tags: ['随机'] }, { type: 'essay', count: 99, score: 1 }] } }), 422, 42200);
  assert.equal(short.data.shortages.length, 2);
  assert.equal(short.data.shortages[0].available, 3);
  h.err(await h.api('POST', '/api/papers/random/generate', { token: tk, body: { rules: [] } }), 400, 40000);
  h.err(await h.api('POST', '/api/papers/random/generate', { token: tk, body: { rules: [{ type: 'judge', count: 0, score: 1 }] } }), 400, 40000);
  // 保存随机草稿
  const p = h.ok(await h.api('POST', '/api/papers', { token: tk, body: { title: '随机卷', items: d.items.map((i) => ({ question_id: i.question.id, score: i.score })) } }), 201);
  assert.equal(p.total_score, 11);
  // 替换一题：排除已选后仍有剩余
  const ids = d.items.filter((i) => i.rule_index === 0).map((i) => i.question.id);
  const rep = h.ok(await h.api('POST', '/api/papers/random/replace', { token: tk, body: { type: 'judge', difficulty: 'hard', tags: ['随机'], exclude_question_ids: ids } }));
  assert.ok(!ids.includes(rep.id));
  const all3 = h.ok(await h.api('GET', `/api/questions?tags=${encodeURIComponent('随机')}`, { token: tk })).items.map((q) => q.id);
  h.err(await h.api('POST', '/api/papers/random/replace', { token: tk, body: { type: 'judge', tags: ['随机'], exclude_question_ids: all3 } }), 422, 42200);
});

test('IT-PAPER-04 试卷列表/编辑/复制/删除；被考试引用后锁定 40903', async () => {
  const s = await mk(Q.single());
  const p = h.ok(await h.api('POST', '/api/papers', { token: tk, body: { title: '可编辑卷', items: [{ question_id: s.id, score: 2 }] } }), 201);
  const u = h.ok(await h.api('PUT', `/api/papers/${p.id}`, { token: tk, body: { title: '已改名', items: [{ question_id: s.id, score: 7 }] } }));
  assert.equal(u.total_score, 7);
  assert.equal(u.title, '已改名');
  const c = h.ok(await h.api('POST', `/api/papers/${p.id}/copy`, { token: tk, body: { title: '副本' } }), 201);
  assert.equal(c.total_score, 7);
  assert.notEqual(c.id, p.id);
  const list = h.ok(await h.api('GET', '/api/papers?keyword=' + encodeURIComponent('副本'), { token: tk }));
  assert.equal(list.total, 1);
  h.ok(await h.api('DELETE', `/api/papers/${c.id}`, { token: tk }));
  h.err(await h.api('GET', `/api/papers/${c.id}`, { token: tk }), 404, 40400);
  // 锁定
  const admin = await h.login(...SEED.admin);
  const classes = h.ok(await h.api('GET', '/api/classes', { token: admin }));
  const now = clock.nowMs();
  h.ok(await h.api('POST', '/api/exams', { token: tk, body: { title: '锁卷考试', paper_id: p.id, class_ids: [classes.items[0].id], duration_minutes: 5, start_time: new Date(now + 60_000).toISOString(), end_time: new Date(now + 600_000).toISOString() } }), 201);
  const g = h.ok(await h.api('GET', `/api/papers/${p.id}`, { token: tk }));
  assert.equal(g.locked, true);
  h.err(await h.api('PUT', `/api/papers/${p.id}`, { token: tk, body: { title: 'x', items: [{ question_id: s.id, score: 1 }] } }), 409, 40903);
  h.err(await h.api('DELETE', `/api/papers/${p.id}`, { token: tk }), 409, 40903);
  h.ok(await h.api('POST', `/api/papers/${p.id}/copy`, { token: tk, body: {} }), 201);
});
