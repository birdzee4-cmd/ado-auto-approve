const { TableClient } = require('@azure/data-tables');
const model = require('./deployment-model');

const clients = {};
const ready = new Set();

function getConfig() {
  const connectionString = process.env.DEPLOYMENT_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage ||
    process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('Missing DEPLOYMENT_STORAGE_CONNECTION_STRING or AzureWebJobsStorage');
  return {
    connectionString,
    recordsTable: process.env.DEPLOYMENT_RECORDS_TABLE || 'DeploymentRecords',
    masterTable: process.env.DEPLOYMENT_MASTER_TABLE || 'DeploymentProjects',
    auditTable: process.env.DEPLOYMENT_AUDIT_TABLE || 'DeploymentAuditLogs',
    countersTable: process.env.DEPLOYMENT_COUNTERS_TABLE || 'DeploymentCounters'
  };
}

async function clientFor(name) {
  if (!clients[name]) {
    const cfg = getConfig();
    clients[name] = TableClient.fromConnectionString(cfg.connectionString, cfg[name]);
  }
  if (!ready.has(name)) {
    try { await clients[name].createTable(); } catch (e) {
      if (statusOf(e) !== 409) throw e;
    }
    ready.add(name);
  }
  return clients[name];
}

async function createDeployment(input, user, options) {
  const records = await clientFor('recordsTable');
  const entity = model.buildDeploymentEntity(input, { user });
  if (!entity.jobNo) entity.jobNo = await nextJobNo(entity.category, entity.plannedDeployAt);
  const duplicates = await findDuplicates(entity.taskId, entity.labelCode, entity.rowKey);
  const validation = model.validateDeployment(entity, {
    externalWarnings: duplicateWarnings(duplicates),
    allowLegacy: !!(options && options.allowLegacy)
  });
  if (!validation.ok) return { ok: false, status: 400, validation };

  await records.createEntity(entity);
  await writeAudit('CREATE', entity, null, entity, user, options);
  return { ok: true, status: 201, deployment: model.toPublicDeployment(entity), validation, duplicates };
}

async function upsertImportedDeployment(input, user) {
  const existing = input.jobNo ? await findByJobNo(input.jobNo) : null;
  if (existing) return { ok: true, skipped: true, deployment: existing };
  const result = await createDeployment(input, user, { auditAction: 'IMPORT', allowLegacy: true });
  if (result.ok) {
    await syncCounterFromJobNo(input.jobNo);
  }
  return result;
}

async function updateDeployment(id, input, user, etag) {
  const current = await getDeployment(id);
  if (!current) return { ok: false, status: 404, error: 'Deployment not found' };
  if (!etag) return { ok: false, status: 428, error: 'ETag is required' };

  const merged = Object.assign({}, current, input, {
    id,
    jobNo: current.jobNo,
    category: current.category,
    createdAt: current.createdAt,
    createdBy: current.createdBy
  });
  const entity = model.buildDeploymentEntity(merged, { user });
  entity.partitionKey = current.category;
  entity.rowKey = id;
  const duplicates = await findDuplicates(entity.taskId, entity.labelCode, id);
  const validation = model.validateDeployment(entity, { externalWarnings: duplicateWarnings(duplicates) });
  if (!validation.ok) return { ok: false, status: 400, validation };

  try {
    const records = await clientFor('recordsTable');
    await records.updateEntity(entity, 'Replace', { etag });
  } catch (e) {
    if (statusOf(e) === 412) {
      return { ok: false, status: 409, error: 'This deployment was updated by another user. Reload and try again.' };
    }
    throw e;
  }
  await writeAudit('UPDATE', entity, current, entity, user);
  return { ok: true, deployment: model.toPublicDeployment(entity), validation, duplicates };
}

async function getDeployment(id) {
  const records = await clientFor('recordsTable');
  for (const category of model.CATEGORIES) {
    try {
      return model.toPublicDeployment(await records.getEntity(category, id));
    } catch (e) {
      if (statusOf(e) !== 404) throw e;
    }
  }
  return null;
}

async function listDeployments(filters) {
  const records = await clientFor('recordsTable');
  const query = filters || {};
  const clauses = [];
  if (model.CATEGORIES.includes(query.category)) clauses.push(`PartitionKey eq '${escapeOdata(query.category)}'`);
  if (query.lifecycleStatus) clauses.push(`lifecycleStatus eq '${escapeOdata(query.lifecycleStatus)}'`);
  if (query.deployResult) clauses.push(`deployResult eq '${escapeOdata(query.deployResult)}'`);
  if (query.from) clauses.push(`plannedDeployAt ge '${escapeOdata(new Date(query.from).toISOString())}'`);
  if (query.to) {
    const end = new Date(query.to);
    end.setUTCHours(23, 59, 59, 999);
    clauses.push(`plannedDeployAt le '${escapeOdata(end.toISOString())}'`);
  }
  const top = Math.max(1, Math.min(Number(query.top || 200), 1000));
  const items = [];
  for await (const entity of records.listEntities({ queryOptions: { filter: clauses.join(' and ') || undefined } })) {
    const item = model.toPublicDeployment(entity);
    if (!matchesSearch(item, query.search)) continue;
    items.push(item);
    if (items.length >= top) break;
  }
  items.sort((a, b) => String(b.plannedDeployAt).localeCompare(String(a.plannedDeployAt)));
  return items;
}

async function findByJobNo(jobNo) {
  const records = await clientFor('recordsTable');
  const filter = `jobNo eq '${escapeOdata(jobNo)}'`;
  for await (const entity of records.listEntities({ queryOptions: { filter } })) {
    return model.toPublicDeployment(entity);
  }
  return null;
}

async function findDuplicates(taskId, labelCode, excludeId) {
  const records = await clientFor('recordsTable');
  const matches = [];
  const task = model.normalizeText(taskId).toLowerCase();
  const label = model.normalizeText(labelCode).toLowerCase();
  if (!task && !label) return matches;
  for await (const entity of records.listEntities()) {
    if (entity.rowKey === excludeId) continue;
    if ((task && model.normalizeText(entity.taskId).toLowerCase() === task) ||
        (label && model.normalizeText(entity.labelCode).toLowerCase() === label)) {
      matches.push(model.toPublicDeployment(entity));
      if (matches.length >= 10) break;
    }
  }
  return matches;
}

async function nextJobNo(category, plannedDeployAt) {
  const year = new Date(plannedDeployAt || Date.now()).getUTCFullYear();
  const prefix = category === 'mobile' ? 'DeployBZBMB' : 'DeployBZBS';
  const counters = await clientFor('countersTable');
  const partitionKey = String(year);
  const rowKey = category;
  for (let attempt = 0; attempt < 10; attempt++) {
    let current;
    try {
      current = await counters.getEntity(partitionKey, rowKey);
    } catch (e) {
      if (statusOf(e) !== 404) throw e;
      try {
        await counters.createEntity({ partitionKey, rowKey, value: 1, updatedAt: new Date().toISOString() });
        return prefix + year + '000001';
      } catch (createError) {
        if (statusOf(createError) !== 409) throw createError;
        continue;
      }
    }
    const next = Number(current.value || 0) + 1;
    try {
      await counters.updateEntity({
        partitionKey,
        rowKey,
        value: next,
        updatedAt: new Date().toISOString()
      }, 'Merge', { etag: current.etag });
      return prefix + year + String(next).padStart(6, '0');
    } catch (e) {
      if (statusOf(e) !== 412) throw e;
    }
  }
  throw new Error('Unable to allocate a deployment Job No. after concurrent retries');
}

async function syncCounterFromJobNo(jobNo) {
  const match = /^(DeployBZBS|DeployBZBMB)(\d{4})(\d{6})$/.exec(String(jobNo || ''));
  if (!match) return;
  const category = match[1] === 'DeployBZBMB' ? 'mobile' : 'web-service';
  const year = match[2];
  const value = Number(match[3]);
  const counters = await clientFor('countersTable');
  try {
    const current = await counters.getEntity(year, category);
    if (Number(current.value || 0) >= value) return;
    await counters.updateEntity({ partitionKey: year, rowKey: category, value }, 'Merge', { etag: current.etag });
  } catch (e) {
    if (statusOf(e) === 404) {
      try { await counters.createEntity({ partitionKey: year, rowKey: category, value }); } catch (createError) {
        if (statusOf(createError) !== 409) throw createError;
      }
      return;
    }
    if (statusOf(e) !== 412) throw e;
  }
}

async function syncCountersFromJobNos(jobNos) {
  const maxima = new Map();
  (jobNos || []).forEach(jobNo => {
    const match = /^(DeployBZBS|DeployBZBMB)(\d{4})(\d{6})$/.exec(String(jobNo || ''));
    if (!match) return;
    const key = match[1] + match[2];
    const current = maxima.get(key);
    if (!current || Number(match[3]) > Number(current.slice(-6))) maxima.set(key, match[0]);
  });
  for (const jobNo of maxima.values()) {
    await syncCounterFromJobNo(jobNo);
  }
  return maxima.size;
}

async function writeAudit(action, deployment, before, after, user, options) {
  const audit = await clientFor('auditTable');
  const now = new Date().toISOString();
  const entity = {
    partitionKey: model.sanitizeKey(deployment.rowKey || deployment.id),
    rowKey: now.replace(/[-:.TZ]/g, '') + '-' + model.sanitizeKey(Math.random().toString(36).slice(2)),
    action: options && options.auditAction || action,
    jobNo: deployment.jobNo || '',
    user: model.normalizeText(user, 300),
    createdAt: now,
    beforeJson: JSON.stringify(before || {}),
    afterJson: JSON.stringify(model.toPublicDeployment(after) || {})
  };
  await audit.createEntity(entity);
}

async function listAudit(deploymentId, top) {
  const audit = await clientFor('auditTable');
  const items = [];
  const limit = Math.max(1, Math.min(Number(top || 100), 500));
  const filter = deploymentId ? `PartitionKey eq '${escapeOdata(model.sanitizeKey(deploymentId))}'` : undefined;
  for await (const entity of audit.listEntities({ queryOptions: { filter } })) {
    items.push({
      id: entity.rowKey,
      deploymentId: entity.partitionKey,
      action: entity.action,
      jobNo: entity.jobNo,
      user: entity.user,
      createdAt: entity.createdAt,
      before: safeJson(entity.beforeJson),
      after: safeJson(entity.afterJson)
    });
    if (items.length >= limit) break;
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return items;
}

async function listMaster(includeInactive) {
  const master = await clientFor('masterTable');
  const items = [];
  for await (const entity of master.listEntities()) {
    if (!includeInactive && entity.active === false) continue;
    items.push({
      id: entity.rowKey,
      type: entity.partitionKey,
      value: entity.value,
      active: entity.active !== false,
      updatedAt: entity.updatedAt || ''
    });
  }
  items.sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
  return items;
}

async function saveMaster(input, user) {
  const type = model.sanitizeKey(input && input.type);
  const value = model.normalizeText(input && input.value, 500);
  if (!type || type === 'unknown' || !value) throw Object.assign(new Error('Master type and value are required'), { statusCode: 400 });
  const master = await clientFor('masterTable');
  const rowKey = model.sanitizeKey(input.id || value.toLowerCase());
  const entity = {
    partitionKey: type,
    rowKey,
    value,
    active: input.active !== false,
    updatedAt: new Date().toISOString(),
    updatedBy: model.normalizeText(user, 300)
  };
  await master.upsertEntity(entity, 'Merge');
  return { id: rowKey, type, value, active: entity.active };
}

async function seedMaster(type, values, user) {
  let count = 0;
  for (const value of new Set((values || []).map(item => model.normalizeText(item)).filter(Boolean))) {
    await saveMaster({ type, value, active: true }, user);
    count++;
  }
  return count;
}

function duplicateWarnings(duplicates) {
  const warnings = [];
  if ((duplicates || []).some(item => item.taskId)) warnings.push('Task ID already exists. Saving is allowed; review the matching records.');
  if ((duplicates || []).some(item => item.labelCode)) warnings.push('Label Code already exists. Saving is allowed; review the matching records.');
  return warnings;
}

function matchesSearch(item, search) {
  const needle = model.normalizeText(search).toLowerCase();
  if (!needle) return true;
  return ['jobNo', 'taskId', 'project', 'labelCode'].some(key => String(item[key] || '').toLowerCase().includes(needle));
}

function escapeOdata(value) {
  return String(value || '').replace(/'/g, "''");
}

function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch (e) { return {}; }
}

function statusOf(error) {
  return Number(error && (error.statusCode || error.status || error.code));
}

module.exports = {
  getConfig,
  createDeployment,
  upsertImportedDeployment,
  updateDeployment,
  getDeployment,
  listDeployments,
  findDuplicates,
  nextJobNo,
  listAudit,
  listMaster,
  saveMaster,
  seedMaster,
  syncCountersFromJobNos
};
