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
  const roles = getUserRoles(principal).map(role => role.toLowerCase());
  if (target === 'it_support_approve' && roles.includes('admin')) return true;
  return roles.some(role => role === target);
}

function hasAnyRole(principal, requiredRoles) {
  const targets = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  const normalized = targets
    .map(role => String(role || '').trim())
    .filter(Boolean);
  if (normalized.length === 0) return true;
  return normalized.some(role => hasRole(principal, role));
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

function requireAnyRole(context, req, requiredRoles) {
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

  const expectedRoles = (Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles])
    .map(role => String(role || '').trim())
    .filter(Boolean);
  if (!hasAnyRole(principal, expectedRoles)) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Forbidden: missing one of roles ' + expectedRoles.join(', '));
    }
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: 'Forbidden',
        hint: 'Your account does not have one of the required roles: ' + expectedRoles.join(', '),
        requiredRoles: expectedRoles,
        userRoles: getUserRoles(principal)
      }
    };
  }

  return {
    ok: true,
    principal: principal,
    userRoles: getUserRoles(principal),
    requiredRoles: expectedRoles
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
  hasAnyRole,
  requireRole,
  requireAnyRole,
  getUserEmail
};
