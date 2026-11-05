// Local, synthetic preview only. No cloud calls or storage writes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { buildTracking } = require('../api/shared/pr-build-tracking');
const [mapping] = require('../api/shared/pr-build-project-map.json');
const base = { projectId: mapping.projectId, projectName: mapping.projectName, environmentGroup: 'Staging' };
const ci = (id, result, hour) => ({ ...base, eventId: `ci-${id}`, sourceType: 'build', pipelineId: mapping.ci.id,
  pipelineName: mapping.ci.name, repositoryName: mapping.repositoryName, sourceBranch: mapping.targetBranch,
  environment: mapping.targetBranch, stageName: 'Build', runId: String(id), pullRequestId: String(1000 + id), result,
  eventCreatedAt: `2026-11-05T${hour}:00:00Z` });
const cd = (id, result, buildId, hour) => ({ ...base, eventId: `cd-${id}`, sourceType: 'classic-release', pipelineId: mapping.cd.id,
  pipelineName: mapping.cd.name, stageName: mapping.cd.stageName, environment: mapping.cd.stageName,
  runId: String(id), artifactBuildIds: JSON.stringify([String(buildId)]), result, eventCreatedAt: `2026-11-05T${hour}:00:00Z` });
const fixtures = [ci(1, 'failed', '01'), ci(2, 'succeeded', '02'), cd(3, 'failed', 2, '03'), cd(4, 'succeeded', 2, '04'), ci(5, 'succeeded', '05')];
const root = path.resolve(__dirname, '..', 'public');
const allowed = new Set(['/deployment.html', '/deployment.css', '/deployment.js', '/pr-build-tracking.js', '/core.js', '/core.css']);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'");
  const json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  if (url.pathname === '/.auth/me') return json({ clientPrincipal: { userDetails: 'LOCAL PREVIEW · Synthetic data', userRoles: ['admin'] } });
  if (url.pathname === '/api/ado-pr-build-tracking') return json({ ok: true, tracking: buildTracking(fixtures) });
  if (url.pathname === '/api/ado-deployment-status') return json({ items: fixtures, nextCursor: '' });
  if (url.pathname === '/api/ado-deployment-summary') return json({ summary: { total: fixtures.length } });
  if (!allowed.has(url.pathname) && !/^\/assets\/[a-zA-Z0-9_-]+\.png$/.test(url.pathname)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(root, url.pathname), (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(url.pathname);
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' })[ext]);
    res.end(data);
  });
});
server.listen(4174, '127.0.0.1', () => console.log('Synthetic PR tracking preview: http://127.0.0.1:4174/deployment.html'));
