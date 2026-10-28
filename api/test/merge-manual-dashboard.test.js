const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../public/dashboard.js'), 'utf8');

test('notifies on entry, stays dismissed on refresh, resets after leaving', () => {
  const notice = { hidden: true, innerHTML: '' };
  const context = vm.createContext({ window: {}, Set, isMergeCodePr: pr => pr.isMergeCodeTarget,
    document: { getElementById: () => notice } });
  vm.runInContext(source.slice(source.indexOf('let _mergeWaitingFilter'), source.indexOf('let _checkPrsInFlight')), context);
  const ready = { id: 1, repositoryId: 'r', isMergeCodeTarget: true, myApproval: { waitingForMe: true } };
  context.prs = [ready];
  vm.runInContext('updateMergeWaitingNotice(prs)', context);
  assert.equal(notice.hidden, false);
  assert.match(notice.innerHTML, /PR ใหม่ 1/);
  notice.hidden = true;
  vm.runInContext('updateMergeWaitingNotice(prs)', context);
  assert.equal(notice.hidden, true);
  vm.runInContext('updateMergeWaitingNotice([]); updateMergeWaitingNotice(prs)', context);
  assert.equal(notice.hidden, false);
  vm.runInContext('updateMergeWaitingNotice([])', context);
  assert.equal(notice.hidden, true);
});
