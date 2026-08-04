const data = require('../shared/production-deployments-2026.json');

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

module.exports = async function (context, req) {
  const year = parseInt(req.query.year, 10) || data.year;
  const month = parseInt(req.query.month, 10) || 0;
  const day = parseInt(req.query.day, 10) || 0;
  const category = ['web-service', 'mobile-app'].includes(req.query.category)
    ? req.query.category
    : 'all';
  const search = String(req.query.search || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize, 10) || 25));

  if (year !== data.year || month < 0 || month > 12 || day < 0 || day > 31) {
    return respond(context, 400, { ok: false, error: 'ช่วงวันที่ไม่ถูกต้องหรือยังไม่มีข้อมูลของปีที่เลือก' });
  }

  const filtered = data.rows.filter(row => {
    if (category !== 'all' && row.category !== category) return false;
    const date = parseDeployDate(row.deployDate);
    if (!date || date.year !== year) return false;
    if (month && date.month !== month) return false;
    if (day && date.day !== day) return false;
    if (search && ![
      row.jobNo, row.taskId, row.projectsMainSort, row.projects,
      row.deployType, row.labelCode, row.deployStatus, row.documentStatus
    ].some(value => String(value || '').toLowerCase().includes(search))) return false;
    return true;
  });

  const byCategory = { webService: 0, mobileApp: 0 };
  const byStatus = {};
  filtered.forEach(row => {
    if (row.category === 'mobile-app') byCategory.mobileApp++;
    else byCategory.webService++;
    const status = row.deployStatus || row.documentStatus || 'ไม่ระบุ';
    byStatus[status] = (byStatus[status] || 0) + 1;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  respond(context, 200, {
    ok: true,
    source: {
      file: data.sourceFile,
      lastModified: data.sourceLastModified,
      importedAt: data.importedAt
    },
    filters: { year, month, day, category, search },
    stats: { total: filtered.length, ...byCategory, byStatus },
    pagination: { page: safePage, pageSize, totalPages, totalRows: filtered.length },
    rows: filtered.slice(start, start + pageSize)
  });
};

function parseDeployDate(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  return month ? { day: Number(match[1]), month, year: Number(match[3]) } : null;
}

function respond(context, status, payload) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  };
}
