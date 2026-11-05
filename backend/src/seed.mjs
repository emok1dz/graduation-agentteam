// seedIfEmpty(repos)：空库时写入演示数据
// 4 个账号、1 个班级、3 个标签、10 道示例题、1 份示例试卷、1 场进行中的示例考试
import { hashPassword } from './domain/password.mjs';
import { TYPE_ORDER, countBlanks } from './domain/question-rules.mjs';
import { now as clockNow } from './core/clock.mjs';
import { round1 } from './domain/scoring.mjs';

const USERS = [
  { username: 'admin', password: 'admin123', name: '系统管理员', role: 'admin' },
  { username: 'teacher1', password: 'teacher123', name: '王老师', role: 'teacher' },
  { username: 'student1', password: 'student123', name: '张三', role: 'student' },
  { username: 'student2', password: 'student123', name: '李四', role: 'student' },
];

const opts = (...texts) => texts.map((text, i) => ({ key: 'ABCDEFGH'[i], text }));

// [题目, 试卷中分值]
const QUESTIONS = [
  [{ type: 'single', difficulty: 'easy', score: 2, tags: ['数据结构'], stem: '栈（Stack）的存取特点是？',
    options: opts('先进先出', '后进先出', '随机存取', '按优先级出队'), answer: 'B', analysis: '栈只允许在栈顶插入和删除，因此后进先出（LIFO）。' }, 10],
  [{ type: 'single', difficulty: 'medium', score: 2, tags: ['网络'], stem: '在 TCP/IP 模型中，HTTP 协议位于哪一层？',
    options: opts('网络层', '传输层', '应用层', '数据链路层'), answer: 'C', analysis: 'HTTP 是应用层协议，基于传输层的 TCP。' }, 10],
  [{ type: 'single', difficulty: 'hard', score: 2, tags: ['算法'], stem: '快速排序在最坏情况下的时间复杂度是？',
    options: opts('O(n)', 'O(n log n)', 'O(n²)', 'O(log n)'), answer: 'C', analysis: '每次划分极不均衡（如已有序且选首元素为基准）时退化为 O(n²)。' }, 10],
  [{ type: 'multiple', difficulty: 'medium', score: 4, tags: ['数据结构'], stem: '以下属于线性结构的有？',
    options: opts('数组', '链表', '二叉树', '队列'), answer: ['A', 'B', 'D'], analysis: '树是非线性结构。' }, 10],
  [{ type: 'multiple', difficulty: 'hard', score: 4, tags: ['算法'], stem: '以下哪些排序算法是稳定的？',
    options: opts('冒泡排序', '快速排序', '归并排序', '堆排序'), answer: ['A', 'C'], analysis: '快速排序与堆排序不稳定。' }, 10],
  [{ type: 'judge', difficulty: 'easy', score: 2, tags: ['算法'], stem: '二分查找要求待查序列有序。',
    options: [], answer: true, analysis: '二分查找依赖有序性来折半缩小范围。' }, 5],
  [{ type: 'judge', difficulty: 'medium', score: 2, tags: ['网络'], stem: 'UDP 是面向连接的可靠传输协议。',
    options: [], answer: false, analysis: 'UDP 无连接、不保证可靠交付；TCP 才是面向连接的可靠协议。' }, 5],
  [{ type: 'fill', difficulty: 'easy', score: 2, tags: ['网络'], stem: 'HTTP 协议默认使用的端口号是 ___。',
    options: [], answer: [['80']], analysis: 'HTTPS 默认端口为 443。' }, 10],
  [{ type: 'fill', difficulty: 'medium', score: 4, tags: ['数据结构'], stem: '栈遵循 ___ 原则，队列遵循 ___ 原则。',
    options: [], answer: [['后进先出', 'LIFO'], ['先进先出', 'FIFO']], analysis: '' }, 10],
  [{ type: 'essay', difficulty: 'hard', score: 10, tags: ['网络'], stem: '简述 TCP 三次握手的过程，并说明为什么需要三次而不是两次。',
    options: [], answer: '①客户端发送 SYN；②服务器回复 SYN+ACK；③客户端回复 ACK。三次握手使双方都确认对方的收发能力正常，并防止已失效的连接请求报文突然到达服务器而错误建立连接。',
    analysis: '要点：过程 3 步（6 分）；必要性（4 分）。' }, 20],
];

export async function seedIfEmpty(repos, { withDemoExam = true } = {}) {
  if (!repos.isEmpty()) return false;
  const hashes = await Promise.all(USERS.map((u) => hashPassword(u.password)));
  await repos.transaction(async (tx) => {
    const now = clockNow();
    const cls = await tx.classes.insert({ name: '计科2101', grade: '2021', major: '计算机科学与技术', remark: '示例班级' });
    const ids = {};
    for (let i = 0; i < USERS.length; i++) {
      const u = USERS[i];
      const doc = await tx.users.insert({
        username: u.username, name: u.name, role: u.role, class_id: u.role === 'student' ? cls.id : null, status: 'active',
        password_hash: hashes[i].hash, password_salt: hashes[i].salt, failed_login_count: 0, locked_until: null,
      });
      ids[u.username] = doc.id;
    }
    const teacherId = ids.teacher1;
    await tx.classes.setTeachers(cls.id, [teacherId]);
    const tagIds = {};
    for (const name of ['数据结构', '算法', '网络']) tagIds[name] = (await tx.tags.insert({ teacher_id: teacherId, name })).id;

    const created = [];
    for (const [q, paperScore] of QUESTIONS) {
      const { tags, ...rest } = q;
      const doc = await tx.questions.insert({
        teacher_id: teacherId, ...rest, blank_count: q.type === 'fill' ? countBlanks(q.stem) : 0, deleted_at: null,
      });
      await tx.questions.setTags(doc.id, tags.map((t) => tagIds[t]));
      created.push({ q: doc, tags, paperScore });
    }
    if (!withDemoExam) return;

    // 示例试卷（快照）
    const sorted = created.map((c, idx) => ({ ...c, idx })).sort((a, b) => TYPE_ORDER[a.q.type] - TYPE_ORDER[b.q.type] || a.idx - b.idx);
    const total = round1(sorted.reduce((s, c) => s + c.paperScore, 0));
    const paper = await tx.papers.insert({
      teacher_id: teacherId, title: '数据结构与网络基础 · 示例试卷', description: '系统内置示例试卷（含五种题型）',
      total_score: total, question_count: sorted.length,
    });
    let seq = 0;
    for (const c of sorted) {
      const { q } = c;
      await tx.papers.insertQuestion({
        paper_id: paper.id, question_id: q.id, seq: ++seq, type: q.type, stem: q.stem, options: q.options, answer: q.answer,
        analysis: q.analysis, difficulty: q.difficulty, blank_count: q.blank_count, tags: c.tags, score: c.paperScore,
      });
    }
    // 进行中的示例考试：开始于 10 分钟前，持续 30 天，时长 90 分钟
    const exam = await tx.exams.insert({
      teacher_id: teacherId, paper_id: paper.id, title: '期中测验（示例 · 进行中）', description: '演示用考试：可直接以 student1 / student2 登录作答。',
      start_time: new Date(now.getTime() - 10 * 60000).toISOString(), end_time: new Date(now.getTime() + 30 * 86400000).toISOString(),
      duration_minutes: 90, pass_score: round1(total * 0.6), shuffle_options: false, cancelled_at: null,
      results_published: false, results_published_at: null, allow_review: true, absent_generated: false,
    });
    await tx.exams.setClasses(exam.id, [cls.id]);
  });
  return true;
}
