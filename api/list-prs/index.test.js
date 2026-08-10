const test = require('node:test');
const assert = require('node:assert/strict');
const listPrs = require('./index');

const helpers = listPrs._test;

test('parseActivityReference detects Azure DevOps PR URLs', () => {
  assert.deepEqual(
    helpers.parseActivityReference(
      'https://dev.azure.com/Buzzebees/Buzzebees/_git/Demo/pullrequest/355224',
      'auto'
    ),
    { ok: true, type: 'pr', id: 355224, raw: 'https://dev.azure.com/Buzzebees/Buzzebees/_git/Demo/pullrequest/355224' }
  );
});

test('parseActivityReference detects Azure DevOps build URLs', () => {
  const result = helpers.parseActivityReference(
    'https://dev.azure.com/buzzebees/Buzzebees/_build/results?buildId=562024&view=results',
    'auto'
  );
  assert.equal(result.ok, true);
  assert.equal(result.type, 'build');
  assert.equal(result.id, 562024);
});

test('parseActivityReference respects an explicit numeric query type', () => {
  assert.equal(helpers.parseActivityReference('562024', 'build').type, 'build');
  assert.equal(helpers.parseActivityReference('#355224', 'pr').id, 355224);
});

test('parseActivityReference rejects free text', () => {
  const result = helpers.parseActivityReference('missing PR', 'auto');
  assert.equal(result.ok, false);
  assert.match(result.error, /numeric PR\/Build ID/);
});

test('getPullRequestIdFromBuild supports triggerInfo and serialized parameters', () => {
  assert.equal(helpers.getPullRequestIdFromBuild({ triggerInfo: { 'pr.number': '355224' } }), 355224);
  assert.equal(
    helpers.getPullRequestIdFromBuild({
      parameters: JSON.stringify({ 'system.pullRequest.pullRequestId': '355225' })
    }),
    355225
  );
  assert.equal(helpers.getPullRequestIdFromBuild({}), 0);
});

test('getLatestLogTimestamp returns the newest supported timestamp', () => {
  const value = helpers.getLatestLogTimestamp([
    { createdDateTime: '2026-08-09T03:00:00Z', fields: {} },
    { lastModifiedDateTime: '2026-08-10T03:00:00Z', fields: {} }
  ]);
  assert.equal(value, '2026-08-10T03:00:00Z');
});
