const auth = require('../shared/auth');
const sp = require('../shared/sharepoint-client');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    const roleCheck = auth.requireRole(context, req);
    if (!roleCheck.ok) {
      jsonResponse(roleCheck.status, roleCheck.body);
      return;
    }

    const userEmail = auth.getUserEmail(roleCheck.principal);
    const method = req.method ? req.method.toLowerCase() : 'get';

    if (method === 'get') {
      const settings = await sp.getAutoApproveSettings();
      
      let isExpired = false;
      let activeMode = settings.autoMode;
      
      if (activeMode && activeMode !== 'normal' && settings.expiryTime) {
        const expiryDate = new Date(settings.expiryTime);
        const now = new Date();
        if (now > expiryDate) {
          isExpired = true;
          activeMode = 'normal';
          
          context.log('Auto mode has expired. Resetting status to normal on SharePoint.');
          try {
            await sp.updateAutoApproveSettings('normal', '', '');
          } catch (e) {
            context.log.warn('Failed to auto-expire settings on SharePoint:', e.message);
          }
        }
      }

      jsonResponse(200, {
        ok: true,
        autoMode: activeMode,
        expiryTime: settings.expiryTime || '',
        enabledBy: settings.enabledBy || '',
        isExpired: isExpired,
        serverTime: new Date().toISOString()
      });
      return;
    }

    if (method === 'post') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }

      const mode = body && body.autoMode;
      if (!['normal', 'dry-run', 'active'].includes(mode)) {
        jsonResponse(400, { ok: false, error: 'Invalid autoMode. Expected normal, dry-run, or active' });
        return;
      }

      let expiryIso = '';
      if (mode !== 'normal') {
        const duration = body && body.durationMinutes;
        if (!duration) {
          jsonResponse(400, { ok: false, error: 'durationMinutes is required when enabling auto mode' });
          return;
        }

        const now = new Date();
        if (duration === 'end_of_day') {
          const utcTime = now.getTime();
          const thOffset = 7 * 60 * 60 * 1000;
          const thTime = new Date(utcTime + thOffset);
          
          thTime.setUTCHours(23, 59, 59, 999);
          
          const thExpiry = new Date(thTime.getTime() - thOffset);
          expiryIso = thExpiry.toISOString();
        } else {
          const minutes = parseInt(duration, 10);
          if (isNaN(minutes) || minutes <= 0) {
            jsonResponse(400, { ok: false, error: 'durationMinutes must be a positive number or end_of_day' });
            return;
          }
          const expiryDate = new Date(now.getTime() + minutes * 60 * 1000);
          expiryIso = expiryDate.toISOString();
        }
      }

      context.log(`Updating auto-approve settings on SharePoint: mode=${mode}, expiry=${expiryIso}, user=${userEmail}`);
      const updateResult = await sp.updateAutoApproveSettings(mode, expiryIso, userEmail);
      if (!updateResult.ok) {
        jsonResponse(502, {
          ok: false,
          error: 'Failed to update settings in SharePoint',
          detail: 'HTTP ' + updateResult.status
        });
        return;
      }

      jsonResponse(200, {
        ok: true,
        autoMode: mode,
        expiryTime: expiryIso,
        enabledBy: userEmail,
        serverTime: new Date().toISOString()
      });
      return;
    }

    jsonResponse(405, { ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    context.log.error('Unexpected auto-approve-settings error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};
