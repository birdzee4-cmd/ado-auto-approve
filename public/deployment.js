import { escapeHtml, getUserEmailForDisplay, safeFetchJson, setText } from './core.js';

const state = { user: null, master: [], records: [], editing: null, editingMaster: null, formBaseline: null };
const $ = id => document.getElementById(id);

async function api(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data && (data.error || data.detail) || `Request failed (${response.status})`);
  return data;
}

async function init() {
  enhanceSearchableSelects();
  bindNavigation();
  bindForms();
  const auth = await api('/.auth/me');
  if (!auth.clientPrincipal) {
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=/deployment.html';
    return;
  }
  state.user = await api('/api/userinfo');
  setText('userName', getUserEmailForDisplay(state.user));
  const isAdmin = (state.user.userRoles || []).some(role => String(role).toLowerCase() === 'admin');
  document.querySelectorAll('.admin-only').forEach(el => { el.hidden = !isAdmin; });
  await Promise.all([loadMaster(), loadDashboard()]);
  setDefaultDate();
}

function bindNavigation() {
  document.querySelectorAll('.deployment-nav').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.view === 'form') resetForm();
    showView(button.dataset.view);
  }));
  document.querySelectorAll('[data-open-form]').forEach(button => button.addEventListener('click', () => {
    resetForm();
    showView('form');
  }));
}

function showView(name) {
  document.querySelectorAll('.deployment-view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
  document.querySelectorAll('.deployment-nav').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  if (name === 'dashboard') loadDashboard();
  if (name === 'records') loadRecords();
  if (name === 'master') loadMaster(true);
  if (name === 'audit') loadAudit();
}

function bindForms() {
  $('category').addEventListener('change', () => {
    if ($('category').value === 'mobile') $('platform').value = '';
    else if ($('deployType').value === 'BackupCode') $('deployType').value = '';
    updateConditionalFields();
  });
  $('deployResult').addEventListener('change', updateConditionalFields);
  $('lifecycleStatus').addEventListener('change', updateConditionalFields);
  const deploymentForm = $('deploymentForm');
  deploymentForm.addEventListener('invalid', event => showFieldError(event.target), true);
  deploymentForm.addEventListener('input', event => clearFieldError(event.target));
  deploymentForm.addEventListener('change', event => clearFieldError(event.target));
  deploymentForm.addEventListener('focusout', event => { if (event.target.required && !event.target.validity.valid) showFieldError(event.target); });
  deploymentForm.addEventListener('submit', saveDeployment);
  $('formSecondaryAction').addEventListener('click', handleFormSecondaryAction);
    $('recordFilters').addEventListener('submit', event => { event.preventDefault(); loadRecords(); });
  $('clearRecordFilters').addEventListener('click', clearRecordFilters);
  $('toggleRecordFilters').addEventListener('click', toggleRecordAdvancedFilters);
  document.querySelectorAll('[data-record-days]').forEach(button =>
    button.addEventListener('click', () => setRecordDateRange(Number(button.dataset.recordDays))));
  $('recordFilterChips').addEventListener('click', event => {
    const button = event.target.closest('[data-clear-record-filter]');
    if (!button) return;
    $(button.dataset.clearRecordFilter).value = '';
    loadRecords();
  });
  ['filterCategory', 'filterLifecycle', 'filterSourceType', 'filterFrom', 'filterTo', 'filterProject', 'filterProjectsMainSort', 'filterProjectsSubType', 'filterDeployType']
    .forEach(id => $(id).addEventListener('change', loadRecords));
  $('exportForm').addEventListener('submit', exportWorkbook);
  $('masterForm').addEventListener('submit', saveMaster);
  $('masterFilter').addEventListener('change', renderMasterTable);
  $('cancelMasterEdit').addEventListener('click', resetMasterEditor);
  $('importButton').addEventListener('click', importWorkbook);
  $('dashboardFilters').addEventListener('submit', event => { event.preventDefault(); loadDashboard(); });
  $('dashboardRange').addEventListener('change', updateDashboardRangeFields);
}

function updateConditionalFields() {
  const mobile = $('category').value === 'mobile';
  const deployType = $('deployType');
  const platform = $('platform');
  const sourceType = $('sourceType');
  document.querySelectorAll('.web-field').forEach(el => { el.hidden = mobile; });
  document.querySelectorAll('.mobile-field').forEach(el => { el.hidden = !mobile; });
  if (mobile) {
    ensureSelectValue('deployType', 'BackupCode');
    deployType.value = 'BackupCode';
    if (!$('documentStatus').value) $('documentStatus').value = '📄RequestDone';
  } else {
    platform.value = '';
  }
  deployType.disabled = mobile;
  platform.disabled = !mobile;
  sourceType.disabled = mobile;
  setSearchableRequired('platform', mobile);
  setSearchableRequired('sourceType', !mobile);
  setRequiredMarker('platform', mobile);
  setRequiredMarker('sourceType', !mobile);
  setRequiredMarker('deployType', !mobile);
  const rollback = !mobile && ['🔄 Success with Issue (RB)', '🔄 Rolled Back'].includes($('deployResult').value);
  document.querySelectorAll('.rollback-field').forEach(el => { el.hidden = !rollback; });
  syncSearchableSelects();
}

async function loadDashboard() {
  const params = new URLSearchParams();
  const range = $('dashboardRange').value;
  if (range === 'custom') {
    if ($('dashboardFrom').value) params.set('from', $('dashboardFrom').value);
    if ($('dashboardTo').value) params.set('to', $('dashboardTo').value);
  } else {
    params.set('range', range);
  }
  [['category', 'dashboardCategory'], ['project', 'dashboardProject'], ['deployType', 'dashboardDeployType']]
    .forEach(([key, id]) => { if ($(id).value) params.set(key, $(id).value); });
  try {
    const data = await api('/api/deployment-summary?' + params);
    setDashboardFilterOptions(data.filterOptions || {});
    renderDashboardKpis(data.counts || {});
    renderDonutChart('resultChart', data.results || [], {
      'Success': '#22c55e', 'Success with Issue': '#eab308',
      'Success with Issue (RB)': '#f97316', 'Rolled Back': '#ef4444', 'Not completed': '#9ca3af'
    });
    renderBarChart('statusChart', data.jobStatuses || [], '#f5a400');
    renderTrendChart(data.trend || []);
    renderProjectChart(data.topProjects || []);
    renderDonutChart('categoryChart', data.categories || [], { 'Web / Service': '#111827', 'Mobile App': '#f5a400' });
    renderCompactList('upcomingList', data.upcoming);
    renderCompactList('recentList', data.recent);
    const from = data.range && data.range.from;
    const to = data.range && data.range.to;
    const rangeText = from || to ? `${from || 'Beginning'} — ${to || 'Today'}` : 'All time';
    $('dashboardUpdated').textContent = `${rangeText} · Last updated ${formatDate(data.lastUpdated)}`;
  } catch (error) { notice(error.message, true); }
}

function updateDashboardRangeFields() {
  const custom = $('dashboardRange').value === 'custom';
  $('dashboardFromLabel').hidden = !custom;
  $('dashboardToLabel').hidden = !custom;
}

function setDashboardFilterOptions(options) {
  updateDashboardSelect('dashboardProject', 'All Projects', options.projects || []);
  updateDashboardSelect('dashboardDeployType', 'All Deploy Types', options.deployTypes || []);
}

function updateDashboardSelect(id, placeholder, values) {
  const select = $(id);
  const selected = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  ensureSelectValue(id, selected);
  select.value = selected;
  refreshSearchableSelect(id);
}

function renderDashboardKpis(counts) {
  const issues = Number(counts.successWithIssue || 0) + Number(counts.successWithIssueRb || 0);
  const cards = [
    { label: 'Total Deployments', value: counts.total || 0 }, { label: 'Successful', value: counts.successful || 0 },
    { label: 'Success Rate', value: `${Number(counts.successRate || 0).toFixed(1)}%` }, { label: 'With Issues', value: issues },
    { label: 'Rolled Back', value: counts.rolledBack || 0 }, { label: 'In Progress', value: counts.inProgress || 0 },
    { label: 'Planned', value: counts.planned || 0 }
  ];
  $('kpiGrid').innerHTML = cards.map(card => `<article class="deployment-card kpi"><strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span></article>`).join('');
}

function renderDonutChart(id, data, colors) {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  if (!total) { $(id).innerHTML = '<p class="chart-empty">No deployment data for this period.</p>'; return; }
  let cursor = 0;
  const segments = data.filter(item => item.value).map(item => { const start = cursor; cursor += Number(item.value) / total * 100; return `${colors[item.label] || '#9ca3af'} ${start}% ${cursor}%`; });
  const legend = data.map(item => {
    const percentage = total ? Math.round(Number(item.value || 0) / total * 1000) / 10 : 0;
    return `<div class="chart-legend-row"><i style="background:${colors[item.label] || '#9ca3af'}"></i><span>${escapeHtml(item.label)}</span><strong>${Number(item.value || 0)} · ${percentage}%</strong></div>`;
  }).join('');
  $(id).innerHTML = `<div class="donut" style="background:conic-gradient(${segments.join(',')})"><div><strong>${total}</strong><span>Total</span></div></div><div class="chart-legend">${legend}</div>`;
}

function renderBarChart(id, data, color) {
  const max = Math.max(1, ...data.map(item => Number(item.value || 0)));
  $(id).innerHTML = data.map(item => `<div class="bar-row"><span>${escapeHtml(item.label)}</span><div><i style="width:${Number(item.value || 0) / max * 100}%;background:${color}"></i></div><strong>${Number(item.value || 0)}</strong></div>`).join('') || '<p class="chart-empty">No deployment data for this period.</p>';
}

function renderProjectChart(data) {
  const max = Math.max(1, ...data.map(item => Number(item.total || 0)));
  $('projectChart').innerHTML = data.map(item => `<div class="bar-row project-bar"><span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span><div><i style="width:${Number(item.total || 0) / max * 100}%"></i></div><strong>${Number(item.total || 0)}</strong><small>✅ ${item.success || 0} &nbsp; ⚠️ ${item.issue || 0} &nbsp; 🔄 ${item.rolledBack || 0}</small></div>`).join('') || '<p class="chart-empty">No project data for this period.</p>';
}

function renderTrendChart(data) {
  const max = Math.max(1, ...data.map(item => Number(item.total || 0)));
  const columns = data.map(item => {
    const totalHeight = Number(item.total || 0) / max * 150;
    const section = value => Number(item.total || 0) ? Number(value || 0) / Number(item.total) * totalHeight : 0;
    return `<div class="trend-column"><strong>${item.total || 0}</strong><div class="trend-stack" style="height:${totalHeight}px"><i class="trend-other" style="height:${section(item.other)}px"></i><i class="trend-rollback" style="height:${section(item.rolledBack)}px"></i><i class="trend-issue" style="height:${section(item.issue)}px"></i><i class="trend-success" style="height:${section(item.success)}px"></i></div><span>${escapeHtml(item.label)}</span></div>`;
  }).join('');
  $('trendChart').innerHTML = data.length ? `<div class="trend-legend"><span>● Success</span><span>● Issue</span><span>● Rolled Back</span><span>● Other</span></div><div class="trend-columns">${columns}</div>` : '<p class="chart-empty">No deployment trend for this period.</p>';
}

function renderCompactList(id, records) {
  $(id).innerHTML = (records || []).length ? records.map(item =>
    `<div class="compact-row"><strong>${escapeHtml(item.jobNo || 'Pending Job No.')}` +
    `<br><small>${escapeHtml(item.project || '-')}</small></strong>` +
    `<span>${escapeHtml(formatDeploymentDate(item.plannedDeployAt))}<br>${escapeHtml(item.lifecycleStatus || '')}</span></div>`
  ).join('') : '<p>No deployments found.</p>';
}

async function loadRecords() {
  const params = new URLSearchParams();
  [['search', 'filterSearch'], ['category', 'filterCategory'], ['lifecycleStatus', 'filterLifecycle'], ['sourceType', 'filterSourceType'], ['from', 'filterFrom'], ['to', 'filterTo'], ['project', 'filterProject'], ['projectsMainSort', 'filterProjectsMainSort'], ['projectsSubType', 'filterProjectsSubType'], ['deployType', 'filterDeployType']]
    .forEach(([key, id]) => { if ($(id).value) params.set(key, $(id).value); });
  try {
    const data = await api('/api/deployments?' + params);
    state.records = data.deployments || [];
    renderRecordFilterSummary(data.count ?? state.records.length);
    $('recordsBody').innerHTML = state.records.length ? state.records.map(item =>
      `<tr><td><strong>${escapeHtml(item.jobNo)}</strong></td><td>${escapeHtml(formatDeploymentDate(item.plannedDeployAt))}</td>` +
      `<td>${escapeHtml(item.taskId)}</td><td>${escapeHtml(item.project)}</td>` +
      `<td>${item.category === 'mobile' ? 'Mobile' : 'Web / Service'}</td>` +
      `<td><span class="status-pill">${escapeHtml(item.lifecycleStatus)}</span></td><td>${escapeHtml(item.deployResult || '-')}</td>` +
      `<td><button class="row-button" data-edit="${escapeHtml(item.id)}">Edit</button></td></tr>`
    ).join('') : '<tr><td colspan="8">No deployments found.</td></tr>';
    $('recordsBody').querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => editDeployment(button.dataset.edit)));
  } catch (error) { notice(error.message, true); }
}

const recordFilterDefinitions = [
  ['filterSearch', 'Search'], ['filterCategory', 'Category'], ['filterLifecycle', 'Status'],
  ['filterSourceType', 'Get / Merge'], ['filterFrom', 'From'], ['filterTo', 'To'],
  ['filterProject', 'Project'], ['filterProjectsMainSort', 'Project Main Sort'],
  ['filterProjectsSubType', 'Project Sub Type'], ['filterDeployType', 'Deploy Type']
];

function renderRecordFilterSummary(count) {
  const active = recordFilterDefinitions.filter(([id]) => $(id).value);
  $('recordCount').textContent = count + (count === 1 ? ' record found' : ' records found');
  $('recordFilterSummary').hidden = false;
  $('recordFilterChips').innerHTML = active.map(([id, label]) => {
    const field = $(id);
    const value = field.tagName === 'SELECT' ? field.options[field.selectedIndex].text : field.value;
    return '<button type="button" class="record-filter-chip" data-clear-record-filter="' + id + '"><span>' +
      escapeHtml(label) + ': ' + escapeHtml(value) + '</span><span aria-hidden="true">×</span></button>';
  }).join('');
}

function clearRecordFilters() {
  recordFilterDefinitions.forEach(([id]) => { $(id).value = ''; });
  loadRecords();
}

function toggleRecordAdvancedFilters() {
  const panel = $('recordAdvancedFilters');
  const expanded = panel.hidden;
  panel.hidden = !expanded;
  $('toggleRecordFilters').setAttribute('aria-expanded', String(expanded));
}

function setRecordDateRange(days) {
  const end = new Date();
  const start = new Date(end);
  if (days > 0) start.setDate(end.getDate() - days + 1);
  $('filterFrom').value = localDateValue(start);
  $('filterTo').value = localDateValue(end);
  loadRecords();
}
async function editDeployment(id) {
  try {
    const data = await api('/api/deployments/' + encodeURIComponent(id));
    const item = data.deployment;
    state.editing = item;
    const fields = [
      'category', 'lifecycleStatus', 'taskId', 'projectsMainSort', 'projectsSubType', 'deployType',
      'project', 'sourceType', 'platform', 'labelCode', 'durationDeploy', 'deployResult',
      'documentStatus', 'swapBackType', 'swapBackDetails', 'remark'
    ];
    ['projectsMainSort', 'projectsSubType', 'deployType', 'project', 'documentStatus'].forEach(field => {
      ensureSelectValue(field, item[field]);
    });
    fields.forEach(field => { if ($(field)) $(field).value = item[field] || ''; });
    $('deploymentId').value = item.id;
    $('deploymentEtag').value = item.etag;
    $('deployAt').value = toDateInput(item.actualDeployAt || item.plannedDeployAt);
    $('swapBackAt').value = toLocalInput(item.swapBackAt);
    $('formTitle').textContent = 'Update Deployment';
    $('jobNoBadge').textContent = item.jobNo;
    updateConditionalFields();
    showView('form');
    state.formBaseline = deploymentFormSignature();
    $('formSecondaryAction').textContent = 'Back to Records';
  } catch (error) { notice(error.message, true); }
}

async function saveDeployment(event) {
  event.preventDefault();
  const button = $('saveDeployment');
  button.disabled = true;
  $('formWarnings').hidden = true;
  try {
    if ($('category').value === 'mobile') $('deployType').value = 'BackupCode';
    const payload = formPayload();
    const id = $('deploymentId').value;
    const data = await api(id ? '/api/deployments/' + encodeURIComponent(id) : '/api/deployments', {
      method: id ? 'PUT' : 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, id ? { 'If-Match': $('deploymentEtag').value } : {}),
      body: JSON.stringify(payload)
    });
    const warnings = data.validation && data.validation.warnings || [];
    if (warnings.length) {
      $('formWarnings').textContent = warnings.join('\n');
      $('formWarnings').hidden = false;
    }
    notice(`${data.deployment.jobNo} saved successfully.`, false);
    resetForm();
    await loadRecords();
    showView('records');
  } catch (error) {
    notice(error.message, true);
  } finally { button.disabled = false; }
}

function formPayload() {
  const value = id => $(id).value;
  const deployAt = localToIso(value('deployAt'));
  return {
    etag: value('deploymentEtag'),
    category: value('category'),
    lifecycleStatus: value('lifecycleStatus'),
    plannedDeployAt: deployAt,
    actualDeployAt: deployAt,
    taskId: value('taskId'),
    projectsMainSort: value('projectsMainSort'),
    projectsSubType: value('projectsSubType'),
    deployType: value('deployType'),
    project: value('project'),
    sourceType: value('sourceType'),
    platform: value('platform'),
    labelCode: value('labelCode'),
    durationDeploy: value('durationDeploy'),
    deployResult: value('deployResult'),
    documentStatus: value('documentStatus'),
    swapBackType: value('swapBackType'),
    swapBackDetails: value('swapBackDetails'),
    swapBackAt: localToIso(value('swapBackAt')),
    remark: value('remark')
  };
}

function resetForm() {
  $('deploymentForm').reset();
  clearFormErrors();
  state.editing = null;
  $('deploymentId').value = '';
  $('deploymentEtag').value = '';
  state.formBaseline = null;
  $('formTitle').textContent = 'New Deployment';
  $('jobNoBadge').textContent = 'Job No. will be generated';
  $('lifecycleStatus').value = 'In Progress';
  $('category').value = '';
  $('sourceType').value = '';
  $('formWarnings').hidden = true;
  $('formSecondaryAction').textContent = 'Reset';
  syncSearchableSelects();
  setDefaultDate();
  updateConditionalFields();
}

function deploymentFormSignature() {
  return JSON.stringify(formPayload());
}

function handleFormSecondaryAction() {
  if (!state.editing) {
    resetForm();
    return;
  }
  const hasUnsavedChanges = state.formBaseline !== deploymentFormSignature();
  if (hasUnsavedChanges && !window.confirm('You have unsaved changes. Do you want to leave without saving?')) return;
  resetForm();
  showView('records');
}

const masterDefinitions = {
  'projects-main-sort': { label: 'Project Main Sort', field: 'projectsMainSort', placeholder: 'Select Project Main Sort' },
  'projects-sub-type': { label: 'Project Sub Type', field: 'projectsSubType', placeholder: 'Select Project Sub Type' },
  'deploy-type': { label: 'Deploy Type', field: 'deployType', placeholder: 'Select Deploy Type' },
  project: { label: 'Project', field: 'project', placeholder: 'Select Project' }
};

async function loadMaster(includeInactive) {
  try {
    const data = await api('/api/deployment-master' + (includeInactive ? '?includeInactive=true' : ''));
    state.master = data.master || [];
    renderDeploymentMasterOptions();
    renderMasterTable();
  } catch (error) { notice(error.message, true); }
}

function renderDeploymentMasterOptions() {
  Object.entries(masterDefinitions).forEach(([type, definition]) => {
    const select = $(definition.field);
    const selected = select.value;
    const items = state.master.filter(item => item.type === type && item.active);
    select.innerHTML = `<option value="">${escapeHtml(definition.placeholder)}</option>` +
      items.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.value)}</option>`).join('');
    ensureSelectValue(definition.field, selected);
    select.value = selected;
    refreshSearchableSelect(definition.field);
  });
  [
    ['filterProject', 'project', 'All projects'],
    ['filterProjectsMainSort', 'projects-main-sort', 'All Project Main Sort'],
    ['filterProjectsSubType', 'projects-sub-type', 'All Project Sub Type'],
    ['filterDeployType', 'deploy-type', 'All Deploy Types']
  ].forEach(([fieldId, type, placeholder]) => {
    const filterSelect = $(fieldId);
    const selectedValue = filterSelect.value;
    const items = state.master.filter(item => item.type === type && item.active);
    filterSelect.innerHTML = '<option value="">' + escapeHtml(placeholder) + '</option>' +
      items.map(item => '<option value="' + escapeHtml(item.value) + '">' + escapeHtml(item.value) + '</option>').join('');
    filterSelect.value = items.some(item => item.value === selectedValue) ? selectedValue : '';
  });
}

function ensureSelectValue(field, value) {
  const select = $(field);
  if (!select || !value || Array.from(select.options).some(option => option.value === value)) return;
  const option = document.createElement('option');
  option.value = value;
  option.textContent = value;
  option.dataset.legacy = 'true';
  select.appendChild(option);
}

function renderMasterTable() {
  const filter = $('masterFilter').value;
  const items = state.master.filter(item => !filter || item.type === filter);
  $('masterBody').innerHTML = items.map(item => {
    const definition = masterDefinitions[item.type];
    return `<tr><td>${escapeHtml(definition ? definition.label : item.type)}</td><td><strong>${escapeHtml(item.value)}</strong></td>` +
      `<td><span class="status-pill ${item.active ? 'active' : 'inactive'}">${item.active ? 'Active' : 'Inactive'}</span></td>` +
      `<td><button class="row-button" data-master-edit="${escapeHtml(item.id)}" data-master-type="${escapeHtml(item.type)}">Edit</button> ` +
      `<button class="row-button" data-master-toggle="${escapeHtml(item.id)}" data-master-type="${escapeHtml(item.type)}">${item.active ? 'Deactivate' : 'Activate'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="4">No selection values found.</td></tr>';
  $('masterBody').querySelectorAll('[data-master-edit]').forEach(button =>
    button.addEventListener('click', () => editMaster(button.dataset.masterType, button.dataset.masterEdit)));
  $('masterBody').querySelectorAll('[data-master-toggle]').forEach(button =>
    button.addEventListener('click', () => toggleMaster(button.dataset.masterType, button.dataset.masterToggle)));
}

function editMaster(type, id) {
  const item = state.master.find(entry => entry.type === type && entry.id === id);
  if (!item) return;
  state.editingMaster = item;
  $('masterId').value = item.id;
  $('masterType').value = item.type;
  $('masterType').disabled = true;
  $('masterValue').value = item.value;
  $('saveMaster').textContent = 'Save Changes';
  $('cancelMasterEdit').hidden = false;
  $('masterValue').focus();
  refreshSearchableSelect('masterType');
}

function resetMasterEditor() {
  state.editingMaster = null;
  $('masterForm').reset();
  $('masterId').value = '';
  $('masterType').disabled = false;
  $('saveMaster').textContent = 'Add Value';
  $('cancelMasterEdit').hidden = true;
  refreshSearchableSelect('masterType');
}

async function saveMaster(event) {
  event.preventDefault();
  const editing = state.editingMaster;
  try {
    await api('/api/deployment-master', {
      method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editing && editing.id,
        type: editing ? editing.type : $('masterType').value,
        value: $('masterValue').value,
        active: editing ? editing.active : true
      })
    });
    resetMasterEditor();
    await loadMaster(true);
    notice(editing ? 'Selection value updated.' : 'Selection value added.', false);
  } catch (error) { notice(error.message, true); }
}

async function toggleMaster(type, id) {
  const item = state.master.find(entry => entry.type === type && entry.id === id);
  if (!item) return;
  try {
    await api('/api/deployment-master', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, type: item.type, value: item.value, active: !item.active })
    });
    if (state.editingMaster && state.editingMaster.id === id && state.editingMaster.type === type) resetMasterEditor();
    await loadMaster(true);
    notice(`Selection value ${item.active ? 'deactivated' : 'activated'}.`, false);
  } catch (error) { notice(error.message, true); }
}

async function loadAudit() {
  try {
    const data = await api('/api/deployment-audit?top=200');
    $('auditBody').innerHTML = (data.audit || []).map(item =>
      `<tr><td>${escapeHtml(formatDate(item.createdAt))}</td><td>${escapeHtml(item.action)}</td>` +
      `<td>${escapeHtml(item.jobNo || '-')}</td><td>${escapeHtml(item.user || '-')}</td>` +
      `<td>${escapeHtml(changeSummary(item))}</td></tr>`
    ).join('') || '<tr><td colspan="5">No audit history found.</td></tr>';
  } catch (error) { notice(error.message, true); }
}

async function importWorkbook() {
  const file = $('importFile').files[0];
  if (!file) return notice('Select an .xlsx file first.', true);
  const button = $('importButton');
  button.disabled = true;
  try {
    const contentBase64 = await fileToBase64(file);
    const data = await api('/api/deployment-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, contentBase64 })
    });
    $('importResult').textContent = JSON.stringify(data.summary, null, 2);
    $('importResult').hidden = false;
    await loadMaster(true);
    notice('Workbook import completed.', false);
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
}

function exportWorkbook(event) {
  event.preventDefault();
  const params = new URLSearchParams();
  [['category', 'exportCategory'], ['lifecycleStatus', 'exportLifecycle'], ['from', 'exportFrom'], ['to', 'exportTo']]
    .forEach(([key, id]) => { if ($(id).value) params.set(key, $(id).value); });
  window.location.href = '/api/deployment-export?' + params;
}

function notice(message, error) {
  $('pageNotice').textContent = message;
  $('pageNotice').className = 'deployment-notice ' + (error ? 'error' : 'success');
  $('pageNotice').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  window.setTimeout(() => { $('pageNotice').hidden = true; }, 7000);
}

const searchableSelects = new Map();

function enhanceSearchableSelects() {
  document.querySelectorAll('select').forEach(select => {
    if (!select.id || searchableSelects.has(select.id)) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-select';
    const input = document.createElement('input');
    input.className = 'searchable-select-input';
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.dataset.fieldId = select.id;
    const menu = document.createElement('div');
    menu.className = 'searchable-select-menu';
    menu.hidden = true;
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(input, menu, select);
    select.classList.add('searchable-native');
    input.required = select.required;
    select.required = false;
    searchableSelects.set(select.id, { select, input, menu });

    input.addEventListener('focus', () => openSearchableSelect(select.id));
    input.addEventListener('click', () => openSearchableSelect(select.id));
    input.addEventListener('input', () => {
      const options = Array.from(select.options).filter(option => option.value);
      const exact = options.find(option =>
        option.textContent.trim().toLowerCase() === input.value.trim().toLowerCase() ||
        option.value.toLowerCase() === input.value.trim().toLowerCase());
      select.value = exact ? exact.value : '';
      input.setCustomValidity(input.value && !exact ? 'Please select a value from the list.' : '');
      renderSearchableOptions(select.id, input.value);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSearchableSelect(select.id);
      if (event.key === 'Enter' && !menu.hidden) {
        const first = menu.querySelector('button');
        if (first) {
          event.preventDefault();
          first.click();
        }
      }
    });
    input.addEventListener('blur', () => window.setTimeout(() => {
      closeSearchableSelect(select.id);
      const selected = select.options[select.selectedIndex];
      if (!selected || !selected.value) {
        if (input.value) input.setCustomValidity('Please select a value from the list.');
      }
    }, 120));
    select.addEventListener('change', () => refreshSearchableSelect(select.id));
    refreshSearchableSelect(select.id);
  });

  document.addEventListener('click', event => {
    searchableSelects.forEach((entry, id) => {
      if (!entry.input.parentElement.contains(event.target)) closeSearchableSelect(id);
    });
  });
}

function renderSearchableOptions(id, query) {
  const entry = searchableSelects.get(id);
  if (!entry) return;
  const needle = String(query || '').trim().toLowerCase();
  const options = Array.from(entry.select.options)
    .filter(option => option.value && (!needle ||
      option.textContent.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle)))
    .slice(0, 100);
  entry.menu.innerHTML = '';
  options.forEach(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.textContent;
    button.dataset.value = option.value;
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      entry.select.value = option.value;
      entry.input.value = option.textContent;
      entry.input.setCustomValidity('');
      closeSearchableSelect(id);
      entry.select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    entry.menu.appendChild(button);
  });
  if (!options.length) {
    const empty = document.createElement('span');
    empty.className = 'searchable-select-empty';
    empty.textContent = 'No matching options';
    entry.menu.appendChild(empty);
  }
}

function openSearchableSelect(id) {
  const entry = searchableSelects.get(id);
  if (!entry || entry.input.disabled) return;
  searchableSelects.forEach((other, otherId) => { if (otherId !== id) closeSearchableSelect(otherId); });
  renderSearchableOptions(id, '');
  entry.menu.hidden = false;
  entry.input.setAttribute('aria-expanded', 'true');
}

function closeSearchableSelect(id) {
  const entry = searchableSelects.get(id);
  if (!entry) return;
  entry.menu.hidden = true;
  entry.input.setAttribute('aria-expanded', 'false');
}

function refreshSearchableSelect(id) {
  const entry = searchableSelects.get(id);
  if (!entry) return;
  const selected = entry.select.options[entry.select.selectedIndex];
  entry.input.value = selected && selected.value ? selected.textContent : '';
  const placeholder = Array.from(entry.select.options).find(option => !option.value);
  entry.input.placeholder = placeholder ? placeholder.textContent : 'Search and select';
  entry.input.disabled = entry.select.disabled;
  entry.input.setCustomValidity('');
}

function setSearchableRequired(id, required) {
  const entry = searchableSelects.get(id);
  if (entry) entry.input.required = required;
  else if ($(id)) $(id).required = required;
  if (!required) clearFieldError(entry ? entry.input : $(id));
}

function setRequiredMarker(id, required) {
  const marker = $(id + 'RequiredMarker');
  if (marker) marker.hidden = !required;
}

function showFieldError(control) {
  if (!control || control.disabled) return;
  const label = control.closest('label');
  if (!label) return;
  const fieldId = control.dataset.fieldId || control.id || '';
  const messages = {
    category: 'Please select a category.',
    sourceType: 'Please select Get / Merge.',
    deployAt: 'Please select a deploy date.',
    platform: 'Please select a platform.',
    taskId: 'Please enter a task ID.',
    projectsMainSort: 'Please select a project main sort.',
    projectsSubType: 'Please select a project sub type.',
    deployType: 'Please select a deploy type.',
    project: 'Please select a project.',
    labelCode: 'Please enter a label code.'
  };
  let error = label.querySelector('.field-error');
  if (!error) {
    error = document.createElement('span');
    error.className = 'field-error';
    label.appendChild(error);
  }
  error.id = fieldId + 'FieldError';
  error.textContent = messages[fieldId] || 'This field is required.';
  label.classList.add('field-invalid');
  label.querySelectorAll('input,select,textarea').forEach(field => {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', error.id);
  });
}

function clearFieldError(control) {
  if (!control) return;
  const label = control.closest('label');
  if (!label) return;
  label.classList.remove('field-invalid');
  const error = label.querySelector('.field-error');
  if (error) error.remove();
  label.querySelectorAll('input,select,textarea').forEach(field => {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  });
}

function clearFormErrors() {
  document.querySelectorAll('#deploymentForm .field-invalid').forEach(label => clearFieldError(label.querySelector('input,select,textarea')));
}

function syncSearchableSelects() {
  searchableSelects.forEach((entry, id) => refreshSearchableSelect(id));
}
function setDefaultDate() {
  const today = localDateValue(new Date());
  if (!$('deployAt').value) $('deployAt').value = today;
}

function toDateInput(value) { return value ? localDateValue(new Date(value)) : ''; }
function localDateValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function localToIso(value) { return value ? new Date(value).toISOString() : ''; }
function formatDate(value) { return value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-'; }
function formatDeploymentDate(value) { return value ? new Date(value).toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '-'; }
function fileToBase64(file) { return file.arrayBuffer().then(buffer => {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}); }
function changeSummary(item) {
  if (item.action === 'CREATE' || item.action === 'IMPORT') return item.action === 'IMPORT' ? 'Imported from Excel' : 'Created';
  const before = item.before || {}; const after = item.after || {};
  return Object.keys(after).filter(key => !['updatedAt', 'updatedBy', 'etag'].includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])).join(', ') || 'Updated';
}

init().catch(error => notice(error.message, true));
