// HTTP 工具：请求体解析、JSON/CSV 响应、查询串解析
import { fail } from './errors.mjs';

export function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(fail('PAYLOAD_TOO_LARGE'));
      return;
    }
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > limit) {
        aborted = true;
        reject(fail('PAYLOAD_TOO_LARGE'));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      if (size === 0) return resolve(undefined);
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(fail('INVALID_JSON'));
      }
    });
    req.on('error', (e) => {
      if (!aborted) reject(e);
    });
  });
}

export function sendJson(res, status, body) {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export function sendCsv(res, filename, text) {
  const buf = Buffer.from(text, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

export function parseQuery(searchParams) {
  const q = {};
  for (const [k, v] of searchParams) q[k] = v;
  return q;
}
