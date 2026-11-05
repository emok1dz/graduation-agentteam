# data/db.json 数据结构说明

> 与 `design/database/ddl.sql` 一一对应：**集合名 = 表名，字段名 = 列名**。仓储层（`backend/src/repositories/`）是唯一读写本文件的代码；业务层只通过仓储接口访问数据。

## 1 文件与写入约定

| 项 | 约定 |
| --- | --- |
| 路径 | `backend/data/db.json`（由 `config.DATA_DIR` 决定，可用环境变量 `DATA_DIR` 覆盖） |
| 编码 | UTF-8，`JSON.stringify(db, null, 2)` |
| 加载 | 启动时整体读入内存；文件不存在或所有集合为空时写入种子数据（§4） |
| 写入 | 事务提交后：写 `db.json.tmp` → `fs.fsync` → `fs.rename('db.json.tmp','db.json')`（同目录原子替换）；写入经串行队列执行，连续多次提交合并为一次落盘，每个事务的 Promise 在包含其改动的那次落盘完成后才 resolve |
| 损坏恢复 | 启动解析失败时拒绝启动并提示（不覆盖原文件）；残留的 `db.json.tmp` 启动时删除 |
| ID | 每个集合使用 `meta.seq.<集合名>` 自增，整数从 1 开始；关联表（`class_teachers`、`question_tags`、`exam_classes`）无 `id`，以复合键唯一 |
| 时间 | ISO8601 UTC 字符串（`toISOString()`），可空字段为 `null` |
| 布尔 | JSON `true/false`（DDL 中为 TINYINT(1)） |
| 分数 | number，最多 1 位小数（统一用 `round1(x) = Math.round(x*10)/10`） |

## 2 顶层结构

```json
{
  "meta": { "schema_version": 1, "seq": { "users": 4, "sessions": 0, "classes": 1, "tags": 3, "questions": 10,
            "paper_questions": 0, "papers": 0, "exams": 0, "submissions": 0, "answers": 0 } },
  "users": [], "sessions": [], "classes": [], "class_teachers": [],
  "tags": [], "questions": [], "question_tags": [],
  "papers": [], "paper_questions": [],
  "exams": [], "exam_classes": [],
  "submissions": [], "answers": []
}
```

## 3 集合字段

字段类型列：`int` 整数、`str` 字符串、`num` 数值、`bool`、`iso` ISO8601 时间字符串、`?` 表示可为 null、`json` 任意 JSON。

### 3.1 users（用户）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键 | id |
| username | str | 账号，唯一，`^[A-Za-z0-9_]{4,20}$` | username |
| name | str | 姓名 ≤20 | name |
| role | str | `admin` / `teacher` / `student` | role |
| class_id | int? | 学生所属班级，教师/管理员为 null | class_id |
| status | str | `active` / `disabled` | status |
| password_hash | str | scrypt(N=16384,r=8,p=1,keylen=64) 结果 hex（128 字符） | password_hash |
| password_salt | str | 16 字节随机盐 hex（32 字符） | password_salt |
| failed_login_count | int | 连续密码错误次数，成功登录清零 | failed_login_count |
| locked_until | iso? | 锁定截止时刻 | locked_until |
| created_at / updated_at | iso | | 同名 |

### 3.2 sessions（会话）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键 | id |
| token_hash | str | SHA-256(token) hex，唯一；明文 token 只返回给客户端一次 | token_hash |
| user_id | int | → users.id | user_id |
| created_at | iso | | created_at |
| last_active_at | iso | 最近一次有效访问（距上次更新 ≥60s 才写回，减少落盘） | last_active_at |
| expires_at | iso | last_active_at + 2h | expires_at |

过期会话在鉴权时惰性删除，并由定时任务每 10 分钟清理一次。

### 3.3 classes（班级）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键 | id |
| name | str | 唯一，≤30 | name |
| grade | str | 年级，默认 "" | grade |
| major | str | 专业，默认 "" | major |
| remark | str | 备注，默认 "" | remark |
| created_at / updated_at | iso | | 同名 |

### 3.4 class_teachers（班级-任课教师）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| class_id | int | → classes.id（复合主键） | class_id |
| teacher_id | int | → users.id（role=teacher） | teacher_id |
| created_at | iso | | created_at |

学生与班级的关系存于 `users.class_id`（一名学生仅属一个班级）。

### 3.5 tags（知识点标签）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键 | id |
| teacher_id | int | 所属教师 | teacher_id |
| name | str | 1~20，(teacher_id, name) 唯一 | name |
| created_at | iso | | created_at |

### 3.6 questions（题目）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键 | id |
| teacher_id | int | 创建教师 | teacher_id |
| type | str | `single`/`multiple`/`judge`/`fill`/`essay` | type |
| stem | str | 题干 ≤2000；填空以 `___` 标记空位 | stem |
| options | json | `[{"key":"A","text":"..."}]`；非选择题为 `[]` | options |
| answer | json? | single `"A"`；multiple `["A","C"]`；judge `true`；fill `[["北京","Beijing"],["1949"]]`；essay 参考答案字符串或 null | answer |
| analysis | str | 解析，默认 "" | analysis |
| difficulty | str | `easy`/`medium`/`hard` | difficulty |
| score | num | 默认分值 | score |
| blank_count | int | 填空空数，其余 0 | blank_count |
| created_at / updated_at | iso | | 同名 |
| deleted_at | iso? | 逻辑删除时刻；非 null 即不出现在题库与选题中 | deleted_at |

### 3.7 question_tags（题目-标签）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| question_id | int | → questions.id | question_id |
| tag_id | int | → tags.id | tag_id |

题目对外的 `tags: string[]` 由本集合 join `tags.name` 得到；标签重命名只改 `tags.name`，删除标签时删除本集合对应行。

### 3.8 papers（试卷）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键 | id |
| teacher_id | int | 创建教师 | teacher_id |
| title | str | ≤100 | title |
| description | str | ≤500 | description |
| total_score | num | 冗余：Σ paper_questions.score | total_score |
| question_count | int | 冗余：题量 | question_count |
| created_at / updated_at | iso | | 同名 |

“是否锁定”不存储，由 `exams` 中是否存在 `paper_id` 引用计算。

### 3.9 paper_questions（试卷题目快照）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键（即接口中的 paper_question_id） | id |
| paper_id | int | → papers.id | paper_id |
| question_id | int? | 来源题目 | question_id |
| seq | int | 题号，从 1 开始，按 single→multiple→judge→fill→essay 分组 | seq |
| type / stem / options / answer / analysis / difficulty / blank_count | — | 组卷时从题目复制的快照，含义同 questions | 同名 |
| tags | json | 快照时的标签名数组 `["数组"]` | tags |
| score | num | 本卷分值 | score |

### 3.10 exams（考试）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键 | id |
| teacher_id | int | 发布教师 | teacher_id |
| paper_id | int | → papers.id | paper_id |
| title | str | ≤100 | title |
| description | str | ≤1000 | description |
| start_time / end_time | iso | 时间窗口 | 同名 |
| duration_minutes | int | 考试时长 | duration_minutes |
| pass_score | num | 及格线 | pass_score |
| shuffle_options | bool | 选项乱序（P2） | shuffle_options |
| cancelled_at | iso? | 非 null 即已取消 | cancelled_at |
| results_published | bool | 成绩是否已发布 | results_published |
| results_published_at | iso? | | results_published_at |
| allow_review | bool | 发布后学生可看答案解析，默认 true | allow_review |
| absent_generated | bool | 内部标记：考试结束后缺考记录是否已生成 | absent_generated |
| created_at / updated_at | iso | | 同名 |

`status`（not_started/ongoing/ended/cancelled）不存储，由 `domain/exam-status.mjs` 按服务端时间计算。

### 3.11 exam_classes（考试-参考班级）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| exam_id | int | → exams.id | exam_id |
| class_id | int | → classes.id | class_id |

### 3.12 submissions（答卷）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键 | id |
| exam_id | int | → exams.id；(exam_id, student_id) 唯一 | exam_id |
| student_id | int | → users.id | student_id |
| class_id | int | 创建时学生所在班级（快照） | class_id |
| status | str | `in_progress` / `pending_review` / `graded` | status |
| submit_type | str? | `manual` / `auto` / `forced` / `absent`；作答中为 null | submit_type |
| started_at | iso? | 服务端开始时刻；缺考为 null | started_at |
| deadline_at | iso? | min(started_at + duration, end_time)；缺考为 null | deadline_at |
| submitted_at | iso? | 交卷时刻（forced 记为 deadline_at；absent 记为 exam.end_time） | submitted_at |
| last_saved_at | iso? | 最后一次保存答案时刻 | last_saved_at |
| objective_score | num? | 客观题得分（交卷时计算；缺考 0） | objective_score |
| subjective_score | num? | 简答得分合计（全部批完后为最终值；无简答为 0） | subjective_score |
| total_score | num? | 状态为 graded 时 = objective + subjective；否则 null | total_score |
| created_at / updated_at | iso | | 同名 |

### 3.13 answers（逐题作答）

| 字段 | 类型 | 说明 | DDL 列 |
| --- | --- | --- | --- |
| id | int | 主键 | id |
| submission_id | int | → submissions.id；(submission_id, paper_question_id) 唯一 | submission_id |
| paper_question_id | int | → paper_questions.id | paper_question_id |
| response | json? | 学生作答；未作答为 null | response |
| score | num? | 得分；客观题交卷时写入，简答批改后写入 | score |
| is_correct | bool? | 客观题是否满分；简答为 null | is_correct |
| comment | str? | 评语 | comment |
| graded_by | int? | 人工批改教师 | graded_by |
| graded_at | iso? | | graded_at |
| created_at / updated_at | iso | | 同名 |

开始作答时为试卷每道题创建一条 `response=null` 的记录；缺考答卷不创建 answers。

## 4 种子数据（数据库为空时自动写入，`backend/src/seed.mjs`）

| 集合 | 内容 |
| --- | --- |
| users | `admin`/`admin123`（管理员，系统管理员）；`teacher1`/`teacher123`（教师，王老师）；`student1`/`student123`（学生，张三）；`student2`/`student123`（学生，李四） |
| classes | `计科2101`（grade `2021`，major `计算机科学与技术`），student1、student2 的 class_id 指向它 |
| class_teachers | (计科2101, teacher1) |
| tags | teacher1 的 `数据结构`、`算法`、`网络` |
| questions | teacher1 的 10 道示例题：single ×3、multiple ×2、judge ×2、fill ×2、essay ×1，覆盖三种难度并关联上述标签 |

种子数据通过与业务相同的 `domain/password.mjs` 生成哈希；不预置试卷与考试（演示时现场组卷发布，或运行可选的 `node scripts/seed-demo.mjs` 生成 NFR-14 规模演示数据）。

## 5 迁移到 MySQL

1. 执行 `ddl.sql` 建表；
2. 按依赖顺序（classes → users → sessions → class_teachers → tags → questions → question_tags → papers → paper_questions → exams → exam_classes → submissions → answers）逐集合 `INSERT`，保留原 `id`；JSON 字段原样写入 JSON 列，`true/false` → 1/0，ISO 时间 → `DATETIME(3)`；
3. 每表执行 `ALTER TABLE t AUTO_INCREMENT = meta.seq.t + 1`；
4. 新增 `backend/src/repositories/mysql/` 实现同一仓储接口，修改 `config.STORAGE = 'mysql'`，业务层不改动。
