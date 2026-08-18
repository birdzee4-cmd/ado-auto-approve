import { safeFetchJson, formatDate, escapeHtml, getUserEmailForDisplay } from './core.js';

window.addEventListener('DOMContentLoaded', () => {
  initUserInfo();
  loadDiagnostics();
  setupEvents();
});

let currentBuildId = null;
let diagnosticData = null;

async function initUserInfo() {
  try {
    const authResp = await fetch('/.auth/me');
    const authData = await authResp.json();
    if (authData.clientPrincipal) {
      const principal = authData.clientPrincipal;
      const userNameEl = document.getElementById('userName');
      if (userNameEl) {
        let displayEmail = getUserEmailForDisplay(principal, 'Unknown');
        try {
          const userResp = await safeFetchJson('/api/userinfo');
          if (userResp.ok && userResp.data) {
            displayEmail = getUserEmailForDisplay(userResp.data, displayEmail);
          }
        } catch (e) {}
        userNameEl.textContent = displayEmail;
      }
    }
  } catch (e) {
    console.warn('Failed to load user auth info:', e);
  }
}

async function loadDiagnostics() {
  const params = new URLSearchParams(window.location.search);
  const buildId = params.get('buildId');
  currentBuildId = buildId;

  if (!buildId) {
    showError('❌ Error: Parameter `buildId` is missing in the URL query.');
    return;
  }

  try {
    const result = await safeFetchJson('/api/build-diagnostics?buildId=' + buildId);
    
    if (result.parseError) {
      showError('❌ Backend responded with non-JSON format (HTTP ' + result.status + ')');
      return;
    }
    
    if (!result.ok || !result.data || !result.data.ok) {
      const d = result.data || {};
      showError('❌ ' + (d.error || 'Failed to retrieve diagnostics') + 
               (d.hint ? '<br/><small>' + d.hint + '</small>' : '') + 
               (d.detail ? '<br/><small style="color:#ef4444">' + d.detail + '</small>' : ''));
      return;
    }

    const data = result.data;
    diagnosticData = data;
    renderPage(data);

  } catch (err) {
    showError('❌ System Error: ' + err.message);
  }
}

function renderPage(data) {
  document.getElementById('loader').style.display = 'none';
  document.getElementById('diagnosticsContainer').style.display = 'block';

  // Set titles
  document.getElementById('buildTitle').textContent = `Build #${data.buildId} Diagnostics`;
  document.getElementById('buildSubtitle').textContent = `ผลลัพธ์การสแกนความล้มเหลวแบบอัตโนมัติสำหรับ Pipeline`;

  // Set meta values
  document.getElementById('diagFailedStep').textContent = data.failedTask.name || '-';
  document.getElementById('diagErrorKey').textContent = data.diagnostics.errorKey || 'GENERIC';
  document.getElementById('diagTime').textContent = formatDate(data.analyzedAt);

  // Set Title & Description
  const diagnostics = data.diagnostics || {};
  const status = diagnostics.status || (diagnostics.matched === false ? 'unclassified' : 'classified');
  const confidence = diagnostics.confidence || 'low';
  const statusEl = document.getElementById('diagAnalysisStatus');
  statusEl.textContent = `${status} · ${confidence} confidence`;
  statusEl.className = `analysis-status status-${status}`;
  document.getElementById('diagAnalyzerSource').textContent = diagnostics.analyzerSource === 'rule'
    ? 'วิเคราะห์โดย Rule Engine'
    : (diagnostics.analyzerSource || 'Rule Engine');
  document.getElementById('diagTitle').textContent = status === 'unclassified'
    ? 'ยังไม่พบสาเหตุหลัก'
    : (diagnostics.title || 'ไม่ระบุหัวข้อปัญหา');
  document.getElementById('diagDescription').textContent = diagnostics.description || '-';

  renderRootCause(diagnostics);
  renderEvidence(diagnostics.evidence, diagnostics.redactionSummary);
  renderExactError(diagnostics.exactError);
  renderImpactChain(diagnostics.causalChain || diagnostics.impactChain);
  renderWarnings(diagnostics.warnings);
  renderMissingInformation(diagnostics.missingInformation);
  renderWrapperErrors(diagnostics.wrapperErrors);
  renderFailedTasks(data.failedTasks || diagnostics.failedTasks, diagnostics.primaryFailure);

  // Set Snippet with line numbers
  const snippetEl = document.getElementById('rawLogSnippet');
  if (snippetEl) {
    const rawText = diagnostics.snippet || '';
    const startNum = diagnostics.startLineNumber || 1;
    const lines = rawText.split(/\r?\n/);
    snippetEl.innerHTML = '';
    
    lines.forEach((lineText, index) => {
      const lineNum = startNum + index;
      
      const lineDiv = document.createElement('div');
      lineDiv.className = 'ado-log-line';
      
      const numSpan = document.createElement('span');
      numSpan.className = 'ado-line-number';
      numSpan.textContent = lineNum;
      
      const textSpan = document.createElement('span');
      textSpan.className = 'ado-line-text';
      textSpan.textContent = lineText;
      
      lineDiv.appendChild(numSpan);
      lineDiv.appendChild(textSpan);
      snippetEl.appendChild(lineDiv);
    });
  }

  // Render Solutions
  const listEl = document.getElementById('solutionsList');
  listEl.innerHTML = '';
  
  const solutions = diagnostics.solutions || [];
  solutions.forEach((sol, idx) => {
    const item = document.createElement('div');
    item.className = 'solution-item';
    
    const title = document.createElement('h3');
    title.className = 'solution-title';
    title.innerHTML = `💡 ${escapeHtml(sol.title)}`;
    
    const details = document.createElement('div');
    details.className = 'solution-details';
    
    // Parse markdown-like details (convert `code` and ```blocks)
    details.innerHTML = formatMarkdownDetails(sol.details);
    
    item.appendChild(title);
    item.appendChild(details);
    listEl.appendChild(item);
  });

  // Show Teams Button
  document.getElementById('btnSendToTeams').style.display = 'inline-flex';
}

function renderRootCause(diagnostics) {
  const card = document.getElementById('rootCauseCard');
  const summaryEl = document.getElementById('rootCauseSummary');
  if (!card || !summaryEl) return;

  const summary = diagnostics.rootCauseSummary || '';
  if (!summary) {
    card.hidden = true;
    return;
  }

  summaryEl.textContent = summary;
  card.hidden = false;
}

function renderEvidence(evidence, redactionSummary) {
  const card = document.getElementById('evidenceCard');
  const list = document.getElementById('evidenceList');
  const badge = document.getElementById('redactionBadge');
  if (!card || !list || !badge) return;
  list.innerHTML = '';
  const items = Array.isArray(evidence) ? evidence : [];
  if (!items.length) {
    card.hidden = true;
    return;
  }
  items.forEach((item) => list.appendChild(createEvidenceItem(item)));
  const redactedCount = Number(redactionSummary && redactionSummary.total || 0);
  badge.textContent = redactedCount ? `🔒 ปิดบังข้อมูล ${redactedCount} จุด` : '🔒 ผ่านการตรวจข้อมูลสำคัญ';
  badge.hidden = false;
  card.hidden = false;
}

function createEvidenceItem(item) {
  const row = document.createElement('div');
  row.className = `evidence-item evidence-${item.kind || 'error'}`;
  const meta = document.createElement('span');
  meta.className = 'evidence-meta';
  const task = item.taskName || 'Build Log';
  const line = item.lineNumber ? ` · line ${item.lineNumber}` : '';
  meta.textContent = `${task}${line} · ${item.kind || 'error'}`;
  const text = document.createElement('code');
  text.className = 'evidence-text';
  text.textContent = item.text || '-';
  row.appendChild(meta);
  row.appendChild(text);
  return row;
}

function renderExactError(exactError) {
  const card = document.getElementById('exactErrorCard');
  const grid = document.getElementById('exactErrorGrid');
  if (!card || !grid) return;

  grid.innerHTML = '';
  if (!exactError || typeof exactError !== 'object') {
    card.hidden = true;
    return;
  }

  const location = formatExactLocation(exactError);
  const rows = [
    ['File', location],
    ['Command', exactError.command],
    ['Message', exactError.message],
    ['Source', exactError.sourceUrl]
  ].filter((row) => row[1]);

  if (Array.isArray(exactError.packages) && exactError.packages.length) {
    rows.push(['Packages', exactError.packages.map((pkg) => `${pkg.name} ${pkg.version}`).join(' / ')]);
  }

  if (!rows.length) {
    card.hidden = true;
    return;
  }

  rows.forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'exact-error-item';

    const labelEl = document.createElement('span');
    labelEl.className = 'exact-error-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('code');
    valueEl.className = 'exact-error-value';
    valueEl.textContent = value;

    item.appendChild(labelEl);
    item.appendChild(valueEl);
    grid.appendChild(item);
  });

  card.hidden = false;
}

function renderImpactChain(impactChain) {
  const card = document.getElementById('impactChainCard');
  const list = document.getElementById('impactChainList');
  if (!card || !list) return;

  list.innerHTML = '';
  if (!Array.isArray(impactChain) || impactChain.length === 0) {
    card.hidden = true;
    return;
  }

  impactChain.forEach((impact) => {
    const item = document.createElement('li');
    item.textContent = impact;
    list.appendChild(item);
  });

  card.hidden = false;
}

function renderWarnings(warnings) {
  const card = document.getElementById('warningsCard');
  const list = document.getElementById('warningsList');
  if (!card || !list) return;

  list.innerHTML = '';
  if (!Array.isArray(warnings) || warnings.length === 0) {
    card.hidden = true;
    return;
  }

  warnings.forEach((warning) => {
    const pill = document.createElement('span');
    pill.className = 'warning-pill';
    pill.textContent = warning;
    list.appendChild(pill);
  });

  card.hidden = false;
}

function renderMissingInformation(items) {
  const card = document.getElementById('missingInfoCard');
  const list = document.getElementById('missingInfoList');
  if (!card || !list) return;
  list.innerHTML = '';
  const values = Array.isArray(items) ? items : [];
  values.forEach((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    list.appendChild(item);
  });
  card.hidden = values.length === 0;
}

function renderWrapperErrors(items) {
  const card = document.getElementById('wrapperErrorsCard');
  const list = document.getElementById('wrapperErrorsList');
  if (!card || !list) return;
  list.innerHTML = '';
  const values = Array.isArray(items) ? items : [];
  values.forEach((item) => list.appendChild(createEvidenceItem(item)));
  card.hidden = values.length === 0;
}

function renderFailedTasks(tasks, primaryFailure) {
  const card = document.getElementById('failedTasksCard');
  const list = document.getElementById('failedTasksList');
  if (!card || !list) return;
  list.innerHTML = '';
  const values = Array.isArray(tasks) ? tasks : [];
  values.forEach((task) => {
    const item = document.createElement('div');
    const isPrimary = primaryFailure && primaryFailure.taskId === task.id;
    item.className = `failed-task-item${isPrimary ? ' is-primary' : ''}`;
    const name = document.createElement('strong');
    name.textContent = task.name || task.id || 'Unknown task';
    const status = document.createElement('span');
    status.className = `task-log-status task-${task.logStatus || 'unknown'}`;
    status.textContent = isPrimary ? `Primary · ${task.logStatus || 'analyzed'}` : (task.logStatus || 'unknown');
    item.appendChild(name);
    item.appendChild(status);
    list.appendChild(item);
  });
  card.hidden = values.length === 0;
}

function formatExactLocation(exactError) {
  if (!exactError || !exactError.file) return '';
  let location = exactError.file;
  if (exactError.line) {
    location += `:${exactError.line}`;
    if (exactError.column) location += `:${exactError.column}`;
  }
  return location;
}

function formatMarkdownDetails(text) {
  if (!text) return '';
  let escaped = escapeHtml(text);
  
  // Convert ```yaml ... ``` to pre/code
  escaped = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
  });
  
  // Convert `code` to inline code
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Convert newlines to br
  escaped = escaped.replace(/\n/g, '<br/>');
  
  return escaped;
}

function setupEvents() {
  const btnCopy = document.getElementById('btnCopyLog');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const code = (diagnosticData && diagnosticData.diagnostics && diagnosticData.diagnostics.snippet) || '';
      navigator.clipboard.writeText(code)
        .then(() => {
          const originalText = btnCopy.innerHTML;
          btnCopy.innerHTML = '✅ คัดลอกสำเร็จ!';
          setTimeout(() => btnCopy.innerHTML = originalText, 2000);
        })
        .catch(err => {
          alert('ไม่สามารถคัดลอกได้: ' + err.message);
        });
    });
  }

  const btnTeams = document.getElementById('btnSendToTeams');
  if (btnTeams) {
    btnTeams.addEventListener('click', async () => {
      if (!currentBuildId) return;
      btnTeams.disabled = true;
      btnTeams.style.opacity = '0.6';
      btnTeams.style.cursor = 'wait';
      const originalText = btnTeams.innerHTML;
      btnTeams.innerHTML = '<span>⏳</span><span>กำลังส่งเข้า Teams...</span>';

      try {
        const res = await safeFetchJson('/api/build-diagnostics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            buildId: currentBuildId,
            sendToTeams: true
          })
        });

        if (res.ok && res.data && res.data.ok) {
          alert('✅ ส่งแจ้งเตือนการวิเคราะห์ผลลัพธ์เข้า Microsoft Teams สำเร็จ!');
        } else {
          const d = res.data || {};
          alert('❌ ส่งไม่สำเร็จ: ' + (d.error || 'Unknown error'));
        }
      } catch (err) {
        alert('❌ Error: ' + err.message);
      } finally {
        btnTeams.disabled = false;
        btnTeams.style.opacity = '1';
        btnTeams.style.cursor = 'pointer';
        btnTeams.innerHTML = originalText;
      }
    });
  }
}

function showError(msg) {
  document.getElementById('loader').style.display = 'none';
  const box = document.getElementById('errorBox');
  box.hidden = false;
  box.innerHTML = msg;
}
