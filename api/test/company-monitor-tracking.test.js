const test = require('node:test');
const assert = require('node:assert/strict');
const { trackDay } = require('../shared/company-monitor-tracking');
const date = '2026-11-06';
function event(id, status, time, changes = {}) {
  return { id, project: 'Project A', environment: 'Staging', projectType: 'Website', branch: 'refs/heads/staging', status,
    updatedAt: `${date}T${time}:00+07:00`, startText: '11/6/2026 1:05:00 PM', terminal: ['complete', 'build fail', 'deploy fail', 'cancel deploy'].includes(status), observedAt: `${date}T${time}:30+07:00`, ...changes };
}
const run = events => trackDay(events, date, new Date('2026-11-06T16:00:00Z')).projects;
test('links failure to later fresh success while retaining every run', () => {
  const [project] = run([event('1', 'build fail', '13:00'), event('2', 'complete', '13:20')]);
  assert.equal(project.openCount, 0); assert.equal(project.recoveredCount, 1); assert.equal(project.totalRuns, 2);
  assert.equal(project.failures[0].recovery.id, '2'); assert.equal(project.failures[0].durationSeconds, 1200);
});
test('earlier success, old concurrent build, missing start evidence and cancellation do not close failure', () => {
  const [project] = run([event('0', 'complete', '12:59'), event('1', 'build fail', '13:00'), event('2', 'complete', '13:20', { startText: '11/6/2026 12:50:00 PM' }), event('3', 'complete', '13:25', { startText: '' }), event('4', 'cancel deploy', '13:30')]);
  assert.equal(project.openBuild, 1); assert.equal(project.recoveredCount, 0); assert.equal(project.failures[0].status, 'unverified');
});
test('isolates environment, branch, project type and date', () => {
  const projects = run([event('1', 'deploy fail', '13:00'), event('2', 'complete', '13:20', { environment: 'Production' }), event('3', 'complete', '13:25', { branch: 'other' }), event('4', 'complete', '13:30', { projectType: 'Plugin' }), event('5', 'complete', '13:35', { updatedAt: '2026-11-07T13:35:00+07:00' })]);
  assert.equal(projects.find(p => p.environment === 'Staging').openDeploy, 1);
  assert.ok(!projects.flatMap(p => p.timeline).some(item => item.id === '5'));
});
test('same job status change preserves failure; repeated polls do not inflate counts', () => {
  const [project] = run([event('1', 'build fail', '13:00'), event('1', 'build fail', '13:01'), event('1', 'building', '13:10'), event('1', 'complete', '13:20')]);
  assert.equal(project.failedCount, 1); assert.equal(project.totalRuns, 1); assert.equal(project.timeline.length, 3); assert.equal(project.openCount, 0);
});
test('build and deploy failures remain separate and recurrence after success reopens the project', () => {
  const [project] = run([event('1', 'build fail', '13:00'), event('2', 'deploy fail', '13:10'), event('3', 'complete', '13:20', { startText: '11/6/2026 1:15:00 PM' }), event('4', 'build fail', '14:00')]);
  assert.equal(project.recoveredCount, 1); assert.equal(project.openBuild, 1); assert.equal(project.openDeploy, 1);
});
test('only the latest lane state can count as retrying', () => {
  const [project] = run([event('1', 'build fail', '13:00'), event('2', 'building', '13:10'), event('2', 'build fail', '13:20')]);
  assert.equal(project.retrying, false); assert.equal(project.openBuild, 2);
});
test('historical unresolved age stops at the end of the selected day', () => {
  const [project] = run([event('1', 'build fail', '22:00')]);
  const future = trackDay([event('1', 'build fail', '22:00')], date, new Date('2026-11-10T10:00:00Z')).projects[0];
  assert.equal(future.failures[0].durationSeconds, 7199);
  assert.equal(project.failures[0].durationSeconds, 3600);
});
test('recovers across renamed pipelines using the same commit lineage', () => {
  const project = run([
    event('616169', 'build fail', '13:00', { project: 'project.sika-module-docker', pipelineName: 'STG_Net_Project.Sika_module_docker-CI', repository: 'Net_Project.Sika', commitId: 'c6b4c1a1', startText: '11/6/2026 1:00:00 PM' }),
    event('616170', 'complete', '13:20', { project: 'project.sika-module-docker', pipelineName: 'sika-module-stg-ci', repository: 'Net_Project.Sika', commitId: 'c6b4c1a1', startText: '11/6/2026 1:10:00 PM' })
  ]).find(item => item.failures.length);
  assert.equal(project.openCount, 0);
  assert.equal(project.failures[0].correlationType, 'same-commit-cross-pipeline');
  assert.equal(project.failures[0].confidence, 'high');
});
test('does not recover across pipelines when commit or repository differs', () => {
  const [project] = run([
    event('1', 'build fail', '13:00', { repository: 'repo-a', commitId: 'aaa', startText: '11/6/2026 1:00:00 PM' }),
    event('2', 'complete', '13:20', { repository: 'repo-b', commitId: 'bbb', startText: '11/6/2026 1:10:00 PM' })
  ]);
  assert.equal(project.openCount, 1);
  assert.equal(project.failures[0].recovery, null);
});
test('does not reuse one success for multiple failures', () => {
  const projects = run([
    event('1', 'build fail', '13:00', { commitId: 'same', repository: 'repo', startText: '11/6/2026 1:00:00 PM' }),
    event('2', 'build fail', '13:05', { commitId: 'same', repository: 'repo', startText: '11/6/2026 1:05:00 PM' }),
    event('3', 'complete', '13:20', { commitId: 'same', repository: 'repo', startText: '11/6/2026 1:10:00 PM' })
  ]);
  assert.equal(projects[0].recoveredCount, 1);
  assert.equal(projects[0].openCount, 1);
});
test('recovers when project and project type change but commit lineage is exact', () => {
  const project = run([
    event('616169', 'build fail', '13:00', { project: 'project.sika-module-docker', projectType: 'net_project_module', pipelineName: 'old-ci', repository: 'Net_Project.Sika', commitId: 'c6b4c1a1', startText: '11/6/2026 1:00:00 PM' }),
    event('616170', 'complete', '13:20', { project: 'sika-module-stg', projectType: 'backend-api', pipelineName: 'new-ci', repository: 'Net_Project.Sika', commitId: 'c6b4c1a1', startText: '11/6/2026 1:10:00 PM' })
  ]).find(item => item.failures.length);
  assert.equal(project.openCount, 0);
  assert.equal(project.failures[0].correlationType, 'same-commit-cross-project');
  assert.equal(project.failures[0].confidence, 'medium');
});
