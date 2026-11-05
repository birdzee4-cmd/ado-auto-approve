const auth = require('../shared/auth');
const monitor = require('../shared/company-deployment-monitor');
module.exports = async function(context, req) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' };
  const access = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!access.ok) { context.res = { status: access.status, headers, body: access.body }; return; }
  try {
    const items = await monitor.load();
    context.res = { status: 200, headers, body: { ok: true, fetchedAt: new Date().toISOString(), source: 'Company Monitor', items } };
  } catch (error) {
    context.log.error('Company monitor unavailable:', error.message);
    context.res = { status: 502, headers, body: { ok: false, error: 'อ่านข้อมูล Monitor บริษัทไม่สำเร็จ กรุณากด Refresh เพื่อลองใหม่' } };
  }
};
