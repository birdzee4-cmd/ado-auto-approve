// Pure contract preparation only: no SQL, credentials, HTTP routes or DB timezone
// conversion. Cursor semantics remain gated on a confirmed unique ordering key.
const DAY = 86400000;
const timezone = 'Asia/Bangkok';

class ValidationError extends Error {
  constructor() {
    super('Invalid monitoring query');
    this.code = 'INVALID_QUERY';
    this.statusCode = 400;
  }
}

function invalid() { throw new ValidationError(); }

function calendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value || value < '1753-01-01') invalid();
  return time;
}

function integer(value, min, max) {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value)) invalid();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) invalid();
  return number;
}

function text(value, max) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) invalid();
  return value.trim();
}

function validateFilters(query = {}, now = new Date()) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) invalid();
  const allowed = new Set(['from', 'to', 'pageSize', 'q', 'project', 'status']);
  if (Object.keys(query).some(key => !allowed.has(key))) invalid();
  // Bangkok calendar day independent of the execution host/browser timezone.
  const today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const from = query.from === undefined ? today : query.from;
  const to = query.to === undefined ? today : query.to;
  const start = calendarDay(from);
  const end = calendarDay(to);
  if (end < start || (end - start) / DAY + 1 > 31 || to === '9999-12-31') invalid();
  const status = query.status === undefined ? null : query.status === 'unknown'
    ? 'unknown' : integer(query.status, -2147483648, 2147483647);
  return {
    from, to, timezone,
    toExclusiveDay: new Date(end + DAY).toISOString().slice(0, 10),
    pageSize: query.pageSize === undefined ? 50 : integer(query.pageSize, 1, 100),
    q: text(query.q, 100), project: text(query.project, 100), status
  };
}

function validateId(value) { return integer(value, 1, 2147483647); }

module.exports = { ValidationError, validateFilters, validateId };
