/**
 * GET /api/userinfo
 *
 * คืนค่าข้อมูลของ user ที่ login อยู่
 * Azure Static Web Apps จะส่ง header 'x-ms-client-principal' มาให้
 * เป็น base64-encoded JSON ของข้อมูล user (ชื่อ, email, role, etc.)
 */
module.exports = async function (context, req) {
  const headers = req.headers || {};
  const header = headers['x-ms-client-principal'] || headers['X-MS-CLIENT-PRINCIPAL'];

  // ถ้าไม่มี header แสดงว่าไม่ได้ login
  if (!header) {
    context.res = {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Not authenticated' }
    };
    return;
  }

  try {
    // Decode ข้อมูล user จาก header
    const encoded = Buffer.from(header, 'base64');
    const decoded = encoded.toString('utf-8');
    const principal = JSON.parse(decoded);

    // ดึงข้อมูลจาก claims (สำหรับ Microsoft Entra ID)
    const claims = principal.claims || [];
    const getValue = (type) => {
      const c = claims.find(x => x.typ === type || x.type === type);
      return c ? (c.val || c.value) : null;
    };

    const name = getValue('name') ||
                 getValue('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name') ||
                 principal.userDetails;

    const email = getValue('email') ||
                  getValue('preferred_username') ||
                  getValue('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress') ||
                  principal.userDetails;

    const oid = getValue('http://schemas.microsoft.com/identity/claims/objectidentifier') ||
                principal.userId;

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        name: name,
        email: email,
        userId: oid,
        identityProvider: principal.identityProvider,
        userRoles: principal.userRoles || []
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
