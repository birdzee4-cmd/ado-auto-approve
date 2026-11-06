const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(label, condition) { checks.push({ label, ok: Boolean(condition) }); }

const page = read('public/deployment-analytics.html');
const client = read('public/deployment-analytics.js');
const endpoint = read('api/ado-deployment-analytics/index.js');
const config = JSON.parse(read('public/staticwebapp.config.json'));
const route = config.routes.find(item => item.route === '/api/ado-deployment-analytics');

check('Analytics page exists', page.includes('Deployment Analytics'));
check('All five analytics views exist', ['overview', 'health', 'events', 'analytics', 'performance'].every(id => page.includes(`view-${id}`)));
check('Client reads normalized analytics endpoint', client.includes('/api/ado-deployment-analytics'));
check('Client is read-only', !/fetch\([^)]*method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i.test(client));
check('Endpoint is GET-only', endpoint.includes("requireAnyRole") && !endpoint.includes('req.body'));
check('Endpoint declares readOnly response', endpoint.includes('readOnly: true'));
check('Static Web App route is GET-only', route && Array.isArray(route.methods) && route.methods.length === 1 && route.methods[0] === 'GET');
check('Daily monitor module remains present', fs.existsSync(path.join(root, 'public/company-deployment-monitor.js')));

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}`);
if (failed.length) process.exitCode = 1;
else console.log(`Deployment Analytics validation passed (${checks.length} checks).`);
