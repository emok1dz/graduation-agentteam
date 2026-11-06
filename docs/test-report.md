# 在线考试系统 测试报告

> 编写：测试工程师（毕业设计 Agent Team） · 日期：2026-11-05
> 依据：`requirements/需求规格说明书.md`、`requirements/需求追踪矩阵.md`、`design/api-contract.yaml`、`design/系统设计文档.md`、`backend/README.md`、`frontend/README.md`
> 本报告中的全部数字均摘自真实运行输出（见各节“原始输出”片段），未做任何估算或修饰。

---

## 1 测试范围与环境

### 1.1 范围

| 类别 | 覆盖内容 |
| --- | --- |
| 单元测试 | domain 层：password、token、scoring（五种题型判分、多选全对才得分、填空分值拆分、作答形状校验）、statistics、random-picker、exam-status、question-rules、csv、shuffle；core/validator；repositories/json-store（原子写、回滚、合并写、损坏文件拒绝启动） |
| 接口集成测试 | 33 条功能需求对应的 62 个接口中的主要成功路径与错误路径：鉴权、RBAC 越权、用户/班级、题库 CRUD 与校验、手动/随机组卷、发布与管理考试、作答（时间窗口、自动保存、幂等交卷、并发交卷）、到时强制交卷与缺考（假时钟）、阅卷与人工批改、发布/撤回成绩、统计（与手算比对）、CSV 导出 |
| 端到端测试 | Playwright + Chromium 浏览器走通“教师建题 → 组卷 → 发布考试 → 学生作答 → 交卷 → 教师批改 → 发布成绩 → 学生查看成绩” |
| 非功能测试 | 密码存储（db.json 检查）、XSS、CSP 及安全响应头、答案保密、请求体上限、路径穿越、数据持久化、性能（NFR-01 规模数据、100 并发登录、100/200 并发保存、200 并发交卷）、首屏资源大小 |

不在本轮范围：MySQL 存储实现（`STORAGE=mysql` 仅预留）、Chromium 以外的浏览器、Node 18/20、HTTPS 反向代理部署、可用性（NFR-12）主观评估。

### 1.2 环境

| 项 | 值 |
| --- | --- |
| 操作系统 | Linux 6.18.44-fc-v236（容器） |
| CPU / 内存 | Intel Xeon @ 2.10GHz × 4 核 / 15 GiB |
| Node.js | v22.23.4（内置 `node:test`、`node:assert`、`fetch`，零第三方依赖） |
| 浏览器 | Playwright 1.63.0 自带 Chromium 153.0.8010.12（headless） |
| 后端启动方式 | `start({port:0, host:'127.0.0.1', dataDir:<临时目录>, scheduler:false})`，每个测试文件一个独立进程、独立临时 `DATA_DIR`，用后删除 |
| 时间控制 | `backend/src/core/clock.mjs` 假时钟（`setNow / advance / reset`） |

### 1.3 测试文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `backend/test/helpers/harness.mjs` | 工具 | 临时 DATA_DIR 启动实例、`api/ok/err/login` 封装、`buildScenario()` 场景构造（建班、学生、teacher2、五题型各 1 道、组卷、发布考试） |
| `backend/test/unit-*.test.mjs`（7 个） | 单元 | 见 §3 |
| `backend/test/api-*.test.mjs`（10 个） | 集成 / 非功能 | 见 §3 |
| `backend/test/smoke.test.mjs` | 冒烟 | 后端开发者已有，保留未改 |
| `tests-e2e/e2e.test.mjs` | E2E | `node tests-e2e/e2e.test.mjs` 运行 |

运行命令：

```bash
cd backend && npm test                                    # 全部单元 + 集成 + 非功能
cd backend && node --test --experimental-test-coverage    # 覆盖率（报告中另加 --test-coverage-exclude='test/**' 统计纯源码）
node tests-e2e/e2e.test.mjs                               # E2E（仓库根目录）
```

---

## 2 测试策略

1. **分层**：domain 纯函数用单元测试穷举边界（判分、分值拆分、分数段边界、竞争排名、状态边界 `start_time`/`end_time`/`deadline+10s`）；服务与接口通过真实 HTTP（内置 `fetch`）黑盒测试，断言 HTTP 状态码 + 业务码 + 数据形状；浏览器层只走关键闭环。
2. **隔离**：每个测试文件 `mkdtemp` 临时数据目录、随机端口、独立进程（`node --test` 默认进程隔离），假时钟在 `after` 中 `reset`，测试之间无共享状态。
3. **时间相关用例**全部用假时钟：开考前/中/后、截止宽限 10s 的两侧（`+10_000ms` 不过期、`+10_001ms` 过期）、锁定 10 分钟到期、会话空闲 2h 过期与滑动续期。scheduler 用例另以 100ms 周期真实启动定时器验证。
4. **统计正确性**：构造 5 名学生的确定性作答（含缺考、白卷、少选、填空半对、大小写），在用例注释中给出手算过程，逐项比对平均分（2 位）、及格率（1 位）、分数段、每题正确率/得分率、选项分布、排名。
5. **并发**：`Promise.all` 发起同一答卷 10 次并发交卷、同一学生 5 次并发 start、200 名学生并发 start/保存/交卷，交卷后逐份核对答案内容与得分。
6. **缺陷处理**：发现与设计/契约/安全常识不符的行为时，按期望行为编写用例并以 `{ todo: '缺陷 BUG-xx …' }` 标记——用例会执行并在输出中显示 `not ok … # TODO`，但不计入失败，保证回归套件常绿；缺陷详情见 §7。

---

## 3 用例统计

### 3.1 后端（`npm test`）按模块

| 模块 / 文件 | 用例数 | 通过 | 失败 | 已知缺陷（todo） |
| --- | ---: | ---: | ---: | ---: |
| 单元：password + token（`unit-password-token`） | 8 | 8 | 0 | 0 |
| 单元：scoring 判分（`unit-scoring`） | 9 | 9 | 0 | 0 |
| 单元：statistics（`unit-statistics`） | 6 | 6 | 0 | 0 |
| 单元：random-picker（`unit-random-picker`） | 6 | 6 | 0 | 0 |
| 单元：exam-status（`unit-exam-status`） | 4 | 4 | 0 | 0 |
| 单元：validator + question-rules + csv + shuffle（`unit-validator`） | 10 | 10 | 0 | 0 |
| 单元：json-store 原子写（`unit-json-store`） | 7 | 7 | 0 | 0 |
| 集成：认证与会话（`api-auth`） | 9 | 9 | 0 | 0 |
| 集成：RBAC 越权（`api-rbac`） | 7 | 7 | 0 | 0 |
| 集成：用户 / 班级（`api-user-class`） | 5 | 5 | 0 | 0 |
| 集成：题库 + 组卷（`api-question-paper`） | 11 | 11 | 0 | 0 |
| 集成：考试发布与管理（`api-exam`） | 7 | 7 | 0 | 0 |
| 集成：在线作答（`api-answer`） | 13 | 13 | 0 | 0（BUG-01 已修复） |
| 集成：强制交卷与缺考（`api-sweep`） | 5 | 5 | 0 | 0 |
| 集成：阅卷 / 成绩 / 统计（`api-grading-stats`） | 11 | 11 | 0 | 0 |
| 非功能：安全与可靠性（`api-security`） | 8 | 8 | 0 | 0（BUG-02 已修复） |
| 非功能：性能（`api-perf`） | 5 | 5 | 0 | 0 |
| 冒烟（`smoke`，开发者已有） | 3 | 3 | 0 | 0 |
| **合计** | **134** | **134** | **0** | **0** |

> 缺陷修复后 `npm test` 汇总行显示 `tests 135 / pass 135 / fail 0`（修复前为 `tests 135 / pass 133`）：多出的 1 项是 `test/helpers/harness.mjs`——Node 22 会把 `test/**` 下所有 `.mjs` 当作测试文件加载，该文件不含用例，被记为 1 个空的“文件级”通过项。上表为扣除后的真实用例数。

原始输出（`cd backend && npm test`，退出码 0）：

```
# tests 135
# suites 0
# pass 133
# fail 0
# cancelled 0
# skipped 0
# todo 2
# duration_ms 14377.116789
```

逐文件运行（`node --test <file>`）的原始汇总：

```
test/api-answer.test.mjs tests=13 pass=12 fail=0 todo=1
test/api-auth.test.mjs tests=9 pass=9 fail=0 todo=0
test/api-exam.test.mjs tests=7 pass=7 fail=0 todo=0
test/api-grading-stats.test.mjs tests=11 pass=11 fail=0 todo=0
test/api-perf.test.mjs tests=5 pass=5 fail=0 todo=0
test/api-question-paper.test.mjs tests=11 pass=11 fail=0 todo=0
test/api-rbac.test.mjs tests=7 pass=7 fail=0 todo=0
test/api-security.test.mjs tests=8 pass=7 fail=0 todo=1
test/api-sweep.test.mjs tests=5 pass=5 fail=0 todo=0
test/api-user-class.test.mjs tests=5 pass=5 fail=0 todo=0
test/smoke.test.mjs tests=3 pass=3 fail=0 todo=0
test/unit-exam-status.test.mjs tests=4 pass=4 fail=0 todo=0
test/unit-json-store.test.mjs tests=7 pass=7 fail=0 todo=0
test/unit-password-token.test.mjs tests=8 pass=8 fail=0 todo=0
test/unit-random-picker.test.mjs tests=6 pass=6 fail=0 todo=0
test/unit-scoring.test.mjs tests=9 pass=9 fail=0 todo=0
test/unit-statistics.test.mjs tests=6 pass=6 fail=0 todo=0
test/unit-validator.test.mjs tests=10 pass=10 fail=0 todo=0
```

### 3.2 E2E

| 文件 | 用例数 | 通过 | 失败 |
| --- | ---: | ---: | ---: |
| `tests-e2e/e2e.test.mjs` | 8 | 8 | 0 |

### 3.3 总计

单元 + 集成 + 非功能 134 条、E2E 8 条，共 **142 条**；通过 **142**，失败 **0**（测试中发现的 2 个低严重度缺陷已修复并回归通过，见 §7）。

### 3.4 重点用例说明

| 场景 | 用例 | 要点 |
| --- | --- | --- |
| 多选判分规则 | UT-SCORE-03/04 | 设计文档 §4.1-5 / 需求 A-05：完全一致满分；少选、多选、错选、空数组、非数组均 0 分（无部分得分） |
| 填空分值拆分 | UT-SCORE-06 | `10/3 → [3.3,3.3,3.4]`、`0.5/4 → [0.1,0.1,0.1,0.2]`，合计恒等于总分 |
| 截止宽限 | UT-EXST-03、IT-ANS-10/11、IT-SWEEP-01 | `deadline+10s` 内保存/交卷有效；`+10_001ms` 保存 40906 且答卷被 forced 交卷，交卷请求的答案被忽略、`submitted_at = deadline_at` |
| 并发交卷 | IT-ANS-07 | 同一答卷 10 个并发请求：1 个 200，9 个 409/40904；库内仅 1 条答卷 |
| 统计手算 | IT-STAT-01~04 | 应考 5、实考 4、缺考 1；平均 (21+9+15.5+0)/4 = 11.375 → **11.38**；及格 2/4 = **50%**；分段 [2,0,1,0,1]；单选/多选/判断正确率 50%、填空 25%；简答平均 5.375 → 5.38、得分率 21.5/40 → 53.8%；排名 1,2,3,4,4（缺考 0 分并列） |
| 原子写 | UT-STORE-05 | 30 次写入 200KB+ 文档期间并发循环读取 db.json，每次 `JSON.parse` 均成功（无半截文件） |
| 越权 | IT-RBAC-01~06 | 学生调教师/管理员 15 个接口均 403/40300；teacher2 读/改/删 teacher1 的题、卷、考试、监控、批改、统计均 403/40301 |

---

## 4 覆盖率

命令：`cd backend && node --test --experimental-test-coverage --test-coverage-exclude='test/**'`（排除测试文件自身，只统计 `server.mjs` 与 `src/`）。

| 范围 | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
| --- | ---: | ---: | ---: |
| **全部源码（all files）** | **96.70%** | **87.70%** | **95.02%** |
| domain/（9 个文件） | 89.57% ~ 100% | 86.36% ~ 100% | 100% |
| controllers/（13 个文件） | 100% | 100% | 100% |
| services/（12 个文件） | 95.89% ~ 100% | 67.86% ~ 100% | 66.67% ~ 100% |
| repositories/（11 个文件） | 78.85% ~ 100% | 75.00% ~ 100% | 80.00% ~ 100% |
| core/（7 个文件） | 84.66% ~ 100% | 66.67% ~ 96.30% | 50.00% ~ 100% |

原始输出（节选）：

```
# server.mjs                  |  74.16 |    84.62 |   80.00 | 67-89
#   exam-status.mjs           | 100.00 |   100.00 |  100.00 |
#   password.mjs              | 100.00 |    95.00 |  100.00 |
#   random-picker.mjs         | 100.00 |    97.22 |  100.00 |
#   scoring.mjs               |  98.75 |    98.67 |  100.00 | 47
#   statistics.mjs            | 100.00 |    91.94 |  100.00 |
#   json-store.mjs            |  96.75 |    86.27 |   86.36 | 76-77 103-105
#   answer.service.mjs        | 100.00 |    89.31 |  100.00 |
#   grading.service.mjs       |  98.96 |    75.13 |   96.43 | 29 38 114
#   stat.service.mjs          | 100.00 |    93.55 |   97.06 |
#   validator.mjs             |  84.66 |    92.54 |   85.00 | 28-30 32-33 60-63 79-82 106-109 116-118 125-127 152-153
#   static.mjs                |  86.11 |    66.67 |   75.00 | 34-37 42-43 63-66
#   submission.repository.mjs |  78.85 |    93.75 |   85.71 | 19-22 42-46 50-51
# all files                   |  96.70 |    87.70 |   95.02 |
```

未覆盖的主要部分：`server.mjs` 67-89（命令行直接运行时的信号处理与 `listen` 入口，测试只走 `start()`）；`static.mjs` 的 ETag/304 与读文件异常分支；validator 中个别 `nullable`/`def` 组合分支。

> 不加 `--test-coverage-exclude` 时 Node 会把测试文件本身计入，汇总为行 97.94% / 分支 89.65% / 函数 96.81%（第一次运行的原始值），该数字偏高，不作为结论使用。

---

## 5 E2E 结果

`node tests-e2e/e2e.test.mjs`：后端在测试进程内以临时 DATA_DIR、随机端口启动（含种子账号 teacher1 / student1），浏览器为 headless Chromium；服务端用假时钟推进到“开考后 30 秒”和“结束后 1 分钟”，浏览器端倒计时按 `server_time` 偏移计算。

| 用例 | 步骤 | 结果 |
| --- | --- | --- |
| E2E-01 | teacher1 登录 → 新增题目页录入单选题（题干含 `<script>` 与 `<img onerror>`）与简答题 → 保存；题库列表显示题干原文 | 通过 |
| E2E-02 | 新建试卷 → 手动选题 → 关键字“E2E”筛选 → 本页全部加入 → 保存；总分 12、2 题；预览页 XSS 不执行 | 通过 |
| E2E-03 | 发布考试：选择试卷、开始=当前+2~3 分钟、窗口 30 分钟、时长 20 分钟、勾选“计科2101”；默认及格线 7.2 | 通过 |
| E2E-04 | student1 登录 → 我的考试 → 考试须知 → 勾选同意 → 开始作答；倒计时显示 `00:19:xx`；页面不含参考答案；选 B 后显示“已保存”，简答防抖保存；交卷确认框 → “已交卷，等待成绩发布”；库中 objective_score=2、pending_review | 通过 |
| E2E-05 | 考试结束后 teacher1 进入批改页 → 简答给 8 分 + 评语 → “已完成批改，总分 10” → 发布成绩确认框 → “成绩已发布” | 通过 |
| E2E-06 | student1 打开成绩详情：总分 10、结果“及格”、显示评语与参考答案、题干以文本显示 | 通过 |
| E2E-07 | 全程无 `alert/confirm` 弹窗、无 CSP 违规日志、无页面脚本错误；`/` 响应头含 CSP | 通过 |
| E2E-08 | 首屏（登录页）静态资源 12 个、共 75.6 KB，可交互 134 ms（NFR-03 要求 ≤300KB、≤2s） | 通过 |

原始输出：

```
ok 1 - E2E-01 教师登录并通过页面新建单选题（题干含 XSS 载荷）与简答题
ok 2 - E2E-02 教师手动组卷（筛选 E2E 题目 → 本页全部加入 → 保存），总分 12
ok 3 - E2E-03 教师发布考试（开始=当前+2 分钟，窗口 30 分钟，时长 20 分钟，班级 计科2101）
ok 4 - E2E-04 学生登录 → 考试开始后进入作答 → 作答页不含答案 → 自动保存 → 交卷
ok 5 - E2E-05 考试结束后教师批改简答题（8 分）并发布成绩
ok 6 - E2E-06 学生查看成绩：总分 10、及格、答卷回顾含评语与正确答案
ok 7 - E2E-07 全程无 XSS 弹窗、无 CSP 违规、无页面脚本错误；响应头含 CSP
# 首屏：12 个静态文件，共 75.6 KB，可交互 134 ms
ok 8 - E2E-08 首屏静态资源总大小 ≤ 300KB、可交互时间 ≤ 2s（NFR-03，本机）
# tests 8
# pass 8
# fail 0
# duration_ms 5840.737205
```

稳定性：另连续运行 3 次，均为 `pass 8 / fail 0`。

---

## 6 非功能测试结果

### 6.1 安全

| 编号 | 检查项 | 方法 | 结果 |
| --- | --- | --- | --- |
| NFR-04 | 密码不以明文存储 | NFR-SEC-01：读取 `DATA_DIR/db.json`，搜索 5 个已知明文密码均未出现；每个用户仅含 128 位 hex `password_hash` + 32 位 hex `password_salt`，盐两两不同，无 `password` 字段；会话令牌原文不落盘（只存 SHA-256）。UT-PWD-02：同一密码两次哈希结果不同；UT-PWD-04：单次 scrypt ≥ 10ms | 通过 |
| NFR-05 | 令牌与登录防护 | IT-AUTH-04~09：5 次错误锁定 10 分钟（42900，正确密码也拒绝，到期恢复）；无/伪造/格式错误令牌 401；空闲 2h 过期、活跃滑动续期；退出、改密（其他会话）、禁用、重置密码后旧令牌立即 401；并发 10 次错误登录探测结果为 4×40101 + 6×42900 | 通过 |
| NFR-06 | 越权 | IT-RBAC-01~07（见 §3.4） | 通过 |
| NFR-07 | 防重复交卷 / 时间防篡改 | IT-ANS-05~07、10、11：请求体伪造 `submitted_at` 被忽略、交卷时间取服务端；重复/并发交卷 40904 且原交卷时间不变；超时后新答案不被接受 | 通过 |
| NFR-08 | 答案保密 | NFR-SEC-03 / IT-ANS-02：start、学生考试列表、考试详情响应中搜索 `answer/analysis/correct_answer/is_correct/参考答案/Beijing` 均为空；作答题目字段严格为白名单 7 项；发布前成绩接口分数为 null、题目为空数组；E2E-04 作答页 DOM 无参考答案 | 通过 |
| NFR-09 | XSS | E2E-01/02/04/06：题干 `<script>window.__xss=1</script><img src=x onerror="window.__xss=2">` 在题库列表、试卷预览、作答页、成绩详情均原样显示为文本，`window.__xss` 始终为 `undefined`，无弹窗、无 CSP 违规；NFR-SEC-04：前端 `js/` 下无 `innerHTML=`/`insertAdjacentHTML`/`document.write`/`eval`/`new Function` | 通过 |
| NFR-09 | CSP 与安全头 | NFR-SEC-02：`/`、`/index.html`、`/js/main.js`、`/api/auth/me` 均返回 `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`；API 另有 `Cache-Control: no-store` | 通过 |
| NFR-09 | 输入校验 / 上限 / 穿越 | NFR-SEC-05：>1MB 请求体 413/41300，非 JSON 400/40001；IT-QB-02、IT-EXAM-02 等字段级 40000；NFR-SEC-06：`/../`、`%2e%2e`、`..%2f`、`%00` 共 5 种路径均 404/400 且不返回项目外文件 | 通过 |
| — | CSV 公式注入 | NFR-SEC-07：姓名 `=1+2` 原样写入导出 CSV | 缺陷 BUG-02（低）→ 已修复（回归通过） |

### 6.2 可靠性

| 编号 | 检查项 | 结果 |
| --- | --- | --- |
| NFR-10 | 原子写（tmp→fsync→rename）、事务回滚、并发 50 事务串行且合并写（`writeCount < 50`）、残留 .tmp 清理、损坏 db.json 拒绝启动且不改原文件 | UT-STORE-01~07 通过 |
| NFR-10 | 重启不丢数据 | NFR-REL-01：`stop()` 后用同一 DATA_DIR 重新 `start()`，题目数一致、可登录，通过 |
| NFR-11 | 断点恢复（服务端） | IT-ANS-03：再次 start 不重置 `started_at`，返回已保存答案与 `last_saved_at`，通过（前端 localStorage 草稿未做专项测试） |

### 6.3 性能

数据规模（NFR-PERF-00，经仓储批量写入）：

```
# 规模 {"users":1000,"questions":2000,"exams":102,"submissions":5000,"answers":25000,"buildMs":609}
```

NFR-01 接口响应时间（串行 100 次，`npm test` 运行时的原始输出）：

```
# GET /api/questions?page=1&page_size=20 n=100 avg=11.6ms p50=10.3ms p95=15.9ms max=40.7ms
# GET /api/questions?type=single&keyword=%E8%A7%84%E6%A8%A1&page=3 n=100 avg=10.3ms p50=9.4ms p95=15.5ms max=34.7ms
# GET /api/exams?page=1&page_size=20 n=100 avg=12.3ms p50=11.6ms p95=18.7ms max=26.0ms
# GET /api/papers n=100 avg=1.7ms p50=1.5ms p95=2.6ms max=7.5ms
# GET /api/exams/:id/scores n=100 avg=3.5ms p50=3.0ms p95=6.3ms max=17.1ms
# GET /api/exams/:id/stats/summary n=100 avg=2.7ms p50=2.6ms p95=4.7ms max=7.9ms
# GET /api/exams/:id/stats/distribution n=100 avg=2.3ms p50=2.2ms p95=4.1ms max=7.7ms
# GET /api/exams/:id/stats/questions n=100 avg=3.0ms p50=2.8ms p95=4.6ms max=6.6ms
```

并发（NFR-02 及任务要求的 100 并发登录 / 保存）：

```
# 并发登录 n=100 avg=1210.7ms p50=1207.8ms p95=1223.3ms max=1223.5ms 总耗时=1233ms
# 并发 start(200) n=200 avg=857.2ms p50=807.2ms p95=1033.3ms max=1074.8ms
# 100 并发保存答案 n=100 avg=557.3ms p50=557.9ms p95=562.8ms max=563.2ms
# 200 并发保存答案 n=200 avg=1225.6ms p50=1225.3ms p95=1240.1ms max=1242.9ms 总耗时=1263ms
# 200 并发交卷 n=200 avg=1177.6ms p50=1104.9ms p95=1358.4ms max=1358.9ms
```

| 指标 | 要求 | 实测 | 结论 |
| --- | --- | --- | --- |
| 普通查询平均响应 | ≤ 300ms | 1.7 ~ 12.3ms | 通过 |
| 统计类接口平均响应 | ≤ 1s | 2.3 ~ 3.5ms | 通过 |
| 100 并发登录 | （任务要求记录 P95） | 全部成功，P95 1223.3ms，总耗时 1233ms | 记录 |
| 100 并发保存答案 | （任务要求记录 P95） | 全部成功，P95 562.8ms | 记录 |
| 200 并发保存 / 交卷 | 成功率 100%、无丢失覆盖 | 成功率 100%；逐份核对 200 份答卷的 4 道题作答与手算得分全部一致；P95 保存 1240.1ms / 交卷 1358.4ms | 通过 |
| 首屏资源 / 可交互（NFR-03） | ≤ 300KB / ≤ 2s | 75.6 KB / 134 ms | 通过 |

> 覆盖率模式下（插桩）同一套性能用例的数字更慢（如 200 并发保存 P95 1541.1ms），上表采用非插桩的 `npm test` 结果。

性能观察（非缺陷，供后续优化参考）：
- 并发登录耗时主要来自 scrypt（N=16384）在 libuv 默认 4 线程池中排队，P95 ≈ 1.2s 属于慢哈希的预期代价。
- 写接口每个事务都等待一次全量 `db.json` 序列化落盘（写合并后仍为整文件重写），在 NFR-01 规模（25 000 条作答）下 200 并发保存 P95 约 1.24s。满足 NFR-02 的成功率要求，但写延迟会随数据量线性增长，数据量再大时建议按设计文档 §1.1 迁移到 MySQL 或改为增量持久化。

---

## 7 缺陷清单

| 编号 | 标题 | 严重程度 | 相关需求 | 状态 |
| --- | --- | --- | --- | --- |
| BUG-01 | 缺考学生在考试结束后进入考试，提示“已交卷，请勿重复提交”（40904），应为“当前不在考试时间内”（40905） | 低 | FR-ANS-01 / 设计文档 §8.1 | 已修复（回归通过）：answer.service.start 对缺考记录返回 40905 |
| BUG-02 | 成绩单 CSV 导出未防公式注入：姓名等以 `=`、`+`、`-`、`@` 开头的单元格原样写出 | 低 | FR-STAT-06 / NFR-09 | 已修复（回归通过）：domain/csv.mjs 对以 = + - @ 制表符 回车 开头的文本单元格前置单引号 |

### BUG-01 缺考学生进入已结束考试时返回码与提示不符

- **严重程度**：低（不影响数据与判分，学生仍无法作答；仅提示语误导、与设计状态表不一致）
- **复现步骤**：
  1. 教师向某班发布考试，学生 A 在考试期间未进入；
  2. 时间推进到 `end_time` 之后（任何触发 sweep 的接口或 scheduler 已为 A 生成缺考记录）；
  3. 学生 A 调用 `POST /api/student/exams/{id}/start`。
- **期望**：409 / 40905“当前不在考试时间内”（设计文档 §8.1 表：ended 状态“学生开始/继续作答 ✘ 40905”）。
- **实际**：409 / 40904“已交卷，请勿重复提交”，`data = {"status":"graded","submit_type":"absent",…}`。原因是 sweep 先插入了 `absent` 答卷，`answer.service.start` 按“已有非作答中答卷 → 40904”分支返回。
- **用例**：`backend/test/api-answer.test.mjs` › IT-ANS-13（todo）。原始输出：

  ```
  not ok 13 - IT-ANS-13 缺考学生考试结束后 start 应返回 40905“当前不在考试时间内”（设计文档 §8.1 状态表） # TODO 缺陷 BUG-01：实际返回 40904“已交卷，请勿重复提交”
    error: |-
      code=40904 msg=已交卷，请勿重复提交
      40904 !== 40905
  ```
- **建议**：`submit_type === 'absent'` 时返回 40905（或专门提示“您未参加本场考试”）；前端考试须知页对 `missed` 状态已不显示开始按钮，影响仅限直接调用接口或旧页面。

### BUG-02 CSV 导出未防公式注入

- **严重程度**：低（需管理员录入恶意姓名，且需教师用表格软件打开并允许执行公式）
- **复现步骤**：
  1. 管理员新建学生，姓名填 `=1+2`（或 `=HYPERLINK("http://evil","点我")`），加入某考试的参考班级；
  2. 教师调用 `GET /api/exams/{id}/scores/export`（或成绩页“导出 CSV”）；
  3. 用 Excel / WPS 打开导出文件。
- **期望**：以 `=`、`+`、`-`、`@`、制表符开头的单元格前置 `'` 或以其他方式中和，避免被当作公式执行（OWASP CSV Injection）。
- **实际**：导出行为 `,csvinj,=1+2,测试班…,未开始,,,,,,`，单元格被表格软件当作公式求值。
- **用例**：`backend/test/api-security.test.mjs` › NFR-SEC-07（todo）。原始输出：

  ```
  not ok 71 - NFR-SEC-07 CSV 导出应防公式注入（以 = + - @ 开头的单元格需前置 ' 或转义） # TODO 缺陷 BUG-02：姓名 "=1+2" 原样写入 CSV
    error: ',csvinj,=1+2,测试班1793865600000297d,未开始,,,,,,'
  ```
- **建议**：在 `domain/csv.mjs` 的 `esc()` 中对危险前缀加 `'`。

### 观察项（非缺陷，建议在文档中明确）

1. `GET /api/exams/{id}/stats/questions?sort=rate_asc` 按 `score_rate` 升序（与契约一致），需求 FR-STAT-05 文字为“按正确率升序”；两者对客观题通常一致，但对多空填空题可能不同，建议需求与契约统一表述。
2. 被禁用的学生仍计入应考人数，考试结束后也会生成缺考记录（如：班级 2 名正常学生 + 1 名禁用学生 → `expected_count = 3`、`absent_count = 3`）。需求未规定，建议明确。
3. `npm test` 汇总中会多出 1 项 `test/helpers/harness.mjs`（见 §3.1 说明），不影响结果。

---

## 8 结论

1. 后端 134 条单元 / 集成 / 非功能用例全部通过（测试中发现的 2 个低严重度缺陷 BUG-01、BUG-02 已修复并回归通过）；E2E 8 条全部通过，连续 3 次复跑稳定。
2. 源码覆盖率：行 96.70%、分支 87.70%、函数 95.02%；domain 层判分、统计、抽题、状态计算全部函数均被覆盖。
3. 33 条功能需求中，31 条测试通过，2 条（FR-ANS-01、FR-STAT-06）各有 1 个低严重度缺陷；核心规则（多选全对才得分、填空逐空计分、截止 +10s 宽限、交卷幂等、并发交卷只生效 1 次、强制交卷与缺考生成、统计口径）与设计文档一致，统计结果与手算一致。
4. 非功能需求：NFR-01/02/03（性能）、NFR-04~10（安全与可靠性）、NFR-14（可测试性）验证通过；NFR-11 只验证了服务端断点恢复；NFR-12（易用性）只做了 E2E 主流程走查；NFR-13（分层与可替换存储）属于架构评审项，不在测试范围；NFR-15 只在 Node 22 + Chromium 下验证。
5. 未发现高、中严重度缺陷，系统满足交付与答辩演示要求；建议修复 BUG-01、BUG-02 后重新运行 `npm test` 回归（两条 todo 用例变为通过即说明已修复，届时去掉 `todo` 标记）。


## 回归记录（2026-11-06）

BUG-01、BUG-02 修复后去掉 IT-ANS-13、NFR-SEC-07 的 `todo` 标记，在 backend 目录执行 `npm test`：`# tests 135`、`# pass 135`、`# fail 0`、`# todo 0`，两个缺陷状态均为**已修复（回归通过）**。
