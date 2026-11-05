// createServices：组装各服务（服务间通过 svc 互相引用）
import { createAuthService } from './auth.service.mjs';
import { createUserService } from './user.service.mjs';
import { createClassService } from './class.service.mjs';
import { createTagService } from './tag.service.mjs';
import { createQuestionService } from './question.service.mjs';
import { createPaperService } from './paper.service.mjs';
import { createExamService } from './exam.service.mjs';
import { createAnswerService } from './answer.service.mjs';
import { createGradingService } from './grading.service.mjs';
import { createStatService } from './stat.service.mjs';
import { createSchedulerService } from './scheduler.service.mjs';

export function createServices({ repos, config }) {
  const svc = {};
  const deps = { repos, config, svc };
  svc.auth = createAuthService(deps);
  svc.user = createUserService(deps);
  svc.class = createClassService(deps);
  svc.tag = createTagService(deps);
  svc.question = createQuestionService(deps);
  svc.paper = createPaperService(deps);
  svc.exam = createExamService(deps);
  svc.answer = createAnswerService(deps);
  svc.grading = createGradingService(deps);
  svc.stat = createStatService(deps);
  svc.scheduler = createSchedulerService(deps);
  return svc;
}
