const replacements = [
  { old: 'STG_Net_Api.Upload_docker-CI', next: 'upload-service-stg-ci' }
];
const norm = value => String(value || '').trim().toLowerCase();
const branch = value => norm(value).replace(/^refs\/heads\//, '');
const repositoryKey = item => norm(item.repositoryId || item.repository);
const pipelineKey = item => norm(item.pipelineId || item.definitionId || item.pipelineName || item.project);
const projectTypeKey = item => norm(item.projectType);
const projectKey = item => norm(item.projectName || item.project);
function startedAt(text) {
  const m = String(text || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i);
  if (!m) return '';
  const hour = Number(m[4]);
  if (hour < 1 || hour > 12) return '';
  const value = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${String(hour % 12 + (m[7].toUpperCase() === 'PM' ? 12 : 0)).padStart(2, '0')}:${m[5]}:${m[6]}+07:00`;
  return Number.isFinite(Date.parse(value)) ? value : '';
}
function sameBuild(a, b) {
  return !!a.id && !!b.id && String(a.id) === String(b.id);
}
function samePipeline(a, b) {
  return pipelineKey(a) === pipelineKey(b);
}
function isReplacementPair(failed, success) {
  const oldName = norm(failed.project || failed.pipelineName);
  const nextName = norm(success.project || success.pipelineName);
  return replacements.some(item => norm(item.old) === oldName && norm(item.next) === nextName);
}
function sameCommitScope(a, b) {
  const repositoryMatches = repositoryKey(a) && repositoryKey(b) && repositoryKey(a) === repositoryKey(b);
  return !!a.commitId && !!b.commitId && norm(a.commitId) === norm(b.commitId) &&
    norm(a.environment) === norm(b.environment) && branch(a.branch) === branch(b.branch) && repositoryMatches;
}
function sameProjectScope(a, b) {
  return sameCommitScope(a, b) && projectKey(a) === projectKey(b) && projectTypeKey(a) === projectTypeKey(b);
}
function correlationFor(failed, success) {
  if (!success || success.status !== 'complete') return null;
  if (sameBuild(failed, success)) return { type: 'same-build', confidence: 'high', matchedBy: ['buildId'] };
  if (samePipeline(failed, success) && sameProjectScope(failed, success)) return { type: 'same-pipeline', confidence: 'high', matchedBy: ['pipeline', 'commit', 'repository', 'branch', 'environment', 'projectType'] };
  if (sameProjectScope(failed, success)) return { type: 'same-commit-cross-pipeline', confidence: 'high', matchedBy: ['commit', 'repository', 'branch', 'environment', 'projectType'] };
  if (sameCommitScope(failed, success)) return { type: 'same-commit-cross-project', confidence: 'medium', matchedBy: ['commit', 'repository', 'branch', 'environment'] };
  if (isReplacementPair(failed, success) && sameCommitScope(failed, success)) return { type: 'legacy-replacement', confidence: 'medium', matchedBy: ['legacyMapping', 'commit', 'repository', 'branch', 'environment', 'projectType'] };
  return null;
}
function isRecoveryCandidate(failed, success) {
  if (!success || Date.parse(success.updatedAt) <= Date.parse(failed.updatedAt)) return false;
  // A deployment can fail while the corresponding build is already running.
  // For deploy failures, completion after the failure plus exact lineage is sufficient.
  if (failed.status === 'deploy fail' && sameCommitScope(failed, success)) return true;
  const successStart = startedAt(success.startText);
  return failed.id === success.id || (!!successStart && Date.parse(successStart) >= Date.parse(failed.updatedAt));
}
function findReplacement(failed, events, used = new Set()) {
  const candidates = events.filter(item => item.status === 'complete' && !used.has(item.eventKey || item.id) && isRecoveryCandidate(failed, item) && correlationFor(failed, item));
  if (!candidates.length) return { recovery: null, candidate: null, ambiguous: false };
  candidates.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  const best = candidates[0];
  const bestCorrelation = correlationFor(failed, best);
  const equivalent = candidates.filter(item => correlationFor(failed, item)?.type === bestCorrelation.type);
  if (equivalent.length > 1) return { recovery: null, candidate: best, ambiguous: true };
  return { recovery: best, candidate: null, ambiguous: false, correlation: bestCorrelation };
}
module.exports = { replacements, norm, branch, sameBuild, samePipeline, sameCommitScope, sameProjectScope, isReplacementPair, correlationFor, isRecoveryCandidate, findReplacement };
