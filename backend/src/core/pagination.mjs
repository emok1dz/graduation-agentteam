import { validationError } from './errors.mjs';

export function parsePage(query = {}) {
  const errors = [];
  let page = 1;
  let page_size = 10;
  if (query.page !== undefined && query.page !== '') {
    page = Number(query.page);
    if (!Number.isInteger(page) || page < 1) errors.push({ field: 'page', message: 'page 必须为 ≥1 的整数' });
  }
  if (query.page_size !== undefined && query.page_size !== '') {
    page_size = Number(query.page_size);
    if (!Number.isInteger(page_size) || page_size < 1 || page_size > 100)
      errors.push({ field: 'page_size', message: 'page_size 必须为 1~100 的整数' });
  }
  if (errors.length) throw validationError(errors);
  return { page, page_size };
}

export function paginate(array, { page, page_size }) {
  const start = (page - 1) * page_size;
  return { items: array.slice(start, start + page_size), total: array.length, page, page_size };
}
