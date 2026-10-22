// Offline-testable, unregistered read repository. No driver import or connection.
// execute({text, parameters, timeoutMs}) must use bound parameters, never substitution.
// DateTime values use UTC components as SQL wall-clock carriers: a future mssql
// executor MUST use options.useUTC=true. Returned dates are SQL wall-clock strings.
const { validateFilters, validateId } = require('./deployment-monitoring-validation');
const { codeLabel, mappingVersion, statusLabels } = require('./deployment-monitoring-provisional');

const source = 'Internal_ProjectPlanning';
const fields = Object.freeze(['ID', 'ProjectName', 'Owner', 'Status', 'IsPrepared',
  'Priority', 'DeployType', 'GetType', 'VersionNumber', 'TargetDate',
  'CompletedDate', 'LastModifiedDate']);
const dates = new Set(['TargetDate', 'CompletedDate', 'LastModifiedDate']);
const projection = fields.map(f => dates.has(f)
  ? `CONVERT(varchar(23), [${f}], 126) AS [${f}]` : `[${f}]`).join(', ');
function unavailable() { const e = new Error('Deployment monitoring is unavailable'); e.code = 'MONITORING_UNAVAILABLE'; return e; }
function parameter(name, type, value, length) { return { name, type, value, ...(length ? { length } : {}) }; }
function escapeLike(text) { return text.replace(/[~%_\[]/g, c => `~${c}`); }

function boundaries(filters, storageTimezone) {
  if (!['Asia/Bangkok', 'UTC'].includes(storageTimezone)) throw unavailable();
  const shift = storageTimezone === 'UTC' ? 7 * 3600000 : 0;
  const from = new Date(Date.parse(`${filters.from}T00:00:00Z`) - shift);
  const toExclusive = new Date(Date.parse(`${filters.toExclusiveDay}T00:00:00Z`) - shift);
  if (from.toISOString().slice(0, 10) < '1753-01-01') throw new (require('./deployment-monitoring-validation').ValidationError)();
  return { from, toExclusive };
}

function where(filters, storageTimezone) {
  const range = boundaries(filters, storageTimezone);
  const clauses = ['[TargetDate] >= @from', '[TargetDate] < @toExclusive'];
  const parameters = [parameter('from', 'DateTime', range.from), parameter('toExclusive', 'DateTime', range.toExclusive)];
  if (filters.project) {
    clauses.push('[ProjectName] = @project');
    parameters.push(parameter('project', 'NVarChar', filters.project, 100));
  }
  if (filters.q) {
    clauses.push("[ProjectName] LIKE @search ESCAPE N'~'");
    parameters.push(parameter('search', 'NVarChar', `%${escapeLike(filters.q)}%`, 202));
  }
  if (filters.status === 'unknown') {
    // Provisional UI maps every negative code to Terminate. Null stays separate.
    const names = Object.keys(statusLabels).map((code, i) => {
      parameters.push(parameter(`known${i}`, 'Int', Number(code))); return `@known${i}`;
    });
    clauses.push(`([Status] IS NULL OR ([Status] >= 0 AND [Status] NOT IN (${names.join(', ')})))`);
  } else if (filters.status !== null) {
    clauses.push('[Status] = @status'); parameters.push(parameter('status', 'Int', filters.status));
  }
  return { text: clauses.join(' AND '), parameters };
}

function projectRow(row, storageTimezone) {
  const item = {};
  for (const field of fields) {
    const value = row[field] === undefined ? null : row[field];
    if (dates.has(field) && value !== null &&
        (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value))) throw unavailable();
    // No browser/host timezone inference and no misleading Z on local datetime.
    item[field] = dates.has(field) && value !== null ? `${value}${storageTimezone === 'UTC' ? 'Z' : '+07:00'}` : value;
  }
  item.status = codeLabel('Status', item.Status);
  item.deployType = codeLabel('DeployType', item.DeployType);
  item.getType = codeLabel('GetType', item.GetType);
  item.priority = codeLabel('Priority', item.Priority);
  return item;
}

function createRepository({ execute, authorizeSource, developmentEnabled = false,
  storageTimezone, now = () => new Date() } = {}) {
  async function run(text, parameters) {
    // Called only behind HTTP role authorization; source approval checked again
    // before each query. Read intent alone is never permission enforcement.
    try {
      if (developmentEnabled !== true || typeof execute !== 'function' ||
          typeof authorizeSource !== 'function' || await authorizeSource() !== true ||
          !['UTC', 'Asia/Bangkok'].includes(storageTimezone)) throw unavailable();
      const rows = await execute({ text, parameters, timeoutMs: 10000 });
      if (!Array.isArray(rows)) throw unavailable();
      return rows;
    } catch (error) {
      const safe = unavailable();
      if (error && ['ETIMEOUT', 'MONITORING_TIMEOUT'].includes(error.code)) safe.code = 'MONITORING_TIMEOUT';
      throw safe;
    }
  }
  function envelope(filters) {
    return { source, fetchedAt: now().toISOString(), mappingVersion,
      assumptions: { provisional: true, storageTimezone, timezoneConfirmed: false, fieldAllowlistApproved: false },
      ...(filters ? { range: { from: filters.from, to: filters.to, timezone: 'Asia/Bangkok' } } : {}) };
  }
  return {
    // Raw validated-query interface, intentionally not wired to createHandlers.
    // Cursor support is still pending; an incomplete page is marked explicitly.
    async list(query = {}) {
      const filters = validateFilters(query, now()); const predicate = where(filters, storageTimezone);
      const rows = await run(`SELECT TOP (@take) ${projection} FROM dbo.Internal_ProjectPlanning WHERE ${predicate.text} ORDER BY [TargetDate] DESC, [ID] DESC`,
        [...predicate.parameters, parameter('take', 'Int', filters.pageSize + 1)]);
      return { ...envelope(filters), items: rows.slice(0, filters.pageSize).map(r => projectRow(r, storageTimezone)),
        page: { pageSize: filters.pageSize, hasMore: rows.length > filters.pageSize, paginationAvailable: false } };
    },
    async detail(id) {
      const key = validateId(id);
      const rows = await run(`SELECT ${projection} FROM dbo.Internal_ProjectPlanning WHERE [ID] = @id`, [parameter('id', 'Int', key)]);
      if (rows.length > 1) throw unavailable();
      return rows.length ? { ...envelope(), item: projectRow(rows[0], storageTimezone) } : null;
    },
    async summary(query = {}) {
      const filters = validateFilters(query, now()); const predicate = where(filters, storageTimezone);
      const rows = await run(`SELECT [Status], [IsPrepared], COUNT_BIG(*) AS [recordCount] FROM dbo.Internal_ProjectPlanning WHERE ${predicate.text} GROUP BY [Status], [IsPrepared]`, predicate.parameters);
      let total = 0; let prepared = 0; let unknown = 0;
      const counts = rows.map(row => {
        const count = Number(row.recordCount);
        if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(total + count)) throw unavailable();
        const status = codeLabel('Status', row.Status);
        total += count; if (row.IsPrepared === true || row.IsPrepared === 1) prepared += count;
        if (row.Status === null || (row.Status >= 0 && !Object.hasOwn(statusLabels, row.Status))) unknown += count;
        return { status, isPrepared: row.IsPrepared, count };
      });
      return { ...envelope(filters), total, prepared, unknown, counts, successRate: null, overdue: null };
    }
  };
}
module.exports = { createRepository, boundaries, escapeLike };
