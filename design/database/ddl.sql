-- =====================================================================
-- 在线考试系统  MySQL 8.0 建表语句（迁移目标）
-- 与 design/database/json-schema.md 中 data/db.json 的集合一一对应：
--   集合名 = 表名，字段名 = 列名；JSON 中的数组/对象字段对应 JSON 列。
-- 约定：
--   * 所有时间列存 UTC，DATETIME(3)；应用层以 ISO8601 字符串收发。
--   * 布尔列为 TINYINT(1)，0/1 对应 JSON 中的 false/true。
--   * 分数列 DECIMAL(6,1)（最多 1 位小数）。
--   * 主键 BIGINT UNSIGNED AUTO_INCREMENT，对应 JSON 中 meta.seq 生成的自增整数。
-- 字符集：utf8mb4 / utf8mb4_0900_ai_ci
-- =====================================================================

CREATE DATABASE IF NOT EXISTS online_exam
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE online_exam;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS answers;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS exam_classes;
DROP TABLE IF EXISTS exams;
DROP TABLE IF EXISTS paper_questions;
DROP TABLE IF EXISTS papers;
DROP TABLE IF EXISTS question_tags;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS class_teachers;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS classes;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- 班级
-- ---------------------------------------------------------------------
CREATE TABLE classes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(30)     NOT NULL COMMENT '班级名称，全局唯一',
  grade       VARCHAR(10)     NOT NULL DEFAULT '' COMMENT '年级',
  major       VARCHAR(30)     NOT NULL DEFAULT '' COMMENT '专业',
  remark      VARCHAR(200)    NOT NULL DEFAULT '' COMMENT '备注',
  created_at  DATETIME(3)     NOT NULL,
  updated_at  DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_classes_name (name)
) ENGINE=InnoDB COMMENT='班级';

-- ---------------------------------------------------------------------
-- 用户（管理员 / 教师 / 学生）
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username            VARCHAR(20)     NOT NULL COMMENT '账号（学号/工号），^[A-Za-z0-9_]{4,20}$',
  name                VARCHAR(20)     NOT NULL COMMENT '姓名',
  role                ENUM('admin','teacher','student') NOT NULL,
  class_id            BIGINT UNSIGNED NULL COMMENT '学生所属班级（一名学生仅属于一个班级）',
  status              ENUM('active','disabled') NOT NULL DEFAULT 'active',
  password_hash       CHAR(128)       NOT NULL COMMENT 'scrypt 派生密钥 64 字节 hex',
  password_salt       CHAR(32)        NOT NULL COMMENT '随机盐 16 字节 hex',
  failed_login_count  INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '连续密码错误次数',
  locked_until        DATETIME(3)     NULL COMMENT '锁定截止时刻',
  created_at          DATETIME(3)     NOT NULL,
  updated_at          DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  KEY idx_users_role_status (role, status),
  KEY idx_users_class (class_id),
  KEY idx_users_created (created_at),
  CONSTRAINT fk_users_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='用户';

-- ---------------------------------------------------------------------
-- 会话
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash      CHAR(64)        NOT NULL COMMENT 'SHA-256(token) hex，库中不存明文令牌',
  user_id         BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME(3)     NOT NULL,
  last_active_at  DATETIME(3)     NOT NULL,
  expires_at      DATETIME(3)     NOT NULL COMMENT 'last_active_at + 2h（滑动过期）',
  PRIMARY KEY (id),
  UNIQUE KEY uk_sessions_token (token_hash),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='登录会话';

-- ---------------------------------------------------------------------
-- 班级任课教师（班级-教师 多对多）
-- ---------------------------------------------------------------------
CREATE TABLE class_teachers (
  class_id    BIGINT UNSIGNED NOT NULL,
  teacher_id  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME(3)     NOT NULL,
  PRIMARY KEY (class_id, teacher_id),
  KEY idx_class_teachers_teacher (teacher_id),
  CONSTRAINT fk_ct_class   FOREIGN KEY (class_id)   REFERENCES classes (id) ON DELETE CASCADE,
  CONSTRAINT fk_ct_teacher FOREIGN KEY (teacher_id) REFERENCES users (id)   ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='班级任课教师';

-- ---------------------------------------------------------------------
-- 知识点标签（教师私有）
-- ---------------------------------------------------------------------
CREATE TABLE tags (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  teacher_id  BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(20)     NOT NULL,
  created_at  DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tags_teacher_name (teacher_id, name),
  CONSTRAINT fk_tags_teacher FOREIGN KEY (teacher_id) REFERENCES users (id)
) ENGINE=InnoDB COMMENT='知识点标签';

-- ---------------------------------------------------------------------
-- 题目（题库）
-- ---------------------------------------------------------------------
CREATE TABLE questions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  teacher_id   BIGINT UNSIGNED NOT NULL COMMENT '创建教师',
  type         ENUM('single','multiple','judge','fill','essay') NOT NULL,
  stem         TEXT            NOT NULL COMMENT '题干，≤2000 字；填空题以 ___ 标记空位',
  options      JSON            NOT NULL COMMENT '[{"key":"A","text":"..."}]，非选择题为 []',
  answer       JSON            NULL     COMMENT '标准答案，形状随题型',
  analysis     TEXT            NOT NULL COMMENT '解析，可为空串',
  difficulty   ENUM('easy','medium','hard') NOT NULL,
  score        DECIMAL(6,1)    NOT NULL COMMENT '默认分值',
  blank_count  INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '填空题空数',
  created_at   DATETIME(3)     NOT NULL,
  updated_at   DATETIME(3)     NOT NULL,
  deleted_at   DATETIME(3)     NULL COMMENT '逻辑删除时刻',
  PRIMARY KEY (id),
  KEY idx_questions_owner (teacher_id, deleted_at, type, difficulty),
  KEY idx_questions_created (teacher_id, created_at),
  FULLTEXT KEY ft_questions_stem (stem) WITH PARSER ngram,
  CONSTRAINT fk_questions_teacher FOREIGN KEY (teacher_id) REFERENCES users (id)
) ENGINE=InnoDB COMMENT='题目';

CREATE TABLE question_tags (
  question_id  BIGINT UNSIGNED NOT NULL,
  tag_id       BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (question_id, tag_id),
  KEY idx_question_tags_tag (tag_id),
  CONSTRAINT fk_qt_question FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE CASCADE,
  CONSTRAINT fk_qt_tag      FOREIGN KEY (tag_id)      REFERENCES tags (id)      ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='题目-标签';

-- ---------------------------------------------------------------------
-- 试卷与试卷题目快照
-- ---------------------------------------------------------------------
CREATE TABLE papers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  teacher_id      BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(100)    NOT NULL,
  description     VARCHAR(500)    NOT NULL DEFAULT '',
  total_score     DECIMAL(7,1)    NOT NULL COMMENT '冗余：各题分值之和',
  question_count  INT UNSIGNED    NOT NULL COMMENT '冗余：题量',
  created_at      DATETIME(3)     NOT NULL,
  updated_at      DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_papers_owner (teacher_id, created_at),
  CONSTRAINT fk_papers_teacher FOREIGN KEY (teacher_id) REFERENCES users (id)
) ENGINE=InnoDB COMMENT='试卷';

CREATE TABLE paper_questions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  paper_id     BIGINT UNSIGNED NOT NULL,
  question_id  BIGINT UNSIGNED NULL COMMENT '来源题目（题目被逻辑删除不影响快照）',
  seq          INT UNSIGNED    NOT NULL COMMENT '题号，从 1 开始',
  type         ENUM('single','multiple','judge','fill','essay') NOT NULL,
  stem         TEXT            NOT NULL,
  options      JSON            NOT NULL,
  answer       JSON            NULL,
  analysis     TEXT            NOT NULL,
  difficulty   ENUM('easy','medium','hard') NOT NULL,
  tags         JSON            NOT NULL COMMENT '快照时的标签名数组',
  score        DECIMAL(6,1)    NOT NULL COMMENT '本卷中该题分值',
  blank_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pq_paper_seq (paper_id, seq),
  UNIQUE KEY uk_pq_paper_question (paper_id, question_id),
  KEY idx_pq_question (question_id),
  CONSTRAINT fk_pq_paper    FOREIGN KEY (paper_id)    REFERENCES papers (id)    ON DELETE CASCADE,
  CONSTRAINT fk_pq_question FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='试卷题目快照';

-- ---------------------------------------------------------------------
-- 考试与参考班级
-- ---------------------------------------------------------------------
CREATE TABLE exams (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  teacher_id            BIGINT UNSIGNED NOT NULL,
  paper_id              BIGINT UNSIGNED NOT NULL,
  title                 VARCHAR(100)    NOT NULL,
  description           VARCHAR(1000)   NOT NULL DEFAULT '',
  start_time            DATETIME(3)     NOT NULL,
  end_time              DATETIME(3)     NOT NULL,
  duration_minutes      INT UNSIGNED    NOT NULL,
  pass_score            DECIMAL(7,1)    NOT NULL,
  shuffle_options       TINYINT(1)      NOT NULL DEFAULT 0,
  cancelled_at          DATETIME(3)     NULL COMMENT '非空即已取消',
  results_published     TINYINT(1)      NOT NULL DEFAULT 0,
  results_published_at  DATETIME(3)     NULL,
  allow_review          TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '发布后学生可查看答案与解析',
  absent_generated      TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '内部：缺考记录是否已生成',
  created_at            DATETIME(3)     NOT NULL,
  updated_at            DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_exams_owner (teacher_id, start_time),
  KEY idx_exams_paper (paper_id),
  KEY idx_exams_window (start_time, end_time),
  CONSTRAINT fk_exams_teacher FOREIGN KEY (teacher_id) REFERENCES users (id),
  CONSTRAINT fk_exams_paper   FOREIGN KEY (paper_id)   REFERENCES papers (id),
  CONSTRAINT ck_exams_window CHECK (end_time > start_time),
  CONSTRAINT ck_exams_duration CHECK (duration_minutes >= 1)
) ENGINE=InnoDB COMMENT='考试';

CREATE TABLE exam_classes (
  exam_id   BIGINT UNSIGNED NOT NULL,
  class_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (exam_id, class_id),
  KEY idx_exam_classes_class (class_id),
  CONSTRAINT fk_ec_exam  FOREIGN KEY (exam_id)  REFERENCES exams (id)   ON DELETE CASCADE,
  CONSTRAINT fk_ec_class FOREIGN KEY (class_id) REFERENCES classes (id)
) ENGINE=InnoDB COMMENT='考试-参考班级';

-- ---------------------------------------------------------------------
-- 答卷与逐题作答
-- ---------------------------------------------------------------------
CREATE TABLE submissions (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_id           BIGINT UNSIGNED NOT NULL,
  student_id        BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NOT NULL COMMENT '创建答卷时学生所在班级（快照）',
  status            ENUM('in_progress','pending_review','graded') NOT NULL,
  submit_type       ENUM('manual','auto','forced','absent') NULL,
  started_at        DATETIME(3)     NULL COMMENT '缺考记录为 NULL',
  deadline_at       DATETIME(3)     NULL COMMENT 'min(started_at + duration, exam.end_time)',
  submitted_at      DATETIME(3)     NULL,
  last_saved_at     DATETIME(3)     NULL,
  objective_score   DECIMAL(7,1)    NULL,
  subjective_score  DECIMAL(7,1)    NULL,
  total_score       DECIMAL(7,1)    NULL,
  created_at        DATETIME(3)     NOT NULL,
  updated_at        DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_submissions_exam_student (exam_id, student_id) COMMENT '每人每场仅一份答卷',
  KEY idx_submissions_student (student_id, submitted_at),
  KEY idx_submissions_exam_status (exam_id, status),
  KEY idx_submissions_deadline (status, deadline_at) COMMENT '超时兜底扫描',
  CONSTRAINT fk_sub_exam    FOREIGN KEY (exam_id)    REFERENCES exams (id),
  CONSTRAINT fk_sub_student FOREIGN KEY (student_id) REFERENCES users (id),
  CONSTRAINT fk_sub_class   FOREIGN KEY (class_id)   REFERENCES classes (id)
) ENGINE=InnoDB COMMENT='答卷';

CREATE TABLE answers (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id      BIGINT UNSIGNED NOT NULL,
  paper_question_id  BIGINT UNSIGNED NOT NULL,
  response           JSON            NULL COMMENT '学生作答，未作答为 NULL',
  score              DECIMAL(6,1)    NULL COMMENT '得分；简答未批改为 NULL',
  is_correct         TINYINT(1)      NULL COMMENT '客观题是否满分；简答为 NULL',
  comment            VARCHAR(500)    NULL COMMENT '教师评语',
  graded_by          BIGINT UNSIGNED NULL COMMENT '人工批改教师',
  graded_at          DATETIME(3)     NULL,
  created_at         DATETIME(3)     NOT NULL,
  updated_at         DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_answers_sub_pq (submission_id, paper_question_id),
  KEY idx_answers_pq (paper_question_id),
  CONSTRAINT fk_ans_submission FOREIGN KEY (submission_id)     REFERENCES submissions (id)     ON DELETE CASCADE,
  CONSTRAINT fk_ans_pq         FOREIGN KEY (paper_question_id) REFERENCES paper_questions (id),
  CONSTRAINT fk_ans_grader     FOREIGN KEY (graded_by)         REFERENCES users (id)           ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='逐题作答';
