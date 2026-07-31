const ExcelJS = require('exceljs');

const WEB_HEADERS = [
  'Job No.', 'Deploy DateN', 'Deploy Date', 'Task ID', 'Projects Main Sort',
  'Projects Sub Type', 'Deploy Type', 'Projects', 'Type \n(Get/Merge)',
  'Label Code', 'Duration Deploy', 'Deploy\nStatus', 'Document\nStatus', 'Remark',
  'SwapBack Type', 'SwapBack Details', 'Log Swap Back 1', 'Log Swap Back 2',
  'Log Swap Back 3', 'Log Swap Back 4'
];
const MOBILE_HEADERS = [
  'Job No.', 'Deploy DateN', 'Deploy Date', 'Task ID', 'Projects Main Sort',
  'Projects Sub Type', 'Deploy Type', 'Projects', 'Type \n(Get/Merge)',
  'Label Code', 'Document\nStatus', 'Remark'
];
const MASTER_TYPES = {
  projectsMainSort: 'projects-main-sort',
  projectsSubType: 'projects-sub-type',
  deployType: 'deploy-type',
  project: 'project'
};

async function exportWorkbook(records) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Buzzebees Deployment Report Portal';
  workbook.created = new Date();
  const web = (records || []).filter(item => item.category === 'web-service');
  const mobile = (records || []).filter(item => item.category === 'mobile');
  if (web.length || !mobile.length) addSheet(workbook, '2026', WEB_HEADERS, web.map(toWebRow));
  if (mobile.length) addSheet(workbook, '2026 (APP)', MOBILE_HEADERS, mobile.map(toMobileRow));
  return workbook.xlsx.writeBuffer();
}

async function parseImport(buffer, fileName) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const records = [];
  const masters = {
    'projects-main-sort': new Set(),
    'projects-sub-type': new Set(),
    'deploy-type': new Set(),
    project: new Set()
  };
  const errors = [];
  parseDeploymentSheet(workbook.getWorksheet('2026'), 'web-service', fileName, records, masters, errors);
  parseDeploymentSheet(workbook.getWorksheet('2026 (APP)'), 'mobile', fileName, records, masters, errors);
  parseProjectsSheet(workbook.getWorksheet('Projects'), masters);
  return {
    records,
    masters: Object.fromEntries(Object.entries(masters).map(([key, values]) => [key, Array.from(values)])),
    errors
  };
}

function parseDeploymentSheet(sheet, category, fileName, records, masters, errors) {
  if (!sheet) {
    errors.push({ sheet: category === 'mobile' ? '2026 (APP)' : '2026', row: 0, error: 'Sheet not found' });
    return;
  }
  const headers = headerMap(sheet.getRow(1));
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const jobNo = text(valueAt(row, headers, 'Job No.'));
    if (!jobNo) continue;
    try {
      const labelCode = text(valueAt(row, headers, 'Label Code'));
      const deployDate = parseExcelDate(valueAt(row, headers, 'Deploy DateN')) ||
        parseDotDate(text(valueAt(row, headers, 'Deploy Date'))) ||
        parseLabelDate(labelCode);
      const deployType = text(valueAt(row, headers, 'Deploy Type'));
      const deployResult = text(valueAt(row, headers, 'Deploy Status'));
      const item = {
        id: importId(jobNo),
        jobNo,
        category,
        plannedDeployAt: deployDate,
        actualDeployAt: deployDate,
        taskId: text(valueAt(row, headers, 'Task ID')),
        projectsMainSort: text(valueAt(row, headers, 'Projects Main Sort')),
        projectsSubType: text(valueAt(row, headers, 'Projects Sub Type')),
        deployType,
        project: text(valueAt(row, headers, 'Projects')),
        sourceType: category === 'mobile' ? 'BackupCode' : text(valueAt(row, headers, 'Type (Get/Merge)')),
        platform: category === 'mobile' ? deployType : '',
        labelCode,
        lifecycleStatus: 'Completed',
        durationDeploy: text(valueAt(row, headers, 'Duration Deploy')),
        deployResult,
        documentStatus: text(valueAt(row, headers, 'Document Status')),
        remark: text(valueAt(row, headers, 'Remark')),
        swapBackType: text(valueAt(row, headers, 'SwapBack Type')),
        swapBackDetails: text(valueAt(row, headers, 'SwapBack Details')),
        swapBackAt: parseSwapBack(text(valueAt(row, headers, 'Log Swap Back 1'))),
        sourceFile: fileName,
        sourceSheet: sheet.name,
        sourceRow: rowNumber
      };
      records.push(item);
      Object.entries(MASTER_TYPES).forEach(([field, type]) => {
        if (item[field]) masters[type].add(item[field]);
      });
    } catch (error) {
      errors.push({ sheet: sheet.name, row: rowNumber, jobNo, error: error.message });
    }
  }
}

function parseProjectsSheet(sheet, masters) {
  if (!sheet) return;
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const type = text(sheet.getCell(rowNumber, 1).value);
    const project = text(sheet.getCell(rowNumber, 2).value);
    if (type) masters['deploy-type'].add(type);
    if (project) masters.project.add(project);
  }
}

function addSheet(workbook, name, headers, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(headers);
  rows.forEach(row => sheet.addRow(row));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FF111827' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5A400' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 34;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: headers.length } };
  sheet.columns.forEach((column, index) => {
    const headerText = headers[index] || '';
    column.width = /Label/.test(headerText) ? 55 : /Remark|Details/.test(headerText) ? 32 : /Project/.test(headerText) ? 25 : 18;
    column.alignment = { vertical: 'top', wrapText: true };
  });
  if (sheet.rowCount > 1) {
    sheet.getColumn(2).numFmt = 'yyyy-mm-dd';
  }
}

function toWebRow(item) {
  const date = dateForExport(item);
  return [
    item.jobNo, date, dotDate(date), item.taskId, item.projectsMainSort,
    item.projectsSubType, item.deployType, item.project, item.sourceType,
    item.labelCode, item.durationDeploy, item.deployResult, item.documentStatus,
    item.remark, item.swapBackType, item.swapBackDetails,
    item.swapBackAt ? 'SwapBack : ' + dotDate(new Date(item.swapBackAt)) : '', '', '', ''
  ];
}

function toMobileRow(item) {
  const date = dateForExport(item);
  return [
    item.jobNo, date, dotDate(date), item.taskId, item.projectsMainSort,
    item.projectsSubType, item.deployType, item.project, 'BackupCode',
    item.labelCode, item.documentStatus || 'Done', item.remark
  ];
}

function dateForExport(item) {
  const date = new Date(item.actualDeployAt || item.plannedDeployAt);
  return Number.isNaN(date.getTime()) ? '' : date;
}

function dotDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = bangkokDateParts(date);
  return [parts.day, parts.month, parts.year].join('.');
}

function bangkokDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  return parts.reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
}

function headerMap(row) {
  const map = {};
  row.eachCell({ includeEmpty: false }, (cell, column) => {
    map[canonical(cell.value)] = column;
  });
  return map;
}

function valueAt(row, headers, name) {
  const column = headers[canonical(name)];
  return column ? row.getCell(column).value : '';
}

function canonical(value) {
  return text(value).replace(/_x000D_/gi, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function text(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('').trim();
  }
  return String(value).trim();
}

function parseExcelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function parseDotDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  return match ? new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))).toISOString() : '';
}

function parseSwapBack(value) {
  const match = /(\d{2})\.(\d{2})\.(\d{4})/.exec(value || '');
  return match ? new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))).toISOString() : '';
}

function parseLabelDate(value) {
  const match = /(?:^|_)(20\d{2})(\d{2})(\d{2})(?:_|$)/.exec(value || '');
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function importId(jobNo) {
  return 'import-' + String(jobNo).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
}

module.exports = {
  WEB_HEADERS,
  MOBILE_HEADERS,
  exportWorkbook,
  parseImport,
  dotDate
};
