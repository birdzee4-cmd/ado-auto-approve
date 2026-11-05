const { test } = require('node:test');
const assert = require('node:assert/strict');

test('today and date boundaries use Bangkok midnight even while UTC is previous day', async () => {
  const { historyDates, appendBangkokDates } = await import('../../public/deployment-dates.js');
  const dates = historyDates('today', new Date('2026-11-04T17:01:00Z'));
  assert.deepEqual(dates, { from: '2026-11-05', to: '2026-11-05' });
  const params = new URLSearchParams(); appendBangkokDates(params, dates.from, dates.to);
  assert.equal(params.get('from'), '2026-11-04T17:00:00.000Z');
  assert.equal(params.get('to'), '2026-11-05T17:00:00.000Z');
});
test('history presets can clear today and include calendar days across month boundaries', async () => {
  const { historyDates } = await import('../../public/deployment-dates.js');
  assert.deepEqual(historyDates('all'), { from: '', to: '' });
  assert.deepEqual(historyDates('7', new Date('2026-11-01T00:00:00Z')), { from: '2026-10-26', to: '2026-11-01' });
});
