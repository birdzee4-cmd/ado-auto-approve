const { createHmac, createHash, timingSafeEqual } = require('node:crypto');
const { ValidationError } = require('./deployment-monitoring-validation');
const { mappingVersion } = require('./deployment-monitoring-provisional');
const wallDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;
function validBoundary(after) {
  if (!after || Object.keys(after).sort().join(',') !== 'id,targetDate' ||
      !Number.isInteger(after.id) || after.id < 1 || after.id > 2147483647 ||
      typeof after.targetDate !== 'string' || !wallDate.test(after.targetDate)) return false;
  const parsed = new Date(`${after.targetDate}Z`);
  return Number.isFinite(parsed.getTime()) && after.targetDate >= '1753-01-01' &&
    parsed.toISOString().slice(0, 19) === after.targetDate.slice(0, 19);
}
function createCursorCodec({ secret, storageTimezone, now = () => new Date() } = {}) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || !['UTC', 'Asia/Bangkok'].includes(storageTimezone)) {
    throw Object.assign(new Error('Deployment monitoring is unavailable'), { code: 'MONITORING_UNAVAILABLE' });
  }
  const fingerprint = filters => createHash('sha256').update(JSON.stringify([
    1, filters.from, filters.to, filters.pageSize, filters.q, filters.project, filters.status,
    storageTimezone, mappingVersion, 'TargetDate DESC,ID DESC', 'development-projection-v1'
  ])).digest('base64url');
  const sign = text => createHmac('sha256', secret).update(text).digest('base64url');
  return {
    encode(after, filters) {
      if (!validBoundary(after)) throw new ValidationError();
      const body = Buffer.from(JSON.stringify({ v: 1, f: fingerprint(filters), after,
        expires: now().getTime() + 15 * 60000 })).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    decode(token, filters) {
      try {
        if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw new Error();
        const [body, signature] = token.split('.');
        if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(body)))) throw new Error();
        const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (Object.keys(value).sort().join(',') !== 'after,expires,f,v' || value.v !== 1 ||
            value.f !== fingerprint(filters) || !Number.isSafeInteger(value.expires) ||
            value.expires <= now().getTime() || value.expires > now().getTime() + 15 * 60000 ||
            !validBoundary(value.after)) throw new Error();
        return value.after;
      } catch { throw new ValidationError(); }
    }
  };
}
module.exports = { createCursorCodec, validBoundary };
