// 统一业务错误码（系统设计文档 §10.2）
export const ERR = {
  VALIDATION_FAILED: { code: 40000, http: 400, message: '参数校验失败' },
  INVALID_JSON: { code: 40001, http: 400, message: '请求体不是合法的 JSON' },
  OLD_PASSWORD_WRONG: { code: 40003, http: 400, message: '原密码错误' },
  UNAUTHENTICATED: { code: 40100, http: 401, message: '未登录或登录已过期' },
  LOGIN_FAILED: { code: 40101, http: 401, message: '账号或密码错误' },
  FORBIDDEN_ROLE: { code: 40300, http: 403, message: '无权访问该功能' },
  FORBIDDEN_OWNER: { code: 40301, http: 403, message: '无权操作该资源' },
  ACCOUNT_DISABLED: { code: 40302, http: 403, message: '账号已被禁用' },
  SELF_OPERATION: { code: 40303, http: 403, message: '不能对自己执行该操作' },
  NOT_FOUND: { code: 40400, http: 404, message: '资源不存在' },
  METHOD_NOT_ALLOWED: { code: 40500, http: 405, message: '请求方法不被允许' },
  DUPLICATE: { code: 40900, http: 409, message: '名称已存在' },
  RESOURCE_IN_USE: { code: 40901, http: 409, message: '资源已被引用，不能删除' },
  STATE_CONFLICT: { code: 40902, http: 409, message: '当前状态不允许该操作' },
  PAPER_LOCKED: { code: 40903, http: 409, message: '试卷已被考试引用，不能编辑或删除' },
  ALREADY_SUBMITTED: { code: 40904, http: 409, message: '已交卷，请勿重复提交' },
  EXAM_NOT_AVAILABLE: { code: 40905, http: 409, message: '当前不在考试时间内' },
  DEADLINE_PASSED: { code: 40906, http: 409, message: '作答时间已到，系统已自动交卷' },
  GRADING_INCOMPLETE: { code: 40907, http: 409, message: '尚有答卷未完成批改' },
  RESULTS_PUBLISHED: { code: 40908, http: 409, message: '成绩已发布，请先撤回发布' },
  STUDENT_IN_OTHER_CLASS: { code: 40909, http: 409, message: '部分学生已属于其他班级' },
  PAYLOAD_TOO_LARGE: { code: 41300, http: 413, message: '请求体过大' },
  INSUFFICIENT_QUESTIONS: { code: 42200, http: 422, message: '题量不足' },
  ACCOUNT_LOCKED: { code: 42900, http: 429, message: '密码错误次数过多，请 10 分钟后再试' },
  INTERNAL_ERROR: { code: 50000, http: 500, message: '服务器内部错误' },
};

export class AppError extends Error {
  constructor(def, message, data = null) {
    super(message || def.message);
    this.code = def.code;
    this.http = def.http;
    this.data = data ?? null;
  }
}

/** fail('NOT_FOUND', '考试不存在') */
export function fail(name, message, data) {
  const def = ERR[name];
  if (!def) throw new Error(`unknown error name ${name}`);
  return new AppError(def, message, data);
}

export const validationError = (errors) =>
  new AppError(ERR.VALIDATION_FAILED, errors.length === 1 ? errors[0].message : ERR.VALIDATION_FAILED.message, { errors });
export const badField = (field, message) => validationError([{ field, message }]);
export const notFound = (msg) => fail('NOT_FOUND', msg);
export const forbiddenOwner = (msg) => fail('FORBIDDEN_OWNER', msg);
export const forbiddenRole = (msg) => fail('FORBIDDEN_ROLE', msg);
export const conflict = (name, msg, data) => fail(name, msg, data);
