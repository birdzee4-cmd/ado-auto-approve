/**
 * GET /api/userinfo
 *
 * คืนค่าข้อมูลของ user ที่ login อยู่
 * Azure Static Web Apps จะส่ง header 'x-ms-client-principal' มาให้
 * เป็น base64-encoded JSON ของข้อมูล user (ชื่อ, email, role, etc.)
 */
module.exports = async function (context, req) {
  const auth = require('../shared/auth');
  const principal = auth.parseClientPrincipal(req.headers);

  // ถ้าไม่มี header แสดงว่าไม่ได้ login
  if (!principal) {
    context.res = {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Not authenticated' }
    };
    return;
  }

  try {
    // ดึงข้อมูลจาก claims (สำหรับ Microsoft Entra ID)
    const claims = principal.claims || [];
    const getValue = (type) => {
      const c = claims.find(x => x.typ === type || x.type === type);
      return c ? (c.val || c.value) : null;
    };

    const email = getValue('email') ||
                  getValue('preferred_username') ||
                  getValue('upn') ||
                  getValue('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress') ||
                  getValue('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn') ||
                  principal.userDetails;
    const givenName = getValue('given_name') ||
                      getValue('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname');
    const surname = getValue('family_name') ||
                    getValue('surname') ||
                    getValue('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname');
    const claimName = getValue('name') ||
                      getValue('display_name') ||
                      getValue('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name') ||
                      [givenName, surname].filter(Boolean).join(' ');
    const derivedName = buildDisplayNameFromEmail(email);
    let name = claimName || derivedName || principal.userDetails;
    let profileSource = claimName
      ? 'auth-claim'
      : derivedName
      ? 'email-derived'
      : 'email-fallback';
    if (process.env.GRAPH_USER_PROFILE_LOOKUP === 'true') {
      try {
        const profile = await require('../shared/user-profile').getUserProfile(email);
        if (profile && profile.displayName) {
          name = profile.displayName;
          profileSource = 'microsoft-graph';
        }
      } catch (e) {
        context.log.warn('User profile lookup skipped: ' + e.message);
      }
    }

    const oid = getValue('http://schemas.microsoft.com/identity/claims/objectidentifier') ||
                principal.userId;
    const userRoles = auth.getUserRoles(principal);
    const requiredRole = auth.getRequiredApproverRole();

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        name: name,
        email: email,
        profileSource: profileSource,
        userId: oid,
        identityProvider: principal.identityProvider,
        userRoles: userRoles,
        requiredRole: requiredRole,
        permissions: {
          canApprovePrs: auth.hasRole(principal, requiredRole)
        }
      }
    };
  } catch (err) {
    context.log.error('Failed to parse principal:', err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to parse user info', detail: err.message }
    };
  }
};

function buildDisplayNameFromEmail(email) {
  const localPart = String(email || '').split('@')[0].trim();
  if (!localPart) return '';
  const words = localPart
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  return words.join(' ');
}
