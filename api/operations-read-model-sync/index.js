const sharePoint = require('../shared/operations-sharepoint-client');
const readModel = require('../shared/operations-incident-read-model');

module.exports = async function (context, req) {
  const expected = process.env.OPERATIONS_READ_MODEL_SYNC_TOKEN || '';
  const supplied = String(req.headers?.['x-operations-read-model-token'] || req.query?.token || '');
  if (!expected || supplied !== expected) {
    context.res = { status: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }), headers: { 'Content-Type': 'application/json' } };
    return;
  }
  try {
    const pageSize = Number(req.body?.pageSize || req.query?.pageSize || 100);
    const cursor = String(req.body?.cursor || req.query?.cursor || '');
    const result = await readModel.syncPageFromSharePoint(sharePoint, pageSize, cursor);
    context.res = { status: 200, body: JSON.stringify({ ok: true, data: result }), headers: { 'Content-Type': 'application/json' } };
  } catch (error) {
    context.log.error('Operations incident read-model sync failed:', error);
    context.res = { status: Number(error.status) || 503, body: JSON.stringify({ ok: false, error: 'READ_MODEL_SYNC_FAILED', detail: error.message }), headers: { 'Content-Type': 'application/json' } };
  }
};
