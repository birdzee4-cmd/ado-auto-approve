/**
 * ============================================
 * Microsoft Teams Notifier
 * ============================================
 *
 * ส่ง Adaptive Card เข้า Teams Incoming Webhook
 *
 * ใช้: const { sendTeamsCard } = require('../shared/teams-notifier');
 *
 * Environment variable:
 *   TEAMS_WEBHOOK_URL  =  https://outlook.office.com/webhook/.../IncomingWebhook/...
 *                         (หรือ workflow URL จาก Power Automate)
 */

const https = require('https');
const { URL } = require('url');

/**
 * ส่ง JSON payload เข้า Teams Incoming Webhook
 * @param {object} card - Adaptive Card payload
 * @returns {Promise<{ok: boolean, status: number, body: string}>}
 */
function sendTeamsCard(card) {
  return new Promise((resolve, reject) => {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    if (!webhookUrl) {
      return reject(new Error('TEAMS_WEBHOOK_URL is not configured in environment variables'));
    }

    let parsed;
    try {
      parsed = new URL(webhookUrl);
    } catch (e) {
      return reject(new Error('TEAMS_WEBHOOK_URL is not a valid URL'));
    }

    const data = JSON.stringify(card);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: body
        });
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Teams webhook request timeout (10s)'));
    });

    req.write(data);
    req.end();
  });
}

/**
 * สร้าง Adaptive Card สำหรับการแจ้งเตือน PR ใหม่ (Phase 2)
 */
function buildPrDetectedCard(pr) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: '🔔 New PR Detected on Staging',
            weight: 'Bolder',
            size: 'Large',
            color: 'Accent'
          },
          {
            type: 'TextBlock',
            text: pr.title || 'Untitled PR',
            wrap: true,
            size: 'Medium',
            weight: 'Bolder'
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'PR ID:',        value: `#${pr.id}` },
              { title: 'Created By:',   value: pr.createdBy || '-' },
              { title: 'Source Branch:', value: pr.sourceBranch || '-' },
              { title: 'Target Branch:', value: pr.targetBranch || '-' },
              { title: 'Repository:',   value: pr.repository || '-' },
              { title: 'Event Type:',   value: pr.eventType || '-' },
              { title: 'Time:',         value: new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }) + ' (Bangkok)' }
            ]
          },
          {
            type: 'TextBlock',
            text: '⚙️ Phase 2 — Webhook ทำงานปกติ (ยังไม่ Auto-Approve, รอ Phase 3)',
            wrap: true,
            isSubtle: true,
            size: 'Small',
            spacing: 'Medium'
          }
        ],
        actions: pr.url ? [
          {
            type: 'Action.OpenUrl',
            title: '🔗 Open in Azure DevOps',
            url: pr.url
          }
        ] : []
      }
    }]
  };
}

/**
 * สร้าง Adaptive Card สำหรับการทดสอบ (ปุ่ม Test Teams บน dashboard)
 */
function buildTestCard(triggeredBy) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: '✅ Test Notification',
            weight: 'Bolder',
            size: 'Large',
            color: 'Good'
          },
          {
            type: 'TextBlock',
            text: 'Teams Webhook ทำงานปกติ ระบบ ADO Auto-Approve เชื่อมต่อกับ channel นี้ได้แล้ว',
            wrap: true
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'Triggered By:', value: triggeredBy || 'Unknown' },
              { title: 'Phase:',        value: 'Phase 2 - Webhook & Notification' },
              { title: 'Time:',         value: new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }) + ' (Bangkok)' }
            ]
          }
        ]
      }
    }]
  };
}

/**
 * สร้าง Adaptive Card แจ้งเตือนข้อผิดพลาด
 */
function buildErrorCard(title, errorMessage, context) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: `⚠️ ${title}`,
            weight: 'Bolder',
            size: 'Large',
            color: 'Attention'
          },
          {
            type: 'TextBlock',
            text: errorMessage,
            wrap: true
          },
          context ? {
            type: 'FactSet',
            facts: Object.entries(context).map(([k, v]) => ({ title: k + ':', value: String(v) }))
          } : null
        ].filter(Boolean)
      }
    }]
  };
}

module.exports = {
  sendTeamsCard,
  buildPrDetectedCard,
  buildTestCard,
  buildErrorCard
};
