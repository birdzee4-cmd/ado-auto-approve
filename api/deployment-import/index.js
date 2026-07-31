const store = require('../shared/deployment-store');
const excel = require('../shared/deployment-excel');
const http = require('../shared/deployment-http');

module.exports = async function (context, req) {
  const access = http.authorize(context, req, true);
  if (!access.ok) return http.json(context, access.status, access.body);
  try {
    const body = req.body || {};
    if (!body.contentBase64) return http.json(context, 400, { ok: false, error: 'contentBase64 is required' });
    if (body.contentBase64.length > 20 * 1024 * 1024) {
      return http.json(context, 413, { ok: false, error: 'Workbook is too large. Maximum upload size is 15 MB.' });
    }
    const parsed = await excel.parseImport(Buffer.from(body.contentBase64, 'base64'), body.fileName || 'Report Deploy.xlsx');
    const summary = { imported: 0, skipped: 0, invalid: 0, masterSeeded: 0, errors: parsed.errors.slice() };
    const user = http.userOf(access);
    await store.syncCountersFromJobNos(parsed.records.map(item => item.jobNo));
    for (const item of parsed.records) {
      const result = await store.upsertImportedDeployment(item, user);
      if (result.skipped) summary.skipped++;
      else if (result.ok) summary.imported++;
      else {
        summary.invalid++;
        summary.errors.push({
          sheet: item.sourceSheet,
          row: item.sourceRow,
          jobNo: item.jobNo,
          error: (result.validation && result.validation.errors || []).join(' ')
        });
      }
    }
    for (const [type, values] of Object.entries(parsed.masters)) {
      summary.masterSeeded += await store.seedMaster(type, values, user);
    }
    http.json(context, 200, { ok: true, summary });
  } catch (error) {
    http.fail(context, error);
  }
};
