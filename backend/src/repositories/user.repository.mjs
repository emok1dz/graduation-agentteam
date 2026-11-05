import { BaseRepository } from './base.repository.mjs';

export class UserRepository extends BaseRepository {
  constructor(store) {
    super(store, 'users');
  }
  findByUsername(username) {
    return this.findOne((u) => u.username === username);
  }
  async listFiltered({ role, class_id, status, keyword } = {}) {
    const kw = keyword ? keyword.toLowerCase() : null;
    return this.findMany(
      (u) =>
        (!role || u.role === role) &&
        (class_id === undefined || class_id === null || u.class_id === class_id) &&
        (!status || u.status === status) &&
        (!kw || u.username.toLowerCase().includes(kw) || u.name.toLowerCase().includes(kw)),
      { sort: (a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id) },
    );
  }
  countByRole(role) {
    return this.count({ role });
  }
}
