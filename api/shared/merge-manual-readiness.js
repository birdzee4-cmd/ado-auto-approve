'use strict';

// This describes required-reviewer votes, not permission to merge or policy health.
module.exports = function mergeManualReadiness(reviewers, myReviewer, pr = {}, eligibleGroup = null) {
  const list = Array.isArray(reviewers) ? reviewers : [];
  const required = list.filter(r => r && r.isRequired === true);
  const blocked = list.some(r => r && Number(r.vote) < 0);
  const pending = required.filter(r => Number(r.vote) < 10 || !Number.isFinite(Number(r.vote)));
  const last = pending.length === 1 ? pending[0] : null;
  const personal = !!last && last === myReviewer && last.isContainer !== true;
  const group = !!last && last === eligibleGroup && last.isContainer === true;
  const ready = pr.status === 'active' && !pr.isDraft && !blocked &&
    required.length > 0 && (personal || group) && Number(last.vote) === 0;
  return {
    waitingForMe: ready,
    waitingAsGroup: ready && group,
    readiness: ready ? 'waiting-for-me' : required.length ? 'waiting-or-complete' : 'unknown',
    scope: 'required-reviewers'
  };
};
