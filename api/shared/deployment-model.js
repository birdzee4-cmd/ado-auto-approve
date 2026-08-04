const crypto = require('crypto');

const CATEGORIES = ['web-service', 'mobile'];
const LIFECYCLE_STATUSES = ['Planned', 'In Progress', 'Completed', 'Cancelled'];
const DEPLOY_RESULTS = ['✅ Success', '⚠️ Success with Issue', '🔄 Success with Issue (RB)', '🔄 Rolled Back'];
const ROLLBACK_RESULTS = new Set(['🔄 Success with Issue (RB)', '🔄 Rolled Back']);

function normalizeText(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function normalizeDateTime(value) {
  const text = normalizeText(value, 40);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function validateDeployment(input, options) {
  const source = input || {};
  const category = normalizeText(source.category, 30);
  const lifecycleStatus = normalizeText(source.lifecycleStatus || 'Planned', 30);
  const errors = [];
  const warnings = [];

  if (!CATEGORIES.includes(category)) errors.push('Deployment category is invalid.');
  if (!LIFECYCLE_STATUSES.includes(lifecycleStatus)) errors.push('Lifecycle status is invalid.');
  if (!normalizeDateTime(source.plannedDeployAt)) errors.push('Deployment date is required.');
  ['taskId', 'projectsMainSort', 'projectsSubType', 'deployType', 'project', 'labelCode'].forEach(field => {
    if (!normalizeText(source[field])) errors.push(field + ' is required.');
  });

  if (category === 'web-service') {
    if (!(options && options.allowLegacy) && !['Get', 'Merge - Production'].includes(normalizeText(source.sourceType))) {
      errors.push('Web/Service type must be Get or Merge - Production.');
    }
    if (ROLLBACK_RESULTS.has(normalizeText(source.deployResult))) {
      if (!normalizeText(source.swapBackType)) errors.push('SwapBack type is required for a rollback result.');
      if (!normalizeText(source.swapBackDetails)) errors.push('SwapBack details are required for a rollback result.');
    }
  }

  if (category === 'mobile' && !['Android', 'iOS'].includes(normalizeText(source.platform || source.deployType))) {
    errors.push('Mobile platform must be Android or iOS.');
  }

  const label = normalizeText(source.labelCode).toLowerCase();
  const planned = normalizeDateTime(source.plannedDeployAt);
  if (label && planned) {
    const parts = bangkokDateParts(new Date(planned));
    const stamp = parts.year + parts.month + parts.day;
    if (!label.includes(stamp)) warnings.push('Label Code does not contain the deployment date.');
  }
  const projectToken = normalizeText(source.project).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (label && projectToken.length >= 4 && !label.replace(/[^a-z0-9]/gi, '').includes(projectToken)) {
    warnings.push('Label Code may not match the selected project.');
  }
  if (category === 'mobile' && label && !label.includes(normalizeText(source.platform || source.deployType).toLowerCase())) {
    warnings.push('Label Code may not match the selected mobile platform.');
  }

  (options && options.externalWarnings || []).forEach(item => warnings.push(item));
  return { ok: errors.length === 0, errors, warnings };
}

function buildDeploymentEntity(input, metadata) {
  const now = new Date().toISOString();
  const source = input || {};
  const category = normalizeText(source.category, 30);
  const isMobile = category === 'mobile';
  return {
    partitionKey: category,
    rowKey: normalizeText(source.id, 200) || createId(),
    jobNo: normalizeText(source.jobNo, 80),
    category,
    plannedDeployAt: normalizeDateTime(source.plannedDeployAt),
    actualDeployAt: normalizeDateTime(source.actualDeployAt),
    taskId: normalizeText(source.taskId, 200),
    projectsMainSort: normalizeText(source.projectsMainSort, 500),
    projectsSubType: normalizeText(source.projectsSubType, 200),
    deployType: normalizeText(source.deployType, 200),
    project: normalizeText(source.project, 500),
    sourceType: isMobile ? 'BackupCode' : normalizeText(source.sourceType, 50),
    platform: isMobile ? normalizeText(source.platform || source.deployType, 30) : '',
    labelCode: normalizeText(source.labelCode, 1500),
    lifecycleStatus: normalizeText(source.lifecycleStatus || 'Planned', 30),
    durationDeploy: isMobile ? '' : normalizeText(source.durationDeploy, 100),
    deployResult: isMobile ? '' : normalizeText(source.deployResult, 100),
    documentStatus: normalizeText(source.documentStatus || (isMobile ? 'Done' : ''), 100),
    remark: normalizeText(source.remark, 4000),
    swapBackType: isMobile ? '' : normalizeText(source.swapBackType, 200),
    swapBackDetails: isMobile ? '' : normalizeText(source.swapBackDetails, 4000),
    swapBackAt: isMobile ? '' : normalizeDateTime(source.swapBackAt),
    sourceFile: normalizeText(source.sourceFile, 300),
    sourceSheet: normalizeText(source.sourceSheet, 100),
    sourceRow: Number(source.sourceRow || 0),
    createdAt: normalizeDateTime(source.createdAt) || now,
    createdBy: normalizeText(source.createdBy || metadata && metadata.user, 300),
    updatedAt: now,
    updatedBy: normalizeText(metadata && metadata.user, 300)
  };
}

function toPublicDeployment(entity) {
  if (!entity) return null;
  const result = Object.assign({}, entity, {
    id: entity.rowKey,
    etag: entity.etag || ''
  });
  delete result.partitionKey;
  delete result.rowKey;
  delete result['odata.metadata'];
  return result;
}

function bangkokDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  return parts.reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function sanitizeKey(value) {
  return normalizeText(value, 512).replace(/[\\/#?\u0000-\u001f\u007f-\u009f]/g, '_') || 'unknown';
}

function isRollbackResult(value) {
  return ROLLBACK_RESULTS.has(normalizeText(value));
}

module.exports = {
  CATEGORIES,
  LIFECYCLE_STATUSES,
  DEPLOY_RESULTS,
  normalizeText,
  normalizeDateTime,
  validateDeployment,
  buildDeploymentEntity,
  toPublicDeployment,
  sanitizeKey,
  isRollbackResult
};
