const sp = require('./sharepoint-client');

const HOLD_ACTION = 'Approval Hold';
const RELEASE_ACTION = 'Approval Hold Released';

function normalizeAction(action) {
  return String(action || '').trim().toLowerCase();
}

function isHoldAction(action) {
  const text = normalizeAction(action);
  return text === normalizeAction(HOLD_ACTION) || text === 'hold';
}

function isReleaseAction(action) {
  const text = normalizeAction(action);
  return text === normalizeAction(RELEASE_ACTION) ||
    text === 'release hold' ||
    text === 'approval hold release';
}

function getItemTime(item, fields) {
  const value = item && (item.createdDateTime || item.lastModifiedDateTime) ||
    fields && (fields.Last_Checked_At || fields.Created) ||
    '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function buildHoldStateFromItems(items) {
  const logs = Array.isArray(items) ? items : [];
  let latest = null;
  for (const item of logs) {
    const fields = item && item.fields || {};
    const action = fields.Action || '';
    if (!isHoldAction(action) && !isReleaseAction(action)) continue;
    const time = getItemTime(item, fields);
    if (!latest || time >= latest.time) {
      latest = {
        active: isHoldAction(action),
        action: action,
        reason: fields.Reason || '',
        heldBy: fields.User || '',
        heldAt: item.createdDateTime || fields.Last_Checked_At || '',
        releasedBy: fields.User || '',
        releasedAt: item.createdDateTime || fields.Last_Checked_At || '',
        result: fields.Result || '',
        time: time
      };
    }
  }

  if (!latest) {
    return { active: false };
  }
  if (latest.active) {
    return {
      active: true,
      reason: latest.reason,
      heldBy: latest.heldBy,
      heldAt: latest.heldAt,
      result: latest.result || 'On Hold'
    };
  }
  return {
    active: false,
    reason: latest.reason,
    releasedBy: latest.releasedBy,
    releasedAt: latest.releasedAt,
    result: latest.result || 'Released'
  };
}

async function getHoldState(prId) {
  const result = await sp.getLogForPR(prId);
  if (!result.ok) {
    return { ok: false, status: result.status, state: { active: false }, error: 'SharePoint returned ' + result.status };
  }
  const items = result.body && Array.isArray(result.body.value) ? result.body.value : [];
  return { ok: true, status: result.status, state: buildHoldStateFromItems(items) };
}

async function getHoldStates(prIds) {
  const ids = Array.from(new Set((Array.isArray(prIds) ? prIds : [])
    .map(id => parseInt(id, 10))
    .filter(id => Number.isFinite(id) && id > 0)));
  const states = {};
  await Promise.all(ids.map(async id => {
    try {
      const result = await getHoldState(id);
      states[id] = result.state || { active: false };
    } catch (e) {
      states[id] = { active: false, error: e.message };
    }
  }));
  return states;
}

async function getHoldStatesFromRecent(prIds, lookbackDays, maxItems) {
  const ids = Array.from(new Set((Array.isArray(prIds) ? prIds : [])
    .map(id => parseInt(id, 10))
    .filter(id => Number.isFinite(id) && id > 0)));
  const wanted = new Set(ids.map(String));
  const states = {};
  ids.forEach(id => { states[id] = { active: false }; });
  if (!ids.length) return states;

  const days = Math.max(1, Math.min(parseInt(lookbackDays, 10) || 180, 365));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await sp.getLogItemsSince(since, Math.max(parseInt(maxItems, 10) || 1000, 100));
  if (!result.ok) return states;

  const items = result.body && Array.isArray(result.body.value) ? result.body.value : [];
  const grouped = {};
  for (const item of items) {
    const fields = item && item.fields || {};
    const prId = parseInt(fields.PR_ID, 10);
    if (!Number.isFinite(prId) || !wanted.has(String(prId))) continue;
    const action = fields.Action || '';
    if (!isHoldAction(action) && !isReleaseAction(action)) continue;
    if (!grouped[prId]) grouped[prId] = [];
    grouped[prId].push(item);
  }
  for (const id of ids) {
    states[id] = buildHoldStateFromItems(grouped[id] || []);
  }
  return states;
}

async function addHoldLog(opts) {
  const fields = sp.buildLogFields({
    prId: opts.prId,
    action: opts.action,
    user: opts.user,
    repository: opts.repository,
    prTitle: opts.prTitle,
    targetBranch: opts.targetBranch,
    result: opts.result,
    reason: opts.reason,
    source: 'Dashboard',
    eventKey: opts.eventKey,
    adoPrUrl: opts.adoPrUrl
  });
  return sp.addLogItem(fields);
}

module.exports = {
  HOLD_ACTION,
  RELEASE_ACTION,
  getHoldState,
  getHoldStates,
  getHoldStatesFromRecent,
  addHoldLog
};
