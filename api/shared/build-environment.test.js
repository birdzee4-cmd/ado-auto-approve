const test = require('node:test');
const assert = require('node:assert/strict');
const { getBuildEnvironment, isNotifiableBuildEnvironment } = require('./build-environment');

test('allows stg and prd pipeline tokens case-insensitively', () => {
  assert.equal(getBuildEnvironment('toyotapoint-playwright-stg-ci'), 'stg');
  assert.equal(getBuildEnvironment('orders_PRD_CI'), 'prd');
  assert.equal(isNotifiableBuildEnvironment('orders-prd-ci'), true);
});

test('rejects dev and non-environment substrings', () => {
  assert.equal(getBuildEnvironment('toyotapoint-playwright-dev-ci'), '');
  assert.equal(getBuildEnvironment('product-catalog-ci'), '');
  assert.equal(isNotifiableBuildEnvironment('uat-service-ci'), false);
});
