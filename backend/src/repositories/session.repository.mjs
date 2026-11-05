import { BaseRepository } from './base.repository.mjs';

export class SessionRepository extends BaseRepository {
  constructor(store) {
    super(store, 'sessions', { timestamps: ['created_at'] });
  }
  findByTokenHash(token_hash) {
    return this.findOne({ token_hash });
  }
  removeByUser(userId, exceptId = null) {
    return this.removeWhere((s) => s.user_id === userId && s.id !== exceptId);
  }
  removeExpired(nowIsoStr) {
    return this.removeWhere((s) => s.expires_at <= nowIsoStr);
  }
}
