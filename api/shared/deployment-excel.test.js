const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const excel = require('./deployment-excel');

test('exports Web/Service and Mobile records to the expected sheets and columns', async () => {
  const base = {
    plannedDeployAt: '2026-07-31T03:00:00.000Z',
    taskId: '48001',
    projectsMainSort: '[TH] Example',
    projectsSubType: '[TH] FrontEnd Projects',
    project: 'Example',
    labelCode: '0017_RR_DM001_20260731_1000_Example',
    lifecycleStatus: 'Completed'
  };
  const buffer = await excel.exportWorkbook([
    Object.assign({}, base, {
      category: 'web-service', jobNo: 'DeployBZBS202600001',
      deployType: 'Website', sourceType: 'Get', deployResult: '✅ Success'
    }),
    Object.assign({}, base, {
      category: 'mobile', jobNo: 'DeployBZBMB202600001',
      deployType: 'Android', platform: 'Android', sourceType: 'BackupCode'
    })
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.getWorksheet('2026').columnCount, 20);
  assert.equal(workbook.getWorksheet('2026 (APP)').columnCount, 12);
  assert.equal(workbook.getWorksheet('2026').getCell('A2').value, 'DeployBZBS202600001');
  assert.equal(workbook.getWorksheet('2026 (APP)').getCell('A2').value, 'DeployBZBMB202600001');
});

test('parses the two source sheet shapes without treating Projects rows as mappings', async () => {
  const workbook = new ExcelJS.Workbook();
  const web = workbook.addWorksheet('2026');
  web.addRow(excel.WEB_HEADERS);
  web.addRow([
    'DeployBZBS202600001', new Date('2026-07-31T00:00:00Z'), '31.07.2026', '48001',
    '[TH] Example', '[TH] BackEnd Projects', 'Service Module', 'Example', 'Get',
    '0017_RR_DM001_20260731_1000_Example', '💼 In Working Hours', '✅ Success',
    '📄RequestDone', '', '', '', '', '', '', ''
  ]);
  const mobile = workbook.addWorksheet('2026 (APP)');
  mobile.addRow(excel.MOBILE_HEADERS);
  mobile.addRow([
    'DeployBZBMB202600001', new Date('2026-07-31T00:00:00Z'), '31.07.2026', '48002',
    '[TH] Example', '[TH] FrontEnd Projects', 'Android', 'Example', 'BackupCode',
    '0017_RR_DM001_20260731_1000_Android_Example', 'Done', ''
  ]);
  const projects = workbook.addWorksheet('Projects');
  projects.addRow(['Type', 'Project Name']);
  projects.addRow(['Website', 'Example']);
  const parsed = await excel.parseImport(await workbook.xlsx.writeBuffer(), 'sample.xlsx');
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].category, 'web-service');
  assert.equal(parsed.records[1].category, 'mobile');
  assert.ok(parsed.masters['deploy-type'].includes('Website'));
  assert.ok(parsed.masters.project.includes('Example'));
});
