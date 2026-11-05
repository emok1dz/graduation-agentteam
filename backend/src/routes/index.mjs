// 62 条路由（与契约 operationId 一一对应），集中声明角色（RBAC）
const A = 'admin';
const T = 'teacher';
const S = 'student';
const ALL = [A, T, S];

export const ROUTES = [
  // auth
  ['POST', '/api/auth/login', ['public'], 'login'],
  ['POST', '/api/auth/logout', ALL, 'logout'],
  ['GET', '/api/auth/me', ALL, 'getMe'],
  ['PUT', '/api/auth/password', ALL, 'changePassword'],
  // users
  ['GET', '/api/users', [A], 'listUsers'],
  ['POST', '/api/users', [A], 'createUser'],
  ['GET', '/api/users/:id', [A], 'getUser'],
  ['PUT', '/api/users/:id', [A], 'updateUser'],
  ['DELETE', '/api/users/:id', [A], 'deleteUser'],
  ['POST', '/api/users/:id/reset-password', [A], 'resetUserPassword'],
  // classes
  ['GET', '/api/classes', ALL, 'listClasses'],
  ['POST', '/api/classes', [A], 'createClass'],
  ['GET', '/api/classes/:id', ALL, 'getClass'],
  ['PUT', '/api/classes/:id', [A], 'updateClass'],
  ['DELETE', '/api/classes/:id', [A], 'deleteClass'],
  ['GET', '/api/classes/:id/members', [A, T], 'getClassMembers'],
  ['POST', '/api/classes/:id/students', [A], 'addClassStudents'],
  ['POST', '/api/classes/:id/students/remove', [A], 'removeClassStudents'],
  ['PUT', '/api/classes/:id/teachers', [A], 'setClassTeachers'],
  // tags
  ['GET', '/api/tags', [T], 'listTags'],
  ['POST', '/api/tags', [T], 'createTag'],
  ['PUT', '/api/tags/:id', [T], 'renameTag'],
  ['DELETE', '/api/tags/:id', [T], 'deleteTag'],
  // questions（字面量 /import 优先于 /:id）
  ['GET', '/api/questions', [T], 'listQuestions'],
  ['POST', '/api/questions', [T], 'createQuestion'],
  ['POST', '/api/questions/import', [T], 'importQuestions'],
  ['GET', '/api/questions/:id', [T], 'getQuestion'],
  ['PUT', '/api/questions/:id', [T], 'updateQuestion'],
  ['DELETE', '/api/questions/:id', [T], 'deleteQuestion'],
  // papers
  ['GET', '/api/papers', [T], 'listPapers'],
  ['POST', '/api/papers', [T], 'createPaper'],
  ['POST', '/api/papers/random/generate', [T], 'generateRandomPaper'],
  ['POST', '/api/papers/random/replace', [T], 'replaceRandomQuestion'],
  ['GET', '/api/papers/:id', [T], 'getPaper'],
  ['PUT', '/api/papers/:id', [T], 'updatePaper'],
  ['DELETE', '/api/papers/:id', [T], 'deletePaper'],
  ['POST', '/api/papers/:id/copy', [T], 'copyPaper'],
  // exams
  ['GET', '/api/exams', [T, A], 'listExams'],
  ['POST', '/api/exams', [T], 'createExam'],
  ['GET', '/api/exams/:id', [T, A], 'getExam'],
  ['PUT', '/api/exams/:id', [T], 'updateExam'],
  ['POST', '/api/exams/:id/cancel', [T], 'cancelExam'],
  ['GET', '/api/exams/:id/monitor', [T], 'getExamMonitor'],
  // student
  ['GET', '/api/student/exams', [S], 'listStudentExams'],
  ['GET', '/api/student/exams/:id', [S], 'getStudentExam'],
  ['POST', '/api/student/exams/:id/start', [S], 'startExam'],
  ['GET', '/api/student/results', [S], 'listStudentResults'],
  ['GET', '/api/student/results/:exam_id', [S], 'getStudentResult'],
  // submissions
  ['GET', '/api/submissions/:id', [T, A], 'getSubmission'],
  ['PUT', '/api/submissions/:id/answers', [S], 'saveAnswers'],
  ['POST', '/api/submissions/:id/submit', [S], 'submitSubmission'],
  ['PUT', '/api/submissions/:id/grades', [T], 'gradeSubmission'],
  // grading
  ['GET', '/api/exams/:id/grading', [T], 'getGradingOverview'],
  ['GET', '/api/exams/:id/grading/questions/:paper_question_id', [T], 'getGradingByQuestion'],
  ['POST', '/api/exams/:id/publish-results', [T], 'publishResults'],
  ['POST', '/api/exams/:id/unpublish-results', [T], 'unpublishResults'],
  // stats
  ['GET', '/api/exams/:id/scores', [T, A], 'getScoreSheet'],
  ['GET', '/api/exams/:id/scores/export', [T, A], 'exportScoreSheet'],
  ['GET', '/api/exams/:id/stats/summary', [T, A], 'getStatsSummary'],
  ['GET', '/api/exams/:id/stats/distribution', [T, A], 'getStatsDistribution'],
  ['GET', '/api/exams/:id/stats/questions', [T, A], 'getStatsQuestions'],
  // admin
  ['GET', '/api/admin/overview', [A], 'getOverview'],
];

export function registerRoutes(router, controllers) {
  for (const [method, path, roles, name] of ROUTES) {
    const handler = controllers[name];
    if (typeof handler !== 'function') throw new Error(`controller ${name} not implemented`);
    router.add(method, path, { roles, handler, name });
  }
  return router;
}
