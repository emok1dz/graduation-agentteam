# 在线考试系统毕业设计

ICT 大赛实践赛题 **1.12「AgentTeam-多智能体协作完成毕业设计」** 作品。

题目《基于 Node.js 的在线考试系统的设计与实现》（方向：全栈 Web 系统）。一个 Leader 智能体组建 7 个角色的 Agent Team，按“需求 → 设计 → 开发 → 测试 → 论文 → 答辩”五个阶段协作完成。每个阶段都经 Leader 验收后才进入下一阶段，过程记录在 [team/log.md](team/log.md)。

## 成果一览

| 阶段 | 角色 | 产出 | 关键数字 |
| --- | --- | --- | --- |
| 1 需求 | 需求分析师 | [requirements/](requirements/)：需求规格说明书、用例图、需求追踪矩阵 | 功能需求 33 条、非功能需求 15 条 |
| 2 设计 | 系统架构师 | [design/](design/)：系统设计文档、架构图、ER 图、OpenAPI 契约、MySQL DDL | 62 个接口、13 个实体 |
| 3 开发 | 后端开发者 | [backend/](backend/)：Node.js 原生 http，零第三方依赖 | 62/62 接口全部实现 |
| 3 开发 | 前端开发者 | [frontend/](frontend/)：原生 JS 单页应用 | 26 个页面、28 条路由 |
| 3 测试 | 测试工程师 | [backend/test/](backend/test/)、[tests-e2e/](tests-e2e/)、[docs/test-report.md](docs/test-report.md) | 后端 134 条 + E2E 8 条全部通过；行覆盖率 96.70% |
| 4 论文 | 论文撰写者 | [thesis/毕业论文.md](thesis/毕业论文.md) | 6 章，约 2 万字，图 23 幅、表 29 张 |
| 5 答辩 | 答辩助手 | [defense/](defense/)：PPT（可放映 HTML）、大纲、演示脚本、预测 QA | 18 页，QA 32 条 |

界面截图：[docs/screenshots/](docs/screenshots/)

## 运行

需要 Node.js 18 或更高版本，不用安装任何依赖。

```bash
cd backend
npm start                 # http://localhost:3000
npm test                  # 后端测试：tests 135 / pass 135 / fail 0
node ../tests-e2e/e2e.test.mjs   # 浏览器端到端测试（需要 Playwright）
```

种子账号：`admin/admin123`（管理员）、`teacher1/teacher123`（教师）、`student1/student123`（学生）。

## 功能

- **管理员**：用户与班级管理、考试总览
- **教师**：题库（单选、多选、判断、填空、简答，支持难度和知识点）、组卷（手动选题或按题型随机抽题）、发布考试、考试监控、简答题批改、成绩发布与统计（分数段分布、每题正确率、CSV 导出）
- **学生**：考试列表、在线答题（倒计时、自动保存、断网重试、到时自动交卷）、成绩与答卷详情

## 需要本人完成的部分

- 论文：学校格式排版、查重、核实参考文献、把 Mermaid/PlantUML 图导出为图片（见 [thesis/README.md](thesis/README.md)）；致谢、封面信息
- 答辩：封面姓名与学号；QA 第 29 题按本人实际参与情况调整
