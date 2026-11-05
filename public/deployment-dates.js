export function bangkokToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function historyDates(range, now = new Date()) {
  if (range === 'all') return { from: '', to: '' };
  const to = bangkokToday(now);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (range === 'today' ? 0 : Number(range) - 1));
  return { from: start.toISOString().slice(0, 10), to };
}

export function appendBangkokDates(params, from, to) {
  if (from) params.set('from', new Date(`${from}T00:00:00+07:00`).toISOString());
  if (to) params.set('to', new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400000).toISOString());
}
