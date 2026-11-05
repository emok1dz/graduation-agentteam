import auth from './auth.controller.mjs';
import user from './user.controller.mjs';
import cls from './class.controller.mjs';
import tag from './tag.controller.mjs';
import question from './question.controller.mjs';
import paper from './paper.controller.mjs';
import exam from './exam.controller.mjs';
import student from './student.controller.mjs';
import submission from './submission.controller.mjs';
import grading from './grading.controller.mjs';
import stat from './stat.controller.mjs';
import admin from './admin.controller.mjs';

export function createControllers(services) {
  return Object.assign(
    {},
    auth(services), user(services), cls(services), tag(services), question(services), paper(services),
    exam(services), student(services), submission(services), grading(services), stat(services), admin(services),
  );
}
