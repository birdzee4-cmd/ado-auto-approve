const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFilters, validateId } = require('../shared/deployment-monitoring-validation');
const { mappingVersion, statusOf } = require('../shared/deployment-monitoring-status');

test('monitoring defaults to Bangkok today at the UTC day boundary', () => {
  const filters = validateFilters({}, new Date('2026-10-21T17:00:00Z'));
  assert.equal(filters.from, '2026-10-22');
  assert.equal(filters.to, '2026-10-22');
  assert.equal(filters.toExclusiveDay, '2026-10-23');
  assert.equal(filters.timezone, 'Asia/Bangkok');
  assert.equal(filters.pageSize, 50);
});

test('monitoring calendar validation accepts leap dates and 31 inclusive days', () => {
  assert.equal(validateFilters({ from: '2024-02-29', to: '2024-03-30' }).toExclusiveDay, '2024-03-31');
  for (const query of [
    { from: '2026-02-29', to: '2026-03-01' },
    { from: '2026-04-31', to: '2026-05-01' },
    { from: '2026-10-22', to: '2026-10-21' },
    { from: '2026-10-01', to: '2026-11-01' },
    { from: '2026-10-22T00:00:00Z' }, { from: '' },
    { from: '0000-01-01', to: '0000-01-01' },
    { from: '9999-12-31', to: '9999-12-31' }
  ]) assert.throws(() => validateFilters(query), { code: 'INVALID_QUERY', statusCode: 400 });
});

test('monitoring rejects malformed, oversized and unsupported query inputs', () => {
  for (const query of [
    { pageSize: '0' }, { pageSize: '101' }, { pageSize: '1.5' },
    { pageSize: ['10'] }, { q: 'x'.repeat(101) }, { project: 'x'.repeat(101) },
    { status: '' }, { status: '2147483648' }, { status: '0 OR 1=1' },
    { status: '1e2' }, { q: '\u0000' }, { sort: 'ID; DROP TABLE x' },
    { cursor: 'x'.repeat(10000) }
  ]) assert.throws(() => validateFilters(query), { code: 'INVALID_QUERY' });
});

test('monitoring preserves literal Thai/quote/wildcard text for a future parameterized adapter', () => {
  const q = "ทดสอบ '%_[ injection; --";
  assert.equal(validateFilters({ q }).q, q);
  assert.equal(validateFilters({ status: '0' }).status, 0);
  assert.equal(validateFilters({ status: 'unknown' }).status, 'unknown');
  assert.equal(validateFilters({}).status, null);
});

test('monitoring IDs are positive SQL int values', () => {
  assert.equal(validateId('52844'), 52844); // Synthetic input, not evidence this row exists.
  for (const id of ['0', '-1', '2147483648', '1.0', '1 OR 1=1', null]) {
    assert.throws(() => validateId(id), { code: 'INVALID_QUERY' });
  }
});

test('unconfirmed mapping keeps zero, null, negative and new codes unknown without inferring outcome', () => {
  assert.equal(mappingVersion, 'unconfirmed');
  for (const rawCode of [0, null, -1, 9876]) {
    const status = statusOf(rawCode);
    assert.equal(status.rawCode, rawCode);
    assert.equal(status.category, 'unknown');
    assert.equal(status.isTerminal, null);
    assert.equal(status.ownerEvidence, null);
  }
  assert.notEqual(statusOf(0).labelTh, statusOf(null).labelTh);
  assert.throws(() => statusOf('0'), TypeError);
});
