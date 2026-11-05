// 【可选】生成 NFR-14 演示数据：在内置种子基础上补充到 2 教师、2 班、≥20 学生、≥30 题、1 场进行中考试
// 用法：node scripts/seed-demo.mjs [--reset]   （DATA_DIR 环境变量可指定数据目录；--reset 先删除已有 db.json）
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { JsonStore } from '../src/repositories/json-store.mjs';
import { createRepositories } from '../src/repositories/index.mjs';
import { seedIfEmpty } from '../src/seed.mjs';
import { hashPassword } from '../src/domain/password.mjs';

const config = loadConfig();
const file = path.join(config.DATA_DIR, 'db.json');
if (process.argv.includes('--reset')) await fs.rm(file, { force: true });
const store = await JsonStore.open(file);
const repos = createRepositories(store);
if (!repos.isEmpty()) {
  console.error(`数据文件已存在且非空：${file}\n如需重新生成请加 --reset（将删除现有数据）`);
  process.exit(1);
}
await seedIfEmpty(repos);

const students = [];
for (let i = 3; i <= 22; i++) students.push({ username: `student${String(i).padStart(2, '0')}`, name: `学生${i}` });
const hashes = await Promise.all([hashPassword('teacher123'), ...students.map(() => hashPassword('student123'))]);

const TOPICS = [
  ['数据结构', '线性表'], ['数据结构', '树'], ['算法', '排序'], ['算法', '查找'], ['网络', '协议'],
];
await repos.transaction(async (tx) => {
  const t2 = await tx.users.insert({
    username: 'teacher2', name: '李老师', role: 'teacher', class_id: null, status: 'active',
    password_hash: hashes[0].hash, password_salt: hashes[0].salt, failed_login_count: 0, locked_until: null,
  });
  const c1 = await tx.classes.findByName('计科2101');
  const c2 = await tx.classes.insert({ name: '计科2102', grade: '2021', major: '计算机科学与技术', remark: '演示班级' });
  await tx.classes.setTeachers(c2.id, [t2.id, (await tx.users.findByUsername('teacher1')).id]);
  for (let i = 0; i < students.length; i++) {
    await tx.users.insert({
      ...students[i], role: 'student', class_id: i < 10 ? c1.id : c2.id, status: 'active',
      password_hash: hashes[i + 1].hash, password_salt: hashes[i + 1].salt, failed_login_count: 0, locked_until: null,
    });
  }
  // 为 teacher1 再生成 25 道题（共 35 道）
  const teacherId = (await tx.users.findByUsername('teacher1')).id;
  const tagIds = new Map((await tx.tags.findMany({ teacher_id: teacherId })).map((t) => [t.name, t.id]));
  const diffs = ['easy', 'medium', 'hard'];
  for (let i = 1; i <= 25; i++) {
    const [tag, topic] = TOPICS[i % TOPICS.length];
    const difficulty = diffs[i % 3];
    let q;
    switch (i % 5) {
      case 0: q = { type: 'single', stem: `【${topic}】演示单选题 ${i}`, options: [{ key: 'A', text: '选项一' }, { key: 'B', text: '选项二' }, { key: 'C', text: '选项三' }, { key: 'D', text: '选项四' }], answer: 'ABCD'[i % 4], score: 2, blank_count: 0 }; break;
      case 1: q = { type: 'multiple', stem: `【${topic}】演示多选题 ${i}`, options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }, { key: 'D', text: '丁' }], answer: ['A', 'C'], score: 4, blank_count: 0 }; break;
      case 2: q = { type: 'judge', stem: `【${topic}】演示判断题 ${i}`, options: [], answer: i % 2 === 0, score: 2, blank_count: 0 }; break;
      case 3: q = { type: 'fill', stem: `【${topic}】演示填空题 ${i}：答案是 ___`, options: [], answer: [[String(i)]], score: 3, blank_count: 1 }; break;
      default: q = { type: 'essay', stem: `【${topic}】演示简答题 ${i}`, options: [], answer: '参考答案要点', score: 10, blank_count: 0 };
    }
    const doc = await tx.questions.insert({ teacher_id: teacherId, ...q, analysis: '', difficulty, deleted_at: null });
    await tx.questions.setTags(doc.id, [tagIds.get(tag)]);
  }
  // 示例考试同时发布给计科2102
  const exam = (await tx.exams.findMany())[0];
  if (exam) await tx.exams.setClasses(exam.id, [c1.id, c2.id]);
});
await store.flush();
const d = store.data;
console.log(`演示数据已生成：${file}`);
console.log(`用户 ${d.users.length}（教师 ${d.users.filter((u) => u.role === 'teacher').length}，学生 ${d.users.filter((u) => u.role === 'student').length}），班级 ${d.classes.length}，题目 ${d.questions.length}，考试 ${d.exams.length}`);
console.log('账号：admin/admin123、teacher1/teacher123、teacher2/teacher123、student1~student22/student123（student03…student22）');
