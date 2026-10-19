const dateKey = value => {
  if (!value) return '';
  const text = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '';
};
const iso = date => date.toISOString().slice(0, 10);
function buildReport(items, query = {}, now = new Date()) {
  const period = query.period || 'week';
  const selected = query.date || dateKey(now.toISOString());
  const anchor = new Date(`${selected}T00:00:00Z`);
  if (!['week', 'month'].includes(period) || !/^\d{4}-\d{2}-\d{2}$/.test(selected) || !Number.isFinite(anchor.getTime()) || iso(anchor) !== selected) {
    throw Object.assign(new Error('Select a valid date and week or month period'), { status: 400, code: 'INVALID_REPORT_PERIOD' });
  }
  const start = new Date(anchor);
  if (period === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  else start.setUTCDate(1);
  const next = new Date(start);
  if (period === 'week') next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  const startKey = iso(start), nextKey = iso(next);
  const dated = items.map(item => ({ item, date: dateKey(item.firstSeen || item.receivedAt || item.createdAt) }));
  const incidents = dated.filter(row => row.date >= startKey && row.date < nextKey).map(row => row.item)
    .sort((a, b) => Date.parse(b.firstSeen || b.receivedAt || b.createdAt) - Date.parse(a.firstSeen || a.receivedAt || a.createdAt));
  const resources = new Map();
  for (const item of incidents) {
    const resource = String(item.resource || '').trim() || 'Unknown resource';
    const key = JSON.stringify([item.subscription || '', item.resourceGroup || '', resource].map(value => value.trim().toLowerCase()));
    if (!resources.has(key)) resources.set(key, { key, resource, resourceGroup: item.resourceGroup || '', subscription: item.subscription || '', total: 0, recovered: 0, active: 0 });
    const row = resources.get(key); row.total++;
    if (item.status === 'RESOLVED') row.recovered++;
    if (item.status === 'FIRING') row.active++;
  }
  const daily = [];
  for (const day = new Date(start); day < next; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = iso(day); daily.push({ date, count: dated.filter(row => row.date === date).length });
  }
  const end = new Date(next); end.setUTCDate(end.getUTCDate() - 1);
  return { period, start: startKey, end: iso(end), generatedAt: now.toISOString(), total: incidents.length,
    recovered: incidents.filter(item => item.status === 'RESOLVED').length,
    active: incidents.filter(item => item.status === 'FIRING').length,
    unknownDates: dated.filter(row => !row.date).length,
    resources: [...resources.values()].sort((a, b) => b.total - a.total || a.resource.localeCompare(b.resource)), daily, incidents };
}
module.exports = { buildReport };
