import { escapeHtml, getUserEmailForDisplay, safeFetchJson, setText } from './core.js';

const state = { user: null, master: [], records: [], editing: null };
const $ = id => document.getElementById(id);

async function api(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data && (data.error || data.detail) || `Request failed (${response.status})`);
  return data;
}

async function init() {
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
  document.querySelectorAll('.deployment-nav').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
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
  $('category').addEventListener('change', updateConditionalFields);
  $('deployResult').addEventListener('change', updateConditionalFields);
  $('lifecycleStatus').addEventListener('change', updateConditionalFields);
  $('deploymentForm').addEventListener('submit', saveDeployment);
  $('resetForm').addEventListener('click', resetForm);
  $('recordFilters').addEventListener('submit', event => { event.preventDefault(); loadRecords(); });
  $('exportForm').addEventListener('submit', exportWorkbook);
  $('masterForm').addEventListener('submit', saveMaster);
  $('importButton').addEventListener('click', importWorkbook);
}

function updateConditionalFields() {
  const mobile = $('category').value === 'mobile';
  document.querySelectorAll('.web-field').forEach(el => { el.hidden = mobile; });
  document.querySelectorAll('.mobile-field').forEach(el => { el.hidden = !mobile; });
  if (mobile) {
    $('deployType').value = $('platform').value;
    if (!$('documentStatus').value) $('documentStatus').value = 'Done';
  }
  const rollback = !mobile && ['🔄 Success with Issue (RB)', '🔄 Rolled Back'].includes($('deployResult').value);
  document.querySelectorAll('.rollback-field').forEach(el => { el.hidden = !rollback; });
  document.querySelectorAll('.result-section').forEach(el => { el.hidden = $('lifecycleStatus').value === 'Planned'; });
}

async function loadDashboard() {
  try {
    const data = await api('/api/deployment-summary');
    const cards = [
      ['Planned', data.counts.planned], ['In progress', data.counts.inProgress],
      ['Completed', data.counts.completed], ['Issues', data.counts.issue],
      ['Rolled back', data.counts.rolledBack]
    ];
    $('kpiGrid').innerHTML = cards.map(([label, value]) =>
      `<article class="deployment-card kpi"><strong>${Number(value || 0)}</strong><span>${escapeHtml(label)}</span></article>`
    ).join('');
    renderCompactList('upcomingList', data.upcoming);
    renderCompactList('recentList', data.recent);
  } catch (error) { notice(error.message, true); }
}

function renderCompactList(id, records) {
  $(id).innerHTML = (records || []).length ? records.map(item =>
    `<div class="compact-row"><strong>${escapeHtml(item.jobNo || 'Pending Job No.')}` +
    `<br><small>${escapeHtml(item.project || '-')}</small></strong>` +
    `<span>${escapeHtml(formatDate(item.plannedDeployAt))}<br>${escapeHtml(item.lifecycleStatus || '')}</span></div>`
  ).join('') : '<p>No deployments found.</p>';
}

async function loadRecords() {
  const params = new URLSearchParams();
  [['search', 'filterSearch'], ['category', 'filterCategory'], ['lifecycleStatus', 'filterLifecycle'], ['from', 'filterFrom'], ['to', 'filterTo']]
    .forEach(([key, id]) => { if ($(id).value) params.set(key, $(id).value); });
  try {
    const data = await api('/api/deployments?' + params);
    state.records = data.deployments || [];
    $('recordsBody').innerHTML = state.records.length ? state.records.map(item =>
      `<tr><td><strong>${escapeHtml(item.jobNo)}</strong></td><td>${escapeHtml(formatDate(item.plannedDeployAt))}</td>` +
      `<td>${escapeHtml(item.taskId)}</td><td>${escapeHtml(item.project)}</td>` +
      `<td>${item.category === 'mobile' ? 'Mobile' : 'Web / Service'}</td>` +
      `<td><span class="status-pill">${escapeHtml(item.lifecycleStatus)}</span></td><td>${escapeHtml(item.deployResult || '-')}</td>` +
      `<td><button class="row-button" data-edit="${escapeHtml(item.id)}">Edit</button></td></tr>`
    ).join('') : '<tr><td colspan="8">No deployments found.</td></tr>';
    $('recordsBody').querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => editDeployment(button.dataset.edit)));
  } catch (error) { notice(error.message, true); }
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
    fields.forEach(field => { if ($(field)) $(field).value = item[field] || ''; });
    $('deploymentId').value = item.id;
    $('deploymentEtag').value = item.etag;
    $('plannedDeployAt').value = toLocalInput(item.plannedDeployAt);
    $('actualDeployAt').value = toLocalInput(item.actualDeployAt);
    $('swapBackAt').value = toLocalInput(item.swapBackAt);
    $('formTitle').textContent = 'Update Deployment';
    $('jobNoBadge').textContent = item.jobNo;
    updateConditionalFields();
    showView('form');
  } catch (error) { notice(error.message, true); }
}

async function saveDeployment(event) {
  event.preventDefault();
  const button = $('saveDeployment');
  button.disabled = true;
  $('formWarnings').hidden = true;
  try {
    if ($('category').value === 'mobile') $('deployType').value = $('platform').value;
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
  return {
    etag: value('deploymentEtag'),
    category: value('category'),
    lifecycleStatus: value('lifecycleStatus'),
    plannedDeployAt: localToIso(value('plannedDeployAt')),
    actualDeployAt: localToIso(value('actualDeployAt')),
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
  state.editing = null;
  $('deploymentId').value = '';
  $('deploymentEtag').value = '';
  $('formTitle').textContent = 'New Deployment';
  $('jobNoBadge').textContent = 'Job No. will be generated';
  $('lifecycleStatus').value = 'Planned';
  $('category').value = 'web-service';
  $('sourceType').value = 'Get';
  $('formWarnings').hidden = true;
  setDefaultDate();
  updateConditionalFields();
}

async function loadMaster(includeInactive) {
  try {
    const data = await api('/api/deployment-master' + (includeInactive ? '?includeInactive=true' : ''));
    state.master = data.master || [];
    ['projects-main-sort', 'projects-sub-type', 'deploy-type', 'project'].forEach(type => {
      const list = $(`master-${type}`);
      list.innerHTML = state.master.filter(item => item.type === type && item.active)
        .map(item => `<option value="${escapeHtml(item.value)}"></option>`).join('');
    });
    if ($('masterBody')) {
      $('masterBody').innerHTML = state.master.map(item =>
        `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.value)}</td><td>${item.active ? 'Active' : 'Inactive'}</td>` +
        `<td><button class="row-button" data-master-id="${escapeHtml(item.id)}" data-master-type="${escapeHtml(item.type)}" data-master-value="${escapeHtml(item.value)}" data-master-active="${item.active}">${item.active ? 'Deactivate' : 'Activate'}</button></td></tr>`
      ).join('');
      $('masterBody').querySelectorAll('[data-master-id]').forEach(button => button.addEventListener('click', () => toggleMaster(button)));
    }
  } catch (error) { notice(error.message, true); }
}

async function saveMaster(event) {
  event.preventDefault();
  try {
    await api('/api/deployment-master', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: $('masterType').value, value: $('masterValue').value, active: true })
    });
    $('masterValue').value = '';
    await loadMaster(true);
    notice('Master data saved.', false);
  } catch (error) { notice(error.message, true); }
}

async function toggleMaster(button) {
  try {
    await api('/api/deployment-master', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: button.dataset.masterId, type: button.dataset.masterType,
        value: button.dataset.masterValue, active: button.dataset.masterActive !== 'true'
      })
    });
    await loadMaster(true);
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

function setDefaultDate() {
  if (!$('plannedDeployAt').value) {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
    $('plannedDeployAt').value = toLocalInput(date.toISOString());
  }
}

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function localToIso(value) { return value ? new Date(value).toISOString() : ''; }
function formatDate(value) { return value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-'; }
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
