const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('./deployment-model');

function validWeb() {
  return {
    category: 'web-service',
    plannedDeployAt: '2026-07-31T03:00:00.000Z',
    taskId: '48001',
    projectsMainSort: '[TH] Example',
    projectsSubType: '[TH] BackEnd Projects',
    deployType: 'Service Module',
    project: 'Example',
    sourceType: 'Get',
    labelCode: '0017_RR_DM001_20260731_1000_Service_Module_Example',
    lifecycleStatus: 'Planned'
  };
}

test('accepts a valid planned Web/Service deployment', () => {
  const result = model.validateDeployment(validWeb());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('requires rollback details for rollback results', () => {
  const input = validWeb();
  input.deployResult = '🔄 Rolled Back';
  input.lifecycleStatus = 'Completed';
  const result = model.validateDeployment(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /SwapBack type/);
  assert.match(result.errors.join(' '), /SwapBack details/);
});

test('normalizes Mobile deployment fields', () => {
  const entity = model.buildDeploymentEntity({
    category: 'mobile',
    plannedDeployAt: '2026-07-31T03:00:00.000Z',
    platform: 'Android',
    deployType: 'Android',
    documentStatus: '',
    durationDeploy: 'should be removed',
    deployResult: 'should be removed'
  }, { user: 'tester@buzzebees.com' });
  assert.equal(entity.deployType, 'BackupCode');
  assert.equal(entity.platform, 'Android');
  assert.equal(entity.sourceType, 'BackupCode');
  assert.equal(entity.documentStatus, 'Done');
  assert.equal(entity.durationDeploy, '');
  assert.equal(entity.deployResult, '');
});

test('requires an explicit Mobile platform', () => {
  const entity = model.buildDeploymentEntity({
    category: 'mobile',
    plannedDeployAt: '2026-07-31T03:00:00.000Z',
    taskId: '48002',
    projectsMainSort: '[TH] Example',
    projectsSubType: '[TH] Mobile Projects',
    deployType: 'BackupCode',
    project: 'Example Mobile',
    labelCode: '0017_RR_DM001_20260731_1000_Example_Mobile'
  }, { user: 'tester@buzzebees.com' });
  const result = model.validateDeployment(entity);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Mobile platform must be Android or iOS/);
});
