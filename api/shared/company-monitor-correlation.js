const replacements = [
  { old: 'STG_Net_Api.Upload_docker-CI', next: 'upload-service-stg-ci' }
];
const norm = value => String(value || '').trim().toLowerCase();
function isReplacementPair(failed, success) {
  const oldName = norm(failed.project || failed.pipelineName);
  const nextName = norm(success.project || success.pipelineName);
  return replacements.some(item => norm(item.old) === oldName && norm(item.next) === nextName);
}
function sameCommitScope(a, b) {
  return !!a.commitId && a.commitId === b.commitId && norm(a.environment) === norm(b.environment) &&
    norm(a.branch).replace(/^refs\/heads\//, '') === norm(b.branch).replace(/^refs\/heads\//, '') &&
    (!a.repository || !b.repository || norm(a.repository) === norm(b.repository));
}
function findReplacement(failed, events) {
  return events.find(item => item.status === 'complete' && item.updatedAt > failed.updatedAt && sameCommitScope(failed, item) && isReplacementPair(failed, item)) || null;
}
module.exports = { replacements, sameCommitScope, isReplacementPair, findReplacement };
