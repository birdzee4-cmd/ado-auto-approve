const test = require('node:test');
const assert = require('node:assert/strict');

const ado = require('../shared/ado-client');
const sp = require('../shared/sharepoint-client');
const notifications = require('../shared/notification-service');
const reconciler = require('../shared/auto-complete-reconciler');

test('five-minute reconciler scans and notifies MergeCode PRs while auto-approve mode is normal', async () => {
  const originalGetSettings = sp.getAutoApproveSettings;
  const originalListPrs = ado.listPullRequestsByStatus;
  const originalGetConfig = ado.getConfig;
  const originalNotify = notifications.notifyManualMergeCodeIfNeeded;
  const received = [];
  let listCalls = 0;

  sp.getAutoApproveSettings = async () => ({ autoMode: 'normal' });
  ado.getConfig = () => ({ org: 'example-org', project: 'example-project' });
  ado.listPullRequestsByStatus = async status => {
    listCalls += 1;
    assert.equal(status, 'active');
    return {
      ok: true,
      status: 200,
      pagesFetched: 1,
      body: {
        value: [
          {
            pullRequestId: 901,
            status: 'active',
            isDraft: false,
            title: 'Manual production merge',
            sourceRefName: 'refs/heads/release/3.0',
            targetRefName: 'refs/heads/MergeCodeProduction',
            creationDate: '2026-08-20T10:00:00.000Z',
            createdBy: { displayName: 'Release Owner' },
            repository: { id: 'repo-3', name: 'Demo.Worker' },
            reviewers: [
              { isContainer: true, displayName: 'IT Support Approve' }
            ]
          },
          {
            pullRequestId: 902,
            status: 'active',
            targetRefName: 'refs/heads/staging',
            repository: { id: 'repo-4', name: 'Demo.Api' },
            reviewers: [
              { isContainer: true, displayName: 'IT Support Approve' }
            ]
          }
        ]
      }
    };
  };
  notifications.notifyManualMergeCodeIfNeeded = async (context, pr, options) => {
    received.push({ pr, options });
    return { ok: true, eventKey: 'manual-test' };
  };

  try {
    const result = await reconciler.runAutoCompleteReconcile(null, {});
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'Auto-Approve mode is normal');
    assert.equal(listCalls, 1);
    assert.equal(result.manualMergeCode.checked, 1);
    assert.equal(result.manualMergeCode.sent, 1);
    assert.equal(received.length, 1);
    assert.equal(received[0].pr.id, 901);
    assert.equal(received[0].pr.url, 'https://dev.azure.com/example-org/example-project/_git/Demo.Worker/pullrequest/901');
    assert.equal(received[0].options.scope, 'rest-polling');
    assert.equal(received[0].options.allowReminder, true);
  } finally {
    sp.getAutoApproveSettings = originalGetSettings;
    ado.listPullRequestsByStatus = originalListPrs;
    ado.getConfig = originalGetConfig;
    notifications.notifyManualMergeCodeIfNeeded = originalNotify;
  }
});
