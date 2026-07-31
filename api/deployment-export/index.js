const store = require('../shared/deployment-store');
const excel = require('../shared/deployment-excel');
const http = require('../shared/deployment-http');

module.exports = async function (context, req) {
  const access = http.authorize(context, req, false);
  if (!access.ok) return http.json(context, access.status, access.body);
  try {
    const records = await store.listDeployments(Object.assign({}, req.query || {}, { top: 1000 }));
    const buffer = await excel.exportWorkbook(records);
    const suffix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    context.res = {
      status: 200,
      isRaw: true,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Report_Deploy_${suffix}.xlsx"`,
        'Cache-Control': 'no-store'
      },
      body: Buffer.from(buffer)
    };
  } catch (error) {
    http.fail(context, error);
  }
};
