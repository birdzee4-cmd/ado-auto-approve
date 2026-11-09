const { createHash } = require('node:crypto');
const { findReplacement } = require('./company-monitor-correlation');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const branch = value => String(value || '').trim().replace(/^refs\/heads\//, '');
const pipeline = item => String(item.pipelineId || item.definitionId || item.pipelineName || '').trim().toLowerCase();
function startedAt(text) {
  const m = String(text || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i);
  if (!m) return '';
  const hour = Number(m[4]);
  if (hour < 1 || hour > 12) return '';
  const value = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${String(hour % 12 + (m[7].toUpperCase() === 'PM' ? 12 : 0)).padStart(2, '0')}:${m[5]}:${m[6]}+07:00`;
  return Number.isFinite(Date.parse(value)) ? value : '';
}
function eventKey(item) {
  return digest([item.environment, item.id, item.project, item.projectType, branch(item.branch), item.status, item.updatedAt, item.startText]);
}
function laneKey(item) { return JSON.stringify([item.environment, item.project, String(item.projectType || '').trim(), branch(item.branch)]); }
function projectKey(item) { return JSON.stringify([item.environment, item.project]); }
function later(success, failure) {
  const a = Date.parse(success.updatedAt), b = Date.parse(failure.updatedAt);
  if (success.id === failure.id) return a > b || (a === b && success.observedAt > failure.observedAt);
  return a > b && !!startedAt(success.startText) && Date.parse(startedAt(success.startText)) >= b;
}
function trackDay(events, day, now = new Date()) {
  const end = Date.parse(`${day}T23:59:59.999+07:00`);
  const asOf = Math.min(now.getTime(), end);
  const ordered = [...events].filter(item => item.updatedAt?.startsWith(day) && Date.parse(item.updatedAt) <= asOf)
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || String(a.observedAt || '').localeCompare(String(b.observedAt || '')) || eventKey(a).localeCompare(eventKey(b)));
  // Polling and duration/metadata updates do not constitute additional attempts.
  const states = new Map(), timeline = [];
  for (const item of ordered) {
    const key = JSON.stringify([laneKey(item), item.id]);
    const previous = states.get(key);
    if (previous?.status === item.status) { previous.latestUpdateAt = item.updatedAt; if (item.startText) previous.startText = item.startText; continue; }
    const event = { ...item, eventKey: eventKey(item), latestUpdateAt: item.updatedAt };
    timeline.push(event); states.set(key, event);
  }
  const projects = new Map();
  for (const item of timeline) {
    const key = projectKey(item);
    if (!projects.has(key)) projects.set(key, { key, name: item.project, environment: item.environment, timeline: [], failures: [] });
    projects.get(key).timeline.push(item);
  }
  const allEvents = timeline;
  const usedRecoveries = new Set();
  for (const project of projects.values()) {
    for (let index = 0; index < project.timeline.length; index++) {
      const failed = project.timeline[index];
      if (!['build fail', 'deploy fail'].includes(failed.status)) continue;
      const following = project.timeline.slice(index + 1).filter(item => laneKey(item) === laneKey(failed));
      const sameLaneSuccess = following.find(item => item.status === 'complete' && later(item, failed) && !usedRecoveries.has(item.eventKey) &&
        (!failed.commitId && !item.commitId || (failed.commitId && item.commitId && failed.commitId === item.commitId && (!failed.repository || !item.repository || failed.repository.toLowerCase() === item.repository.toLowerCase()))));
      const match = sameLaneSuccess
        ? { recovery: sameLaneSuccess, candidate: null, ambiguous: false, correlation: { type: failed.id === sameLaneSuccess.id ? 'same-build' : pipeline(failed) === pipeline(sameLaneSuccess) ? 'same-pipeline' : 'same-commit-cross-pipeline', confidence: 'high', matchedBy: ['pipeline', 'branch', 'environment', 'projectType'] } }
        : findReplacement(failed, allEvents.filter(item => later(item, failed)), usedRecoveries);
      const recovery = match.recovery;
      if (recovery) usedRecoveries.add(recovery.eventKey);
      const candidate = !recovery ? match.candidate || following.find(item => item.status === 'complete' && Date.parse(item.updatedAt) > Date.parse(failed.updatedAt)) || null : null;
      const laneLatest = following.at(-1);
      const retry = !recovery && laneLatest && !laneLatest.terminal && later(laneLatest, failed) ? laneLatest : null;
      const replacement = recovery && match.correlation?.type === 'legacy-replacement' ? recovery : null;
      const ambiguous = !recovery && match.ambiguous;
      project.failures.push({ failed, recovery, candidate, replacement, retry, ambiguous, correlationType: recovery ? match.correlation?.type : ambiguous ? 'ambiguous' : candidate ? 'unverified' : 'no-match', confidence: recovery ? match.correlation?.confidence : ambiguous ? 'low' : 'none', matchedBy: recovery ? match.correlation?.matchedBy || [] : [], status: recovery ? 'recovered' : replacement ? 'superseded' : retry ? 'retrying' : ambiguous || candidate ? 'unverified' : 'open',
        durationSeconds: Math.max(0, Math.floor(((recovery ? Date.parse(recovery.updatedAt) : asOf) - Date.parse(failed.updatedAt)) / 1000)),
        evidence: recovery ? (match.correlation?.type === 'same-commit-cross-pipeline' ? 'later-complete-same-commit-cross-pipeline' : failed.id === recovery.id ? 'same-monitor-job-status-change' : 'later-monitor-run-started-after-failure') : ambiguous ? 'multiple-success-candidates' : candidate ? 'later-complete-without-new-build-evidence' : 'no-later-success' });
    }
    project.latest = [...project.timeline].sort((a, b) => Date.parse(a.latestUpdateAt) - Date.parse(b.latestUpdateAt)).at(-1);
    project.totalRuns = new Set(project.timeline.map(item => item.id)).size;
    project.failedCount = project.failures.length;
    project.recoveredCount = project.failures.filter(item => item.recovery || item.replacement).length;
    project.supersededCount = project.failures.filter(item => item.replacement).length;
    project.openBuild = project.failures.filter(item => !item.recovery && !item.replacement && item.failed.status === 'build fail').length;
    project.openDeploy = project.failures.filter(item => !item.recovery && !item.replacement && item.failed.status === 'deploy fail').length;
    project.openCount = project.openBuild + project.openDeploy;
    project.retrying = project.failures.some(item => item.retry);
    project.lastFailureAt = project.failures.at(-1)?.failed.updatedAt || '';
    project.status = project.openCount ? project.retrying ? 'retrying' : 'open' : project.failedCount ? 'recovered' : 'no-failure';
    project.timeline.reverse(); project.failures.reverse();
  }
  return { date: day, asOf: new Date(asOf).toISOString(), projects: [...projects.values()].sort((a, b) => Date.parse(b.latest.updatedAt) - Date.parse(a.latest.updatedAt)),
    note: 'กลับมาสำเร็จหมายถึง Monitor รายงาน Complete ภายหลัง โดยยืนยันจาก Build/ Pipeline เดิม หรือ Commit + Repository + Environment + Project Type + Branch เดียวกัน; Legacy Mapping ใช้เฉพาะข้อมูลเก่า' };
}
module.exports = { trackDay, eventKey, startedAt };
