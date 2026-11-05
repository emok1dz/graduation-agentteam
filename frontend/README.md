# 前端（原生 JS 单页应用）

- 技术：原生 ES Module（`<script type="module">`），**无构建、无第三方库、无 CDN**；hash 路由；页面模块按需 `import()`。
- 运行：由后端同端口静态托管（`cd backend && node server.mjs` → http://localhost:3000/），接口前缀 `/api`。
- 安全：所有用户内容经 `h()`/`textContent` 渲染（代码中无 `innerHTML`）；兼容服务端 CSP `default-src 'self'; style-src 'self'`——无内联 `<script>`、`<style>`、`style="…"`，动态尺寸用 `el.style.x`（CSSOM）设置；token 存 `localStorage['exam_token']`；任意接口返回 40100 → 清除登录态并跳转 `#/login?redirect=…`。
- 体验：统一加载/空/错误态（`loading()/emptyState()/errorState()`，错误可重试）；toast 提示；危险操作二次确认；40000 字段级错误按 `data.errors[].field` 定位到表单项；≥1280px 完整布局，≤768px 侧栏收起为抽屉、答题卡变为底部抽屉（375px 可作答）；全局断网横幅。

## 目录

```
frontend/
├── index.html                 外壳：#app / #toast / #modal-root / 断网横幅
├── css/style.css              CSS 变量主题、布局、表格/表单/按钮/卡片、答题卡/倒计时、响应式
└── js/
    ├── main.js                启动：store.restore → getMe → router.start
    ├── router.js              路由表、角色守卫、unmount 钩子、setQuery（列表筛选/分页写入 hash 查询串）
    ├── store.js               token / user 状态
    ├── api.js                 request() + 62 个具名函数（与契约 operationId 同名）、ApiError、fetchAll
    ├── utils/dom.js           h/svg/append/mount（安全追加，忽略 null）、loadInto、状态组件、debounce
    ├── utils/format.js        时间/倒计时/datetime-local 转换、分数/百分比、枚举中文标签、答案格式化
    ├── components/            layout · modal(toast/confirm/formDialog) · table · pagination · form
    │                          question-view（preview/answer/review 三模式）· bar-chart（原生 SVG）
    └── pages/                 26 个页面模块，统一导出 { render(container, params, query), unmount?() }
```

## 页面与路由（28 条路由 + 404）

| 路由 | 页面 | 角色 | 主要接口 |
| --- | --- | --- | --- |
| `#/login` | login.js | 公开 | login |
| `#/profile` | profile.js | 全部 | changePassword |
| `#/admin/overview` | admin/overview.js（管理员首页） | admin | getOverview |
| `#/admin/users` | admin/users.js | admin | listUsers, createUser, updateUser, resetUserPassword, deleteUser, listClasses |
| `#/admin/classes` | admin/classes.js | admin | listClasses, createClass, updateClass, deleteClass |
| `#/admin/classes/:id` | admin/class-members.js | admin | getClassMembers, addClassStudents（40909 转班确认后 force_move）, removeClassStudents, setClassTeachers, listUsers |
| `#/admin/exams` | admin/exams.js | admin | listExams |
| `#/teacher/questions` | teacher/questions.js（教师首页） | teacher | listQuestions（含 summary）, listTags, deleteQuestion |
| `#/teacher/questions/new`、`/:id/edit` | teacher/question-edit.js | teacher | getQuestion, createQuestion, updateQuestion, listTags |
| `#/teacher/questions/import` | teacher/question-import.js | teacher | importQuestions |
| `#/teacher/tags` | teacher/tags.js | teacher | listTags, createTag, renameTag, deleteTag |
| `#/teacher/papers` | teacher/papers.js | teacher | listPapers, deletePaper, copyPaper |
| `#/teacher/papers/new`、`/:id/edit` | teacher/paper-edit.js | teacher | listQuestions(exclude_ids), generateRandomPaper（42200 显示 shortages）, replaceRandomQuestion, createPaper, updatePaper, getPaper |
| `#/teacher/papers/:id` | teacher/paper-preview.js | teacher | getPaper, copyPaper |
| `#/teacher/exams` | teacher/exams.js | teacher | listExams, cancelExam |
| `#/teacher/exams/new`、`/:id/edit` | teacher/exam-edit.js | teacher | listPapers, listClasses, getExam, createExam, updateExam（进行中仅 end_time） |
| `#/teacher/exams/:id/monitor` | teacher/exam-monitor.js（15s 刷新） | teacher | getExam, getExamMonitor |
| `#/teacher/exams/:id/grading` | teacher/grading.js | teacher | getGradingOverview, getSubmission, getGradingByQuestion, gradeSubmission, publishResults, unpublishResults |
| `#/exams/:id/scores` | shared/scores.js | teacher, admin | getScoreSheet, getStatsSummary, getStatsDistribution, getStatsQuestions, exportScoreSheet（Blob 下载） |
| `#/submissions/:id` | shared/submission-detail.js | teacher, admin | getSubmission |
| `#/student/exams` | student/exams.js（学生首页） | student | listStudentExams（server_time 校正开考倒计时） |
| `#/student/exams/:id` | student/exam-notice.js | student | getStudentExam |
| `#/student/exams/:id/take` | student/exam-take.js（无侧栏整页） | student | startExam, saveAnswers, submitSubmission |
| `#/student/results` | student/results.js | student | listStudentResults |
| `#/student/results/:examId` | student/result-detail.js | student | getStudentResult |

另有 `pages/not-found.js`（未知路由）。守卫：未登录 → `#/login?redirect=`；角色不符 → 本角色首页；登录成功按角色跳转（admin → 概览，teacher → 题库，student → 我的考试）。

`getMe`、`logout` 由 main.js / 顶栏使用；`getUser`、`getClass` 已封装备用。至此 62 个契约接口均有对应函数。

## 答题页要点（exam-take.js，对应设计文档 §5.3）

1. `offset = server_time − 本地时间`，剩余 = `deadline_at − (Date.now()+offset)`，每秒刷新；≤5 分钟醒目提示一次；保存响应中的 `deadline_at` 会覆盖本地（支持延长考试）。
2. 选择类立即保存；文本 2s 防抖；每 30s 兜底保存脏题；失败 → “保存失败，正在重试”，指数退避（2s→30s），脏答案写入 `localStorage['exam_draft_'+submission_id]`；断网/恢复事件触发提示与立即重试；`beforeunload` 有未保存内容时提醒。
3. 进入时本地草稿比 `last_saved_at` 新则合并并立即保存；标记题存 `exam_marks_<id>`。
4. 交卷确认框提示未答题数 → 按钮禁用 → `submitSubmission({answers: 脏答案, auto})`；倒计时归零不确认直接 `auto:true`（网络失败持续重试）；40904 视为已交卷，40905/40906 提示“考试时间已到，系统已自动交卷”。交卷后再进答题页 → 跳转成绩详情。

## 联调

`node` + Playwright 在浏览器内直接 `import('/js/api.js')` 调用后端，覆盖全部主要接口的成功分支与 40000/40100/40101/40300/40900/40902/40903/40904/40909/42200 等错误分支，字段形状逐一对照契约。
