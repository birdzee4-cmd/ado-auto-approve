// One explicitly approved, bounded SELECT-only UAT run. Defaults to plan-only.
// No DBeaver secure-store reads, token files, raw rows, or SQL error output.
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');
const { createExecutor } = require('../../api/shared/deployment-monitoring-executor');
const { createRepository } = require('../../api/shared/deployment-monitoring-sql');
const { createService } = require('../../api/shared/deployment-monitoring-service');
const { validateFilters } = require('../../api/shared/deployment-monitoring-validation');
const apiRequire = createRequire(require.resolve('../../api/package.json'));

function parseArgs(args) {
  const values = {}; const approved = new Set(['--connect-approved', '--read-approved']);
  const names = new Set(['--server', '--database', '--day', '--storage-timezone', '--client-id', '--tenant-id']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (Object.hasOwn(values, key)) throw new Error('Invalid options');
    if (approved.has(key)) values[key] = true;
    else if (names.has(key) && typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--')) values[key] = args[++i];
    else throw new Error('Invalid options');
  }
  const connectApproved = values['--connect-approved'] === true;
  const readApproved = values['--read-approved'] === true;
  if (connectApproved !== readApproved) throw new Error('Both approvals required');
  const storageTimezone = values['--storage-timezone'];
  const day = values['--day'];
  if (day !== undefined) validateFilters({ from: day, to: day });
  if (storageTimezone !== undefined && !['UTC', 'Asia/Bangkok'].includes(storageTimezone)) throw new Error('Invalid timezone');
  if (connectApproved && (!day || !storageTimezone ||
      !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(values['--server'] || '') ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(values['--database'] || '') ||
      !/^[a-fA-F0-9-]{36}$/.test(values['--client-id'] || '') ||
      !/^[a-zA-Z0-9.-]+$/.test(values['--tenant-id'] || ''))) throw new Error('Explicit UAT configuration required');
  return { connectApproved, readApproved, day, storageTimezone,
    server: values['--server'], database: values['--database'],
    clientId: values['--client-id'], tenantId: values['--tenant-id'] };
}

async function getInteractiveToken(config, emit) {
  // SDK's documented interactive browser flow; same explicit public application
  // as operator-approved JDBC flow, no client secret or persistent token cache.
  const { InteractiveBrowserCredential } = apiRequire('@azure/identity');
  const credential = new InteractiveBrowserCredential({
    clientId: config.clientId, tenantId: config.tenantId,
    tokenCachePersistenceOptions: { enabled: false },
    loggingOptions: { allowLoggingAccountIdentifiers: false }
  });
  emit({ stage: 'SIGN_IN_REQUIRED', timeoutSeconds: 240 });
  let timer;
  try {
    const token = await Promise.race([
      credential.getToken('https://database.windows.net/.default'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), 240000); })
    ]);
    if (!token || typeof token.token !== 'string' || !token.token) throw new Error();
    emit({ stage: 'SIGN_IN_COMPLETE' });
    return token.token;
  } catch { throw Object.assign(new Error('Authentication did not complete'), { code: 'AUTH_FAILED' }); }
  finally { clearTimeout(timer); }
}

async function runUat(config, { emit = () => {}, getToken = getInteractiveToken,
  executorFactory = createExecutor, now = () => new Date() } = {}) {
  if (config.connectApproved !== true || config.readApproved !== true) {
    return { mode: 'plan-only', connected: false, sourceRead: false,
      scope: ['permissions', 'list TOP 2 (pageSize 1 plus lookahead)', 'detail for one returned ID', 'single-day status/readiness counts'] };
  }
  // Re-validate typed config before any authentication/network operation.
  parseArgs(['--connect-approved', '--read-approved', '--server', config.server,
    '--database', config.database, '--client-id', config.clientId, '--tenant-id', config.tenantId,
    '--day', config.day, '--storage-timezone', config.storageTimezone]);
  let executor;
  try {
    const token = await getToken(config, emit);
    executor = executorFactory({ enabled: () => true, authorizeConnection: async () => true,
      onDiagnostic: diagnostic => emit(diagnostic),
      getConfig: async () => ({ server: config.server, database: config.database,
        authentication: { type: 'azure-active-directory-access-token', options: { token } } }) });
    const repository = createRepository({ execute: query => executor.execute(query),
      authorizeSource: async () => true, developmentEnabled: true, storageTimezone: config.storageTimezone, now });
    const service = createService({ repository, cursorSecret: randomBytes(32).toString('hex'),
      storageTimezone: config.storageTimezone, now });
    const filters = validateFilters({ from: config.day, to: config.day, pageSize: '1' }, now());
    emit({ stage: 'LIST_AND_PERMISSION_CHECK_STARTED' });
    const list = await service.list(filters);
    emit({ stage: 'LIST_COMPLETE', returnedRows: list.items.length });
    let detail = 'not-tested-empty-list';
    if (list.items.length) {
      const found = await service.detail(list.items[0].ID);
      detail = found && found.item.ID === list.items[0].ID ? 'matched-id' : 'changed-or-missing';
      emit({ stage: 'DETAIL_COMPLETE', result: detail });
    }
    const summary = await service.summary(filters);
    return { mode: 'approved-uat-read', completed: true, permissionGatePassed: true,
      returnedRows: list.items.length, hasMore: list.page.hasMore, cursorGenerated: list.page.nextCursor !== null,
      detail, summary: { total: summary.total, prepared: summary.prepared, unknown: summary.unknown,
        rawStatusGroups: summary.counts.length },
      storageTimezoneAssumption: config.storageTimezone, timezoneConfirmed: false,
      mappingProvisional: true, releaseApproved: false };
  } finally { if (executor) await executor.close(); }
}

if (require.main === module) {
  // This is a dedicated short-lived CLI. Do not enable SDK/debug diagnostics:
  // they can contain auth URLs or identity details. Do not print exceptions.
  delete process.env.AZURE_LOG_LEVEL;
  delete process.env.DEBUG;
  const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  const finish = (value, code) => process.stdout.write(`${JSON.stringify(value)}\n`, () => process.exit(code));
  Promise.resolve().then(() => parseArgs(process.argv.slice(2))).then(config => runUat(config, { emit }))
    .then(result => finish(result, 0))
    .catch(error => {
      // Also ends an unfinished interactive loopback listener after auth timeout.
      finish({ completed: false, code: ['AUTH_FAILED', 'MONITORING_TIMEOUT', 'MONITORING_UNAVAILABLE', 'INVALID_QUERY'].includes(error?.code)
        ? error.code : 'UAT_CHECK_FAILED', automaticRetry: false }, 1);
    });
}
module.exports = { parseArgs, runUat };
