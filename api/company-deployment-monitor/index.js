const auth = require('../shared/auth');
const archive = require('../shared/company-monitor-archive');
const { trackDay, eventKey } = require('../shared/company-monitor-tracking');
module.exports = async function(context, req) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' };
  const access = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!access.ok) { context.res = { status: access.status, headers, body: access.body }; return; }
  const day = req.query?.date || archive.today();
  if (!archive.validDay(day)) { context.res = { status: 400, headers, body: { ok: false, error: 'Invalid date (YYYY-MM-DD)' } }; return; }
  try {
    const result = await archive.store().read(day);
    const events = await archive.store().readEvents(day);
    const merged = new Map(events.map(item => [eventKey(item), item]));
    for (const item of result.items) if (!merged.has(eventKey(item))) merged.set(eventKey(item), { ...item, observedAt: item.lastChangedObservedAt });
    const tracking = trackDay([...merged.values()], day);
    context.res = { status: 200, headers, body: { ok: true, fetchedAt: result.archive.savedAt, source: 'Company Monitor Archive', ...result, tracking } };
  } catch (error) {
    context.log.error('Company monitor unavailable:', error.message);
    context.res = { status: 503, headers, body: { ok: false, error: 'อ่านประวัติ Monitor จาก Azure ไม่สำเร็จ กรุณากด Refresh เพื่อลองใหม่' } };
  }
};
