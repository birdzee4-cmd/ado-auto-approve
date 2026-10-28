const test = require('node:test');
const assert = require('node:assert/strict');
const readiness = require('../shared/merge-manual-readiness');
const active = { status: 'active' };
const approved = () => ({ isRequired: true, vote: 10 });
const me = () => ({ isRequired: true, vote: 0 });

test('two required approvals and only me pending', () => {
  const mine = me();
  assert.equal(readiness([approved(), approved(), mine], mine, active).waitingForMe, true);
});
test('does not infer my turn from a ratio alone', () => {
  const mine = me();
  for (const list of [[approved(), mine, me()], [approved(), approved(), me()], []]) {
    assert.equal(readiness(list, mine, active).waitingForMe, false);
  }
});
test('blocks rejection, waiting for author, draft, completed, and already approved', () => {
  const mine = me();
  for (const vote of [-10, -5]) {
    assert.equal(readiness([approved(), mine, { vote }], mine, active).waitingForMe, false);
  }
  for (const pr of [{ status: 'completed' }, { status: 'active', isDraft: true }]) {
    assert.equal(readiness([approved(), mine], mine, pr).waitingForMe, false);
  }
  mine.vote = 10;
  assert.equal(readiness([approved(), mine], mine, active).waitingForMe, false);
});
test('cannot infer group membership or readiness without required reviewers', () => {
  const group = { isRequired: true, isContainer: true, vote: 0 };
  assert.equal(readiness([approved(), group], group, active).waitingForMe, false);
  assert.equal(readiness([{ vote: 10 }], null, active).readiness, 'unknown');
});
