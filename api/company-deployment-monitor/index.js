const auth = require('../shared/auth');
const archive = require('../shared/company-monitor-archive');
const eventStore = require('../shared/ado-deployment-event-store');
const { trackDay, eventKey } = require('../shared/company-monitor-tracking');
const { enrich } = require('../shared/company-monitor-ado-enrichment');
const overridesStore = require('../shared/company-monitor-overrides');
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
    const monitorItems = [...merged.values()];
    let lineageByBuildId = {};
    try { lineageByBuildId = await eventStore.findBuildLineage(monitorItems.map(item => item.azureBuildId || item.id), day); } catch (error) { context.log.warn('Service Hook lineage enrichment unavailable:', error.message); }
    const enriched = await enrich(monitorItems, { lineageByBuildId });
    const overrides = await overridesStore.read(day);
    const tracking = trackDay(enriched, day, new Date(), overrides);
    context.res = { status: 200, headers, body: { ok: true, fetchedAt: result.archive.savedAt, source: 'Company Monitor Archive', ...result, items: enriched, tracking } };
  } catch (error) {
    context.log.error('Company monitor unavailable:', error.message);
    context.res = { status: 503, headers, body: { ok: false, error: 'อ่านประวัติ Monitor จาก Azure ไม่สำเร็จ กรุณากด Refresh เพื่อลองใหม่' } };
  }
};
