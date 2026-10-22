// No connection at import/construction time. Share ONE instance per API worker.
// Only compose behind HTTP role checks and explicit approved-UAT connection gate.
const permissionsSql = `SELECT
  CASE WHEN DB_NAME() = @expectedDatabase THEN 1 ELSE 0 END AS expectedDatabase,
  HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'SELECT') AS canSelect,
  HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'INSERT') AS canInsert,
  HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'UPDATE') AS canUpdate,
  HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'DELETE') AS canDelete,
  HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'ALTER') AS canAlter,
  HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'CONTROL') AS objectControl,
  HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CONTROL') AS databaseControl,
  IS_ROLEMEMBER(N'db_owner') AS isOwner,
  IS_ROLEMEMBER(N'db_datawriter') AS isWriter,
  IS_SRVROLEMEMBER(N'sysadmin') AS isAdmin`;
function safeError(error) {
  return Object.assign(new Error('Deployment monitoring is unavailable'), {
    code: error && ['ETIMEOUT', 'MONITORING_TIMEOUT'].includes(error.code)
      ? 'MONITORING_TIMEOUT' : 'MONITORING_UNAVAILABLE'
  });
}
function createExecutor({ getConfig, authorizeConnection, enabled = () => false,
  loadDriver = () => require('mssql'), onDiagnostic } = {}) {
  let current = null;
  let disposed = false;
  function diagnostic(stage, error) {
    // Fixed stage names and code allowlist only. Never serialize an exception,
    // message, config, SQL, identity, token or row into diagnostics.
    const allowed = new Set(['ELOGIN', 'ETIMEOUT', 'ESOCKET', 'EREQUEST', 'ENOTOPEN',
      'ECONNCLOSED', 'ECANCEL', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EACCES',
      'ECONNREFUSED', 'EHOSTUNREACH', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
    const codes = []; const seen = new Set(); let cause = error;
    const sql = {};
    for (let depth = 0; cause && depth < 5 && !seen.has(cause); depth++) {
      seen.add(cause);
      if (allowed.has(cause.code) && !codes.includes(cause.code)) codes.push(cause.code);
      if (Number.isInteger(cause.number) && [20, 64, 233, 4060, 4014, 18456, 10928, 10929].includes(cause.number)) sql.number = cause.number;
      if (Number.isInteger(cause.state) && cause.state >= 0 && cause.state <= 255) sql.state = cause.state;
      if (Number.isInteger(cause.class) && cause.class >= 0 && cause.class <= 255) sql.class = cause.class;
      cause = cause.originalError || cause.cause;
    }
    try { onDiagnostic?.({ stage, ...(error ? { codes: codes.length ? codes : ['UNCLASSIFIED'], ...(Object.keys(sql).length ? { sql } : {}) } : {}) }); }
    catch { /* diagnostic failure must not change authorization/query behavior */ }
  }
  async function discard(state) {
    if (current === state) current = null;
    if (!state.closePromise) {
      state.closing = true;
      state.closePromise = (async () => {
        // node-mssql rejects close() while connecting; wait for that promise,
        // not ready (which can itself be waiting for this cleanup).
        try { await state.connection; } catch { /* still close failed pool */ }
        try { await state.pool.close(); } catch { /* no raw errors/logs */ }
      })();
    }
    await state.closePromise;
  }
  async function gate() {
    if (disposed || enabled() !== true || typeof authorizeConnection !== 'function' ||
        await authorizeConnection() !== true) throw safeError();
  }
  async function acquire() {
    await gate();
    if (current) return current.ready;
    const supplied = await getConfig();
    // Provider is trusted server-side configuration, never caller query/header.
    // Do not permit caller-provided TLS/timeout/pool overrides.
    if (!supplied || (supplied.authMode !== undefined && supplied.authMode !== 'sql' && supplied.authMode !== 'entra') ||
        (supplied.authMode === 'sql' && (supplied.authentication || !supplied.user || !supplied.password)) ||
        (supplied.authMode === 'entra' && (!supplied.authentication || supplied.user || supplied.password)) ||
        typeof supplied.server !== 'string' || !supplied.server ||
        typeof supplied.database !== 'string' || !supplied.database || supplied.database.length > 128 ||
        (supplied.port !== undefined && (!Number.isInteger(supplied.port) || supplied.port < 1 || supplied.port > 65535)) ||
        (!supplied.authentication && !(supplied.user && supplied.password))) throw safeError();
    // Config provider can yield while another request creates the shared pool.
    await gate();
    if (current) return current.ready;
    const driver = loadDriver();
    const config = { server: supplied.server, database: supplied.database, port: supplied.port || 1433,
      ...(supplied.authentication ? { authentication: supplied.authentication } : { user: supplied.user, password: supplied.password }),
      connectionTimeout: 5000, requestTimeout: 10000,
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000, acquireTimeoutMillis: 5000 },
      options: { encrypt: true, trustServerCertificate: false, useUTC: true,
        readOnlyIntent: true, appName: 'DeploymentMonitoringReadOnly' } };
    const state = { driver, pool: new driver.ConnectionPool(config), ready: null, closing: false };
    current = state;
    state.pool.on('error', () => { void discard(state); });
    state.connection = Promise.resolve().then(() => state.pool.connect());
    state.ready = (async () => {
      let phase = 'CONNECT';
      try {
        await state.connection;
        diagnostic('CONNECT_COMPLETE');
        if (state.closing || disposed) throw safeError();
        phase = 'PERMISSION_QUERY';
        const request = new driver.Request(state.pool, { requestTimeout: 10000 });
        request.input('expectedDatabase', driver.NVarChar(128), config.database);
        const result = await request.query(permissionsSql);
        phase = 'PERMISSION_CHECK';
        const row = result.recordset && result.recordset[0];
        if (state.closing || disposed || !row || result.recordset.length !== 1 ||
            row.expectedDatabase !== 1 || row.canSelect !== 1 ||
            ['canInsert', 'canUpdate', 'canDelete', 'canAlter', 'objectControl',
              'databaseControl', 'isOwner', 'isWriter', 'isAdmin'].some(key => row[key] !== 0)) throw safeError();
        diagnostic('PERMISSION_CHECK_COMPLETE');
        return state;
      } catch (error) { diagnostic(`${phase}_FAILED`, error); await discard(state); throw safeError(error); }
    })();
    return state.ready;
  }
  function typeOf(driver, p) {
    if (!p || !/^[A-Za-z][A-Za-z0-9]*$/.test(p.name)) throw safeError();
    if (p.type === 'Int' && Number.isInteger(p.value) && p.value >= -2147483648 && p.value <= 2147483647) return driver.Int;
    if (p.type === 'DateTime' && p.value instanceof Date && Number.isFinite(p.value.getTime())) return driver.DateTime;
    if (p.type === 'NVarChar' && Number.isInteger(p.length) && p.length > 0 && p.length <= 4000 &&
        typeof p.value === 'string' && p.value.length <= p.length) return driver.NVarChar(p.length);
    throw safeError();
  }
  return {
    async execute({ text, parameters, timeoutMs = 10000, signal } = {}) {
      let timer; let onAbort; let request;
      let phase = 'PREPARE';
      try {
        // Query text is internal repository code, never caller input. SELECT
        // prefix is a guard against accidental misuse, not a SQL parser/security boundary.
        if (typeof text !== 'string' || !/^SELECT\s/i.test(text) || !Array.isArray(parameters) ||
            !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 || signal?.aborted) throw safeError();
        const state = await acquire();
        if (signal?.aborted || state.closing || disposed) throw safeError();
        const bindings = parameters.map(p => [p.name, typeOf(state.driver, p), p.value]);
        if (new Set(bindings.map(p => p[0])).size !== bindings.length) throw safeError();
        request = new state.driver.Request(state.pool, { requestTimeout: timeoutMs });
        for (const [name, type, value] of bindings) request.input(name, type, value);
        phase = 'DATA_QUERY';
        const result = await new Promise((resolve, reject) => {
          const cancel = code => {
            try { request.cancel(); } catch { /* preserve safe classification */ }
            reject(safeError({ code }));
          };
          onAbort = () => cancel('ECANCEL');
          signal?.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(() => cancel('ETIMEOUT'), timeoutMs);
          Promise.resolve(request.query(text)).then(resolve, reject);
        });
        if (!result || !Array.isArray(result.recordset)) throw safeError();
        diagnostic('DATA_QUERY_COMPLETE');
        return result.recordset;
      } catch (error) { if (phase === 'DATA_QUERY') diagnostic('DATA_QUERY_FAILED', error); throw safeError(error); }
      finally { clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); }
    },
    async close() { disposed = true; if (current) await discard(current); }
  };
}
module.exports = { createExecutor };
