const store = require('../shared/deployment-store');
const http = require('../shared/deployment-http');

module.exports = async function (context, req) {
  const access = http.authorize(context, req, false);
  if (!access.ok) return http.json(context, access.status, access.body);
  try {
    const query = req.query || {};
    const range = resolveRange(query, new Date());
    const base = await store.listDeployments({
      top: 1000,
      category: query.category,
      from: range.from,
      to: range.to
    });
    const filterOptions = {
      projects: uniqueValues(base, 'project'),
      deployTypes: uniqueValues(base, 'deployType')
    };
    const deployments = base.filter(item =>
      (!query.project || item.project === query.project) &&
      (!query.deployType || item.deployType === query.deployType));
    http.json(context, 200, Object.assign({
      ok: true,
      range,
      filterOptions,
      lastUpdated: new Date().toISOString()
    }, aggregateDeployments(deployments, new Date())));
  } catch (error) {
    http.fail(context, error);
  }
};

function aggregateDeployments(deployments, now) {
  const items = deployments || [];
  const today = (now || new Date()).toISOString().slice(0, 10);
  const counts = {
    total: items.length, planned: 0, inProgress: 0, completed: 0, cancelled: 0,
    successful: 0, successWithIssue: 0, successWithIssueRb: 0, rolledBack: 0,
    notCompleted: 0, webService: 0, mobile: 0, today: 0, successRate: 0
  };
  const resultMap = new Map();
  const statusMap = new Map();
  const categoryMap = new Map();
  const projectMap = new Map();
  const trendMap = new Map();
  const monthlyTrend = shouldUseMonthlyTrend(items);

  items.forEach(item => {
    increment(statusMap, item.lifecycleStatus || 'Unknown');
    if (item.lifecycleStatus === 'Planned') counts.planned++;
    if (item.lifecycleStatus === 'In Progress') counts.inProgress++;
    if (item.lifecycleStatus === 'Completed') counts.completed++;
    if (item.lifecycleStatus === 'Cancelled') counts.cancelled++;

    const result = classifyResult(item.deployResult);
    increment(resultMap, result);
    if (result === 'Success') counts.successful++;
    if (result === 'Success with Issue') counts.successWithIssue++;
    if (result === 'Success with Issue (RB)') counts.successWithIssueRb++;
    if (result === 'Rolled Back') counts.rolledBack++;
    if (result === 'Not completed') counts.notCompleted++;

    const category = item.category === 'mobile' ? 'Mobile App' : 'Web / Service';
    increment(categoryMap, category);
    if (item.category === 'mobile') counts.mobile++; else counts.webService++;
    if (String(item.plannedDeployAt || '').slice(0, 10) === today) counts.today++;

    const project = item.project || 'Not specified';
    if (!projectMap.has(project)) projectMap.set(project, { total: 0, success: 0, issue: 0, rolledBack: 0 });
    const projectData = projectMap.get(project);
    projectData.total++;
    if (result === 'Success') projectData.success++;
    else if (result === 'Rolled Back') projectData.rolledBack++;
    else if (/Issue/.test(result)) projectData.issue++;

    const period = trendPeriod(item.plannedDeployAt, monthlyTrend);
    if (period) {
      if (!trendMap.has(period.key)) trendMap.set(period.key, { key: period.key, label: period.label, total: 0, success: 0, issue: 0, rolledBack: 0, other: 0 });
      const trend = trendMap.get(period.key);
      trend.total++;
      if (result === 'Success') trend.success++;
      else if (result === 'Rolled Back') trend.rolledBack++;
      else if (/Issue/.test(result)) trend.issue++;
      else trend.other++;
    }
  });

  const resultTotal = items.length - counts.notCompleted;
  counts.successRate = resultTotal > 0 ? Math.round((counts.successful / resultTotal) * 1000) / 10 : 0;
  return {
    counts,
    results: mapInOrder(resultMap, ['Success', 'Success with Issue', 'Success with Issue (RB)', 'Rolled Back', 'Not completed']),
    jobStatuses: mapInOrder(statusMap, ['Planned', 'In Progress', 'Completed', 'Cancelled', 'Unknown']),
    categories: mapInOrder(categoryMap, ['Web / Service', 'Mobile App']),
    topProjects: Array.from(projectMap.entries()).map(([name, data]) => Object.assign({ name }, data))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 10),
    trend: Array.from(trendMap.values()).sort((a, b) => a.key.localeCompare(b.key)),
    upcoming: items.filter(item => item.lifecycleStatus === 'Planned')
      .sort((a, b) => String(a.plannedDeployAt).localeCompare(String(b.plannedDeployAt))).slice(0, 8),
    recent: items.slice().sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).slice(0, 8)
  };
}

function classifyResult(value) {
  const result = String(value || '');
  if (/Success with Issue \(RB\)/i.test(result)) return 'Success with Issue (RB)';
  if (/Rolled Back/i.test(result)) return 'Rolled Back';
  if (/Success with Issue/i.test(result)) return 'Success with Issue';
  if (/Success/i.test(result)) return 'Success';
  return 'Not completed';
}

function resolveRange(query, now) {
  if (query.from || query.to) return { preset: 'custom', from: query.from || '', to: query.to || '' };
  const preset = query.range || 'current-month';
  const end = isoDate(now);
  if (preset === 'all') return { preset, from: '', to: '' };
  if (preset === 'today') return { preset, from: end, to: end };
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (preset === 'last-3-months') start.setUTCMonth(start.getUTCMonth() - 2);
  if (preset === 'last-6-months') start.setUTCMonth(start.getUTCMonth() - 5);
  return { preset, from: isoDate(start), to: end };
}

function shouldUseMonthlyTrend(items) {
  const dates = (items || []).map(item => new Date(item.plannedDeployAt)).filter(date => !Number.isNaN(date.getTime())).sort((a, b) => a - b);
  return dates.length > 1 && (dates[dates.length - 1] - dates[0]) / 86400000 > 62;
}

function trendPeriod(value, monthly) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (monthly) {
    const key = date.toISOString().slice(0, 7);
    return { key, label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) };
  }
  const key = date.toISOString().slice(0, 10);
  return { key, label: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) };
}

function uniqueValues(items, field) {
  return Array.from(new Set((items || []).map(item => item[field]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function increment(map, key) { map.set(key, (map.get(key) || 0) + 1); }
function mapInOrder(map, order) { return order.map(label => ({ label, value: map.get(label) || 0 })); }
function isoDate(value) { return new Date(value).toISOString().slice(0, 10); }

module.exports.aggregateDeployments = aggregateDeployments;
module.exports.classifyResult = classifyResult;
module.exports.resolveRange = resolveRange;
