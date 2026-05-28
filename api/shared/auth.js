function parseClientPrincipal(headers) {
  const source = headers || {};
  const header = source['x-ms-client-principal'] || source['X-MS-CLIENT-PRINCIPAL'];
  if (!header) return null;

  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
  } catch (e) {
    return null;
  }
}

function getUserRoles(principal) {
  const roles = principal && Array.isArray(principal.userRoles)
    ? principal.userRoles
    : [];
  return roles.map(role => String(role || '').trim()).filter(Boolean);
}

function getRequiredApproverRole() {
  return process.env.AUTH_REQUIRED_ROLE || 'it_support_approve';
}

function hasRole(principal, requiredRole) {
  const target = String(requiredRole || '').trim().toLowerCase();
  if (!target) return true;
  return getUserRoles(principal).some(role => role.toLowerCase() === target);
}

function requireRole(context, req, requiredRole) {
  const principal = parseClientPrincipal(req.headers);
  if (!principal) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        error: 'Authentication required'
      }
    };
  }

  const expectedRole = requiredRole || getRequiredApproverRole();
  if (!hasRole(principal, expectedRole)) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Forbidden: missing role ' + expectedRole);
    }
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: 'Forbidden',
        hint: 'Your account does not have the required role: ' + expectedRole,
        requiredRole: expectedRole,
        userRoles: getUserRoles(principal)
      }
    };
  }

  return {
    ok: true,
    principal: principal,
    userRoles: getUserRoles(principal),
    requiredRole: expectedRole
  };
}

function getUserEmail(principal) {
  return (principal && principal.userDetails) || 'Unknown User';
}

module.exports = {
  parseClientPrincipal,
  getUserRoles,
  getRequiredApproverRole,
  hasRole,
  requireRole,
  getUserEmail
};
