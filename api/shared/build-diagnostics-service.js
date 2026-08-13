'use strict';

const analyzer = require('./build-diagnostics-analyzer');

function normalizeLogBody(body) {
  if (typeof body === 'string') return body;
  if (body && Array.isArray(body.value)) return body.value.join('\n');
  return JSON.stringify(body || '');
}

function summarizeTask(task, extra) {
  return Object.assign({
    id: task && task.id || '',
    name: task && task.name || '',
    type: task && task.type || '',
    logId: task && task.log && task.log.id || '',
    startTime: task && task.startTime || '',
    finishTime: task && task.finishTime || ''
  }, extra || {});
}

function findFailedTasks(records) {
  const taskRecords = records.filter((record) => record
    && record.type === 'Task'
    && record.state === 'completed'
    && record.result === 'failed'
    && record.log
    && record.log.id);
  if (taskRecords.length) return taskRecords;
  return records.filter((record) => record
    && record.state === 'completed'
    && record.result === 'failed'
    && record.log
    && record.log.id);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async function () {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function attachTask(evidence, task) {
  return Object.assign({}, evidence, {
    taskId: task.id || '',
    taskName: task.name || '',
    logId: task.logId || ''
  });
}

function mergeRedactionSummaries(items) {
  const categories = {};
  let total = 0;
  items.forEach((item) => {
    const summary = item && item.diagnostics && item.diagnostics.redactionSummary;
    if (!summary) return;
    total += Number(summary.total || 0);
    Object.entries(summary.categories || {}).forEach(([key, value]) => {
      categories[key] = (categories[key] || 0) + Number(value || 0);
    });
  });
  return { total: total, categories: categories };
}

function createUnavailableDiagnostics(failedTasks, missingInformation) {
  return {
    matched: false,
    status: 'partial',
    analyzerSource: 'rule',
    confidence: 'low',
    errorKey: 'GENERIC_ERROR',
    failureLayer: 'generic',
    title: 'Build Log Analysis Incomplete (วิเคราะห์ Log ไม่ครบ)',
    description: 'พบ failed task แต่ไม่สามารถดึง Log ที่ใช้ระบุ Root Cause ได้',
    rootCauseSummary: 'ยังไม่พบสาเหตุหลัก เนื่องจากไม่สามารถดึง Log ของ failed task ได้',
    exactError: null,
    primaryFailure: null,
    evidence: [],
    causalChain: [],
    impactChain: [],
    wrapperErrors: [],
    warnings: [],
    missingInformation: missingInformation,
    solutions: [{
      title: 'ตรวจสอบ Build Log ใน Azure DevOps',
      details: 'เปิด Build และตรวจสอบสิทธิ์หรือสถานะการเก็บ Log ของ failed task แล้วลองวิเคราะห์อีกครั้ง'
    }],
    snippet: '',
    startLineNumber: 1,
    failedTasks: failedTasks,
    redactionSummary: { total: 0, categories: {} }
  };
}

function aggregateTaskResults(taskResults) {
  const successful = taskResults.filter((item) => item.diagnostics);
  const unavailable = taskResults.filter((item) => !item.diagnostics);
  const failedTasks = taskResults.map((item) => item.task);
  const missingFromTasks = unavailable.map((item) => `ไม่สามารถดึง Log ของ task "${item.task.name || item.task.id}": ${item.reason}`);

  if (!successful.length) return createUnavailableDiagnostics(failedTasks, missingFromTasks);

  successful.sort((left, right) => analyzer.scoreResult(right.diagnostics) - analyzer.scoreResult(left.diagnostics));
  const primaryItem = successful[0];
  const primary = primaryItem.diagnostics;
  const allEvidence = [];
  const allWrappers = [];
  const allWarnings = [];
  const seenWrapper = new Set();
  const seenWarning = new Set();

  successful.forEach((item) => {
    (item.diagnostics.evidence || []).forEach((entry) => allEvidence.push(attachTask(entry, item.task)));
    (item.diagnostics.wrapperErrors || []).forEach((entry) => {
      const decorated = attachTask(entry, item.task);
      const key = `${decorated.taskId}:${decorated.lineNumber}:${decorated.text}`;
      if (!seenWrapper.has(key)) {
        seenWrapper.add(key);
        allWrappers.push(decorated);
      }
    });
    (item.diagnostics.warnings || []).forEach((warning) => {
      if (!seenWarning.has(warning)) {
        seenWarning.add(warning);
        allWarnings.push(warning);
      }
    });
  });

  const result = Object.assign({}, primary, {
    status: unavailable.length ? 'partial' : primary.status,
    analyzerSource: 'rule',
    primaryFailure: {
      taskId: primaryItem.task.id,
      taskName: primaryItem.task.name,
      logId: primaryItem.task.logId,
      errorKey: primary.errorKey,
      failureLayer: primary.failureLayer,
      title: primary.title,
      rootCauseSummary: primary.rootCauseSummary,
      exactError: primary.exactError || null
    },
    evidence: allEvidence.slice(0, 20),
    causalChain: primary.causalChain || primary.impactChain || [],
    wrapperErrors: allWrappers.slice(0, 20),
    warnings: allWarnings.slice(0, 12),
    missingInformation: (primary.missingInformation || []).concat(missingFromTasks),
    failedTasks: failedTasks,
    redactionSummary: mergeRedactionSummaries(successful)
  });

  if (result.confidence === 'high' && !result.evidence.some((item) => item.kind === 'root-cause')) {
    result.confidence = 'medium';
  }
  return result;
}

async function collectBuildDiagnostics(ado, buildId, options) {
  const timelineResult = await ado.getBuildTimeline(buildId);
  if (!timelineResult.ok) {
    return { ok: false, reason: 'timeline_fetch_failed', status: timelineResult.status };
  }

  const records = timelineResult.body && Array.isArray(timelineResult.body.records)
    ? timelineResult.body.records
    : [];
  const failedTaskRecords = findFailedTasks(records);
  if (!failedTaskRecords.length) return { ok: false, reason: 'failed_task_log_not_found', status: 404 };

  const concurrency = Math.max(1, Number(options && options.concurrency || 3));
  const taskResults = await mapWithConcurrency(failedTaskRecords, concurrency, async function (task) {
    const taskSummary = summarizeTask(task, { logStatus: 'loading' });
    try {
      const logResult = await ado.getBuildLog(buildId, task.log.id);
      if (!logResult.ok) {
        taskSummary.logStatus = 'unavailable';
        taskSummary.logHttpStatus = logResult.status;
        return { task: taskSummary, diagnostics: null, reason: `HTTP ${logResult.status}` };
      }
      taskSummary.logStatus = 'analyzed';
      return {
        task: taskSummary,
        diagnostics: analyzer.analyzeLog(normalizeLogBody(logResult.body)),
        reason: ''
      };
    } catch (error) {
      taskSummary.logStatus = 'unavailable';
      return { task: taskSummary, diagnostics: null, reason: error.message || 'unknown error' };
    }
  });

  const diagnostics = aggregateTaskResults(taskResults);
  return {
    ok: true,
    failedTask: diagnostics.primaryFailure
      ? failedTasksCompat(diagnostics.failedTasks, diagnostics.primaryFailure.taskId)
      : diagnostics.failedTasks[0],
    failedTasks: diagnostics.failedTasks,
    diagnostics: diagnostics
  };
}

function failedTasksCompat(tasks, primaryTaskId) {
  return tasks.find((task) => task.id === primaryTaskId) || tasks[0] || null;
}

module.exports = {
  collectBuildDiagnostics,
  aggregateTaskResults,
  findFailedTasks,
  mapWithConcurrency,
  normalizeLogBody
};
