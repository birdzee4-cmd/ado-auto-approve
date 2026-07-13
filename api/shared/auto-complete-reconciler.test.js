const test = require('node:test');
const assert = require('node:assert/strict');
const reconciler = require('./auto-complete-reconciler');

test('branch matcher accepts staging sub-branches', () => {
  assert.equal(
    reconciler.matchesAnyBranchPattern('refs/heads/Staging/Job/example', ['refs/heads/Staging/*']),
    true
  );
});

test('branch matcher rejects development branch', () => {
  assert.equal(
    reconciler.matchesAnyBranchPattern('refs/heads/development', ['refs/heads/Staging/*']),
    false
  );
});

test('branch matcher treats non-wildcard as prefix family', () => {
  assert.equal(
    reconciler.matchesAnyBranchPattern('refs/heads/Staging/TH', ['refs/heads/staging']),
    true
  );
});

test('skip labels are matched case-insensitively', () => {
  const pr = {
    labels: [
      { name: 'Manual-Complete' }
    ]
  };
  assert.equal(reconciler.hasSkipLabel(pr, ['manual-complete']), true);
});

test('reviewer group must be present when configured', () => {
  const pr = {
    reviewers: [
      { isContainer: true, displayName: 'IT Support Approve Team' }
    ]
  };
  assert.equal(reconciler.hasReviewerGroup(pr, 'IT Support Approve'), true);
  assert.equal(reconciler.hasReviewerGroup(pr, 'Other Group'), false);
});
