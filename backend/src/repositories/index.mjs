// createRepositories(store)：统一仓储接口；transaction(fn) 映射为 JsonStore 串行事务
import { UserRepository } from './user.repository.mjs';
import { SessionRepository } from './session.repository.mjs';
import { ClassRepository } from './class.repository.mjs';
import { TagRepository } from './tag.repository.mjs';
import { QuestionRepository } from './question.repository.mjs';
import { PaperRepository } from './paper.repository.mjs';
import { ExamRepository } from './exam.repository.mjs';
import { SubmissionRepository } from './submission.repository.mjs';

export function createRepositories(store) {
  const repos = {
    store,
    users: new UserRepository(store),
    sessions: new SessionRepository(store),
    classes: new ClassRepository(store),
    tags: new TagRepository(store),
    questions: new QuestionRepository(store),
    papers: new PaperRepository(store),
    exams: new ExamRepository(store),
    submissions: new SubmissionRepository(store),
  };
  /** 事务：tx 与 repos 结构相同；JSON 实现中通过全局互斥串行执行，失败回滚 */
  // 注意：不可在事务内再次调用 transaction（会互相等待）；服务层以 xxxTx(tx, ...) 形式复用事务内逻辑
  repos.transaction = (fn) => store.transaction(() => fn(repos));
  repos.isEmpty = () => store.isEmpty();
  return repos;
}
