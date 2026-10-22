// Unregistered handler factory for contract/security tests. No SQL adapter or
// function.json imports this module. A trusted SWA gateway is a prerequisite:
// decoding x-ms-client-principal alone does not authenticate a direct host.
const { randomUUID } = require('node:crypto');
const auth = require('./auth');
const { ValidationError, validateFilters, validateId } = require('./deployment-monitoring-validation');

const errors = Object.freeze({
  AUTH_REQUIRED: [401, 'Authentication required'],
  FORBIDDEN: [403, 'Access denied'],
  METHOD_NOT_ALLOWED: [405, 'Only GET is supported'],
  INVALID_QUERY: [400, 'Invalid monitoring query'],
  MONITORING_DISABLED: [503, 'Deployment monitoring is not enabled'],
  MONITORING_UNAVAILABLE: [503, 'Deployment monitoring is unavailable'],
  MONITORING_TIMEOUT: [504, 'Deployment monitoring timed out'],
  NOT_FOUND: [404, 'Deployment not found'],
  INTERNAL_ERROR: [500, 'Deployment monitoring failed']
});

function createHandlers({ service, enabled = () => false, now = () => new Date() } = {}) {
  function handler(operation) {
    return async function monitoringHandler(context, req) {
      const requestId = randomUUID();
      function reply(status, body, headers = {}) {
        context.res = {
          status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-store',
            'X-Request-ID': requestId,
            ...headers
          },
          body: JSON.stringify(body)
        };
      }
      function fail(code) {
        const [status, message] = errors[code];
        reply(status, { ok: false, error: { code, message }, requestId },
          status === 405 ? { Allow: 'GET' } : {});
      }
      try {
        // No feature settings or service access before authorization.
        const authorized = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
        if (!authorized.ok) return fail(authorized.status === 401 ? 'AUTH_REQUIRED' : 'FORBIDDEN');
        if (req.method !== 'GET') return fail('METHOD_NOT_ALLOWED');
        if (enabled() !== true) return fail('MONITORING_DISABLED');
        let input;
        if (operation === 'detail') {
          if (Object.keys(req.query || {}).length) throw new ValidationError();
          input = validateId(req.params && req.params.id);
        } else {
          input = validateFilters(req.query, now());
        }
        if (!service || typeof service[operation] !== 'function') return fail('MONITORING_UNAVAILABLE');
        // The future service must return approved DTOs, never raw SQL records.
        const result = await service[operation](input);
        if (operation === 'detail' && result === null) return fail('NOT_FOUND');
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
        reply(200, { ...result, ok: true, requestId });
      } catch (error) {
        // Only known classifications may cross this boundary. Never log the
        // exception, SQL text, query values, user identity or connection config.
        const code = error instanceof ValidationError ? 'INVALID_QUERY'
          : error && error.code === 'MONITORING_TIMEOUT' ? 'MONITORING_TIMEOUT'
          : error && error.code === 'MONITORING_UNAVAILABLE' ? 'MONITORING_UNAVAILABLE'
          : 'INTERNAL_ERROR';
        fail(code);
      }
    };
  }
  return { list: handler('list'), detail: handler('detail'), summary: handler('summary') };
}

module.exports = { createHandlers };
