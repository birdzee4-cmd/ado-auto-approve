/**
 * ============================================
 * POST /api/webhook
 * ============================================
 *
 * รับ Service Hook จาก Azure DevOps เมื่อมี Pull Request event
 *
 * Security:
 *   - ต้องส่ง HTTP Basic Auth (ตั้งค่าใน ADO Service Hook subscription)
 *   - Credentials เก็บใน env vars: WEBHOOK_USERNAME, WEBHOOK_PASSWORD
 *
 * Filter:
 *   - รับเฉพาะ event type ที่กำหนด (PR created/updated)
 *   - Target branch ต้องตรงกับ env var STAGING_BRANCH_REF
 *     (default: "refs/heads/staging")
 *
 * Action (Phase 2):
 *   - ส่ง Adaptive Card เข้า Teams
 *   - ตอบ 200 OK ให้ ADO รู้ว่ารับแล้ว
 *
 * ⚠️ Phase 2 ยังไม่ Approve PR — จะทำใน Phase 3
 */

const { sendTeamsCard, buildPrDetectedCard } = require('../shared/teams-notifier');

// Event types ที่สนใจ
const SUPPORTED_EVENTS = new Set([
  'git.pullrequest.created',
  'git.pullrequest.updated'
]);

module.exports = async function (context, req) {
  // ---------- 1. Verify Basic Auth ----------
  const authResult = verifyBasicAuth(req);
  if (!authResult.ok) {
    context.log.warn(`Auth failed: ${authResult.reason}`);
    context.res = {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="ADO Webhook"',
        'Content-Type': 'application/json'
      },
      body: { error: 'Unauthorized', detail: authResult.reason }
    };
    return;
  }

  // ---------- 2. Parse payload ----------
  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!payload || typeof payload !== 'object') {
      throw new Error('Empty or non-object payload');
    }
  } catch (err) {
    context.log.error('Invalid payload:', err.message);
    context.res = {
      status: 400,
      body: { error: 'Invalid JSON payload', detail: err.message }
    };
    return;
  }

  // ---------- 3. Filter event type ----------
  const eventType = payload.eventType;
  if (!SUPPORTED_EVENTS.has(eventType)) {
    context.log(`Ignored event: ${eventType}`);
    context.res = {
      status: 200,
      body: { status: 'ignored', reason: `Event type "${eventType}" not handled` }
    };
    return;
  }

  // ---------- 4. Extract PR info ----------
  const resource = payload.resource || {};
  const pr = {
    id: resource.pullRequestId,
    title: resource.title,
    description: resource.description,
    createdBy: resource.createdBy?.displayName,
    sourceBranch: resource.sourceRefName,
    targetBranch: resource.targetRefName,
    repository: resource.repository?.name,
    project: resource.repository?.project?.name,
    status: resource.status,
    url: payload.resourceContainers?.project?.baseUrl
      ? `${payload.resourceContainers.project.baseUrl}${resource.repository?.project?.name}/_git/${resource.repository?.name}/pullrequest/${resource.pullRequestId}`
      : (resource._links?.web?.href || null),
    eventType: eventType,
    receivedAt: new Date().toISOString()
  };

  context.log(`Received: PR #${pr.id} "${pr.title}" → ${pr.targetBranch}`);

  // ---------- 5. Filter target branch (Staging only) ----------
  const stagingRef = process.env.STAGING_BRANCH_REF || 'refs/heads/staging';
  if (pr.targetBranch !== stagingRef) {
    context.log(`Ignored: target branch "${pr.targetBranch}" is not "${stagingRef}"`);
    context.res = {
      status: 200,
      body: {
        status: 'ignored',
        reason: 'Target branch is not Staging',
        targetBranch: pr.targetBranch,
        expected: stagingRef
      }
    };
    return;
  }

  // ---------- 6. Filter PR status (active only) ----------
  if (pr.status && pr.status !== 'active') {
    context.log(`Ignored: PR status is "${pr.status}"`);
    context.res = {
      status: 200,
      body: { status: 'ignored', reason: `PR status is "${pr.status}"` }
    };
    return;
  }

  // ---------- 7. Send Teams notification ----------
  try {
    const card = buildPrDetectedCard(pr);
    const result = await sendTeamsCard(card);

    if (!result.ok) {
      context.log.error(`Teams notify failed (HTTP ${result.status}): ${result.body}`);
      context.res = {
        status: 502,
        body: {
          status: 'received',
          notification: 'failed',
          teamsStatus: result.status,
          teamsBody: result.body
        }
      };
      return;
    }

    context.log(`✓ Teams notified for PR #${pr.id}`);
    context.res = {
      status: 200,
      body: {
        status: 'received',
        notification: 'sent',
        prId: pr.id,
        eventType: eventType,
        phase: 'Phase 2 - notify only, no approve yet'
      }
    };
  } catch (err) {
    context.log.error('Teams notify exception:', err);
    context.res = {
      status: 500,
      body: { error: 'Teams notification failed', detail: err.message }
    };
  }
};

// ============================================
// Helper: HTTP Basic Auth verification
// ============================================
function verifyBasicAuth(req) {
  const expectedUser = process.env.WEBHOOK_USERNAME;
  const expectedPass = process.env.WEBHOOK_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return { ok: false, reason: 'WEBHOOK_USERNAME / WEBHOOK_PASSWORD not configured' };
  }

  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return { ok: false, reason: 'Missing Basic Auth header' };
  }

  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    if (idx < 0) {
      return { ok: false, reason: 'Malformed Basic Auth' };
    }
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);

    // Constant-time compare เพื่อกัน timing attack
    if (!safeEqual(user, expectedUser) || !safeEqual(pass, expectedPass)) {
      return { ok: false, reason: 'Invalid credentials' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'Auth decode error' };
  }
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
