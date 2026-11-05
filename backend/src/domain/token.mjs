import { randomBytes, createHash } from 'node:crypto';

export const generateToken = () => randomBytes(32).toString('hex');
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
