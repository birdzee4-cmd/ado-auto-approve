'use strict';

// This describes required-reviewer votes, not permission to merge or policy health.
module.exports = function mergeManualReadiness(reviewers, myReviewer, pr = {}) {
  const list = Array.isArray(reviewers) ? reviewers : [];
  const required = list.filter(r => r && r.isRequired === true);
  const blocked = list.some(r => r && Number(r.vote) < 0);
  const pending = required.filter(r => Number(r.vote) < 10 || !Number.isFinite(Number(r.vote)));
  const ready = pr.status === 'active' && !pr.isDraft && !blocked &&
    required.length > 0 && pending.length === 1 && !!myReviewer &&
    myReviewer.isContainer !== true && pending[0] === myReviewer &&
    Number(myReviewer.vote) === 0;
  return {
    waitingForMe: ready,
    readiness: ready ? 'waiting-for-me' : required.length ? 'waiting-or-complete' : 'unknown',
    scope: 'required-reviewers'
  };
};
