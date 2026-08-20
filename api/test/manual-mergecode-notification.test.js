const test = require('node:test');
const assert = require('node:assert/strict');

const notifications = require('../shared/notification-service');
const teams = require('../shared/teams-notifier');
const sp = require('../shared/sharepoint-client');

const helpers = notifications._test;

test('recognizes MergeCode targets and builds repository-scoped event keys', () => {
  assert.equal(helpers.isMergeCodeTarget({ targetBranch: 'refs/heads/MergeCodeProduction' }), true);
  assert.equal(helpers.isMergeCodeTarget({ targetBranch: 'refs/heads/staging' }), false);
  assert.equal(
    helpers.buildManualMergeCodeEventKey({ id: 123, repositoryId: 'Repo-ID' }),
    'teams:manual-mergecode:repo-id:123'
  );
});

test('selects the highest configured reminder threshold currently due', () => {
  const previous = process.env.MERGECODE_REMINDER_HOURS;
  process.env.MERGECODE_REMINDER_HOURS = '4,24';
  try {
    const now = '2026-08-20T12:00:00.000Z';
    assert.equal(helpers.getDueManualReminderHours({ creationDate: '2026-08-20T09:00:00.000Z' }, now), 0);
    assert.equal(helpers.getDueManualReminderHours({ creationDate: '2026-08-20T07:00:00.000Z' }, now), 4);
    assert.equal(helpers.getDueManualReminderHours({ creationDate: '2026-08-19T08:00:00.000Z' }, now), 24);
  } finally {
    if (previous === undefined) delete process.env.MERGECODE_REMINDER_HOURS;
    else process.env.MERGECODE_REMINDER_HOURS = previous;
  }
});

test('deduplicates the initial alert and sends one due reminder', async () => {
  const previousUrl = process.env.TEAMS_WEBHOOK_URL;
  const previousFlag = process.env.TEAMS_MANUAL_MERGECODE_NOTIFICATIONS;
  const originalGetLogByEventKey = sp.getLogByEventKey;
  const originalAddLogItem = sp.addLogItem;
  const originalSendTeamsCard = teams.sendTeamsCard;
  const sentMessages = [];
  const writtenLogs = [];

  process.env.TEAMS_WEBHOOK_URL = 'https://example.test/teams';
  process.env.TEAMS_MANUAL_MERGECODE_NOTIFICATIONS = 'true';
  sp.getLogByEventKey = async eventKey => ({
    ok: true,
    body: {
      value: writtenLogs
        .filter(fields => fields.Event_Key === eventKey)
        .map(fields => ({ fields }))
    }
  });
  sp.addLogItem = async fields => {
    writtenLogs.push(fields);
    return { ok: true, status: 201 };
  };
  teams.sendTeamsCard = async payload => {
    sentMessages.push(payload);
    return { ok: true, status: 200 };
  };

  try {
    const pr = {
      id: 456,
      title: 'Manual release merge',
      repository: 'Demo.Api',
      repositoryId: 'repo-1',
      sourceBranch: 'refs/heads/release/1.0',
      targetBranch: 'refs/heads/MergeCodeProduction',
      createdBy: 'Release Owner',
      creationDate: '2026-08-20T07:00:00.000Z',
      isMergeCodeTarget: true,
      url: 'https://dev.azure.com/example/pr/456'
    };
    const result = await notifications.notifyManualMergeCodeIfNeeded(null, pr, { allowReminder: false });
    const reminderResult = await notifications.notifyManualMergeCodeIfNeeded(
      null,
      pr,
      { allowReminder: true, now: '2026-08-20T12:00:00.000Z' }
    );
    const duplicateResult = await notifications.notifyManualMergeCodeIfNeeded(
      null,
      pr,
      { allowReminder: true, now: '2026-08-20T12:00:00.000Z' }
    );

    assert.equal(result.ok, true);
    assert.equal(reminderResult.ok, true);
    assert.equal(duplicateResult.skipped, true);
    assert.equal(duplicateResult.reason, 'duplicate');
    assert.equal(sentMessages.length, 2);
    assert.match(sentMessages[0].text, /Action required — MergeCode Manual/);
    assert.match(sentMessages[1].text, /4h reminder/);
    assert.equal(writtenLogs.length, 2);
    assert.equal(writtenLogs[0].Event_Key, 'teams:manual-mergecode:repo-1:456:created');
    assert.equal(writtenLogs[1].Event_Key, 'teams:manual-mergecode:repo-1:456:reminder:4h');
  } finally {
    sp.getLogByEventKey = originalGetLogByEventKey;
    sp.addLogItem = originalAddLogItem;
    teams.sendTeamsCard = originalSendTeamsCard;
    if (previousUrl === undefined) delete process.env.TEAMS_WEBHOOK_URL;
    else process.env.TEAMS_WEBHOOK_URL = previousUrl;
    if (previousFlag === undefined) delete process.env.TEAMS_MANUAL_MERGECODE_NOTIFICATIONS;
    else process.env.TEAMS_MANUAL_MERGECODE_NOTIFICATIONS = previousFlag;
  }
});
