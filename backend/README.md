# 在线考试系统 · 后端

Node.js（≥18）原生 `node:http` 实现，**零第三方依赖**，ES Module（`.mjs`），JSON 文件存储。
接口严格遵循 `design/api-contract.yaml`（62 个接口全部实现，含 10 个 `x-optional` 接口），同端口以静态文件方式提供 `../frontend`。

## 1 启动

```bash
cd backend
node server.mjs          # 或 npm start
# 浏览器打开 http://localhost:3000
```

首次启动时数据目录为空，会自动写入种子数据（见 §3）。`Ctrl+C` / `SIGTERM` 会先把数据落盘再退出。

```bash
npm test                 # node --test：自动发现 test/ 下的测试文件
npm run test:cov         # 带覆盖率（--experimental-test-coverage）
npm run seed:demo        # 可选：生成 NFR-14 规模演示数据（2 教师、2 班、22 学生、35 题），已有数据时需加 --reset
```

> `npm test` 使用不带参数的 `node --test`：Node 22 不再接受目录参数（`node --test test/` 会报 MODULE_NOT_FOUND），而不带参数时 Node 18~22 都会自动发现 `test/**/*.mjs` 与 `**/*.test.mjs`。

## 2 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口（`0` 表示随机端口） |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `backend/data` | `db.json` 所在目录（测试用临时目录） |
| `FRONTEND_DIR` | `<仓库>/frontend` | 静态文件根目录 |
| `SESSION_IDLE_MS` | `7200000` | 会话空闲过期（2h，滑动续期） |
| `DEFAULT_PASSWORD` | `Pass1234` | 新建用户留空密码 / 重置密码时使用的默认初始密码 |
| `SEED` | `1` | 设为 `0` 时空库也不写种子数据 |
| `STORAGE` | `json` | 预留 `mysql` |

其他配置（锁定 5 次 / 10 分钟、请求体 1MB、交卷宽限 10s、兜底扫描 30s、会话清理 10min、scrypt 参数）集中在 `src/config.mjs`。

## 3 种子账号与演示数据

| 账号 | 密码 | 角色 | 说明 |
| --- | --- | --- | --- |
| `admin` | `admin123` | 管理员 | 系统管理员 |
| `teacher1` | `teacher123` | 教师 | 王老师，计科2101 任课教师 |
| `student1` | `student123` | 学生 | 张三，计科2101 |
| `student2` | `student123` | 学生 | 李四，计科2101 |

另有：班级 `计科2101`；teacher1 的 3 个标签（数据结构 / 算法 / 网络）与 10 道示例题（单选 3、多选 2、判断 2、填空 2、简答 1）；
一份示例试卷「数据结构与网络基础 · 示例试卷」（10 题，总分 100）；一场**进行中**的示例考试「期中测验（示例 · 进行中）」
（开始于启动前 10 分钟，持续 30 天，时长 90 分钟，及格线 60），学生登录后可直接作答。

> 与 `design/database/json-schema.md §4` 的差异：该文档写“不预置试卷与考试”，本实现按 Leader 的要求额外预置了示例试卷与进行中的考试，便于演示。

## 4 可编程启动（供测试）

```js
import { start } from './server.mjs';
import * as clock from './src/core/clock.mjs';   // 假时钟：clock.setNow(ms) / clock.advance(ms) / clock.reset()

const server = await start({ port: 0, host: '127.0.0.1', dataDir: tmpDir, scheduler: false });
server.url;        // http://127.0.0.1:<随机端口>
server.services;   // 服务层，可直接调用 server.services.answer.sweepAll(new Date()) 等
server.store;      // JsonStore，await server.store.flush() 确保落盘
await server.stop(); // 停止定时任务、关闭服务器并落盘（直接 server.close() 也可）
```

`start(opts)` 选项：`port`、`host`、`dataDir`、`frontendDir`、`scheduler`（默认 true）、`seed`（默认 true）、`config`（覆盖任意配置项，如 `{ SUBMIT_GRACE_MS: 0 }`）。
返回值是 `http.Server` 本身，附加了 `url / port / stop / app / config / store / repos / services`。
`createApp({config, services})` 也从 `server.mjs` 与 `src/app.mjs` 导出，返回 `(req, res) => {}`。

服务端所有业务时间都取自 `src/core/clock.mjs`，测试可以 `clock.setNow()` 来模拟开考、截止、宽限、锁定过期（参见 `test/smoke.test.mjs`）。

## 5 目录说明

```
backend/
├── server.mjs                 入口 + start()/createApp 导出
├── package.json               无 dependencies
├── data/                      运行时生成 db.json（已 .gitignore）
├── scripts/seed-demo.mjs      可选：NFR-14 演示数据
├── src/
│   ├── config.mjs             集中配置（环境变量覆盖）
│   ├── app.mjs                接入层：安全头、静态文件/API 分发、信封、错误兜底
│   ├── seed.mjs               seedIfEmpty(repos)
│   ├── core/                  router（字面量优先、:id 校验）、http（body ≤1MB）、errors（业务码表）、
│   │                          validator、static（防穿越、ETag/304）、clock（可注入）、pagination
│   ├── middleware/auth.mjs    Bearer → sha256 → session → user；滑动续期；RBAC（40300）
│   ├── routes/index.mjs       62 条路由，与契约 operationId 一一对应并声明角色
│   ├── controllers/           取参 → 调用服务 → 返回 data（创建类接口 201）
│   ├── services/              业务规则、资源归属校验（40301）、状态机、事务边界；scheduler
│   ├── domain/                纯函数：password(scrypt)、token、question-rules、scoring、exam-status、
│   │                          random-picker、statistics、shuffle、csv
│   └── repositories/          json-store（互斥事务 + 回滚 + 合并写 + tmp→fsync→rename 原子落盘）、
│                              BaseRepository（返回深拷贝）及各实体仓储
└── test/smoke.test.mjs        冒烟测试（其余测试由测试工程师补充）
```

关键实现要点：

- **事务**：`repos.transaction(fn)` 在全局互斥锁内串行执行；写入前对集合做浅拷贝备份（文档以不可变方式替换），`fn` 抛错即回滚；有写入时等落盘完成才返回。落盘请求合并，序列化在锁内进行，不会写入未完成事务的中间态。
- **交卷幂等**：交卷在事务内检查 `status`，非 `in_progress` 一律 409/40904 且返回原 `SubmitResult`；并发 10 次提交只有 1 次成功（已自测）。
- **兜底**：`scheduler` 每 30s `sweepAll()`（超时 `in_progress` → `forced` 交卷并自动阅卷；已结束考试生成 `absent` 缺考记录）；另外在 start / save / submit / monitor / grading / publish / scores / stats / 学生考试与成绩列表 前对相关考试先执行 `sweepExam`。
- **鉴权**：scrypt(N=16384,r=8,p=1,64B)+16B 盐、timingSafeEqual；不存在账号也做一次 scrypt；令牌 32B 随机 hex，库内仅存 SHA-256；退出/禁用/重置密码删会话，改密删除其他会话。
- **答案保密**：学生作答视图白名单字段；成绩未发布时学生端分数为 null；`allow_review=false` 时不返回 questions。
- **安全头**：`X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy`、`CSP: default-src 'self'; img-src 'self' data:; style-src 'self'`（注意：该 CSP 会阻止 HTML 中的内联 `style="..."` 属性与 `<style>` 标签，前端样式需放在 css 文件中或通过 `el.style.xxx` 设置）；API 响应 `Cache-Control: no-store`。

## 6 接口实现清单

**62 / 62 全部实现**（契约中 10 个 `x-optional` 接口也已实现，无 501）。

| 模块 | 接口 |
| --- | --- |
| auth（4） | login、logout、getMe、changePassword |
| users（6） | listUsers、createUser、getUser、updateUser、deleteUser【可选】、resetUserPassword |
| classes（9） | listClasses、createClass、getClass、updateClass、deleteClass、getClassMembers、addClassStudents、removeClassStudents、setClassTeachers |
| tags（4） | listTags、createTag【可选】、renameTag【可选】、deleteTag【可选】 |
| questions（6） | listQuestions、createQuestion、importQuestions【可选】、getQuestion、updateQuestion、deleteQuestion |
| papers（8） | listPapers、createPaper、generateRandomPaper、replaceRandomQuestion、getPaper、updatePaper、deletePaper、copyPaper【可选】 |
| exams（6） | listExams、createExam、getExam、updateExam【可选】、cancelExam、getExamMonitor |
| student（5） | listStudentExams、getStudentExam、startExam、listStudentResults、getStudentResult |
| submissions（3） | getSubmission、saveAnswers、submitSubmission |
| grading（5） | gradeSubmission、getGradingOverview、getGradingByQuestion、publishResults、unpublishResults【可选】 |
| stats（5） | getScoreSheet、exportScoreSheet【可选】、getStatsSummary、getStatsDistribution、getStatsQuestions |
| admin（1） | getOverview【可选】 |

### 实现中对契约未明确之处的处理（不改变接口形状）

- 路径参数非法（如 `/api/users/abc`）返回 40000，但在鉴权与角色校验之后判断（未登录先得到 40100）。
- 字面量路径优先：`GET /api/questions/import`、`GET /api/papers/random/generate` 返回 40500（而非把 `import` 当作 id）。
- `startExam` 判定顺序：已取消 40400 → 非本班且无答卷 40301 → 已交卷 40904（作答中但已超时则先强制交卷再 40904）→ 已有作答中答卷则直接返回 → 不在时间窗口 40905 → 创建答卷。
- 学生转班后，已有答卷的考试仍对其可见（按答卷归属），成绩单/监控按答卷 `class_id` 归班。
- `updateExam` 在 ongoing 状态下请求体只要出现 `end_time` 以外的字段即 40902（与契约“出现即 40902”一致）；not_started 时修改 `paper_id` 且未给 `pass_score`，及格线按新试卷总分 60% 重算。
- `deleteUser`：教师名下有题目、试卷或考试任一即 40901。
- 40000 的 `message` 在只有一个字段错误时直接为该字段的提示（如“账号已存在”类提示仍走 40900），多个错误时为“参数校验失败”，详情见 `data.errors[]`。
