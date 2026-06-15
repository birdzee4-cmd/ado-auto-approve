/**
 * ============================================
 * Microsoft Teams Notifier
 * ============================================
 *
 * ส่งข้อความเข้า Teams ผ่าน "Webhook Bot" (เช่น C-Toss Webhook Bot)
 * รูปแบบ payload:  { "text": "markdown content" }
 *
 * Environment variable:
 *   TEAMS_WEBHOOK_URL  =  https://webhookbot.c-toss.com/api/bot/webhooks/<id>
 *
 * หมายเหตุ:
 *   - C-Toss Webhook Bot รองรับ markdown ใน field "text"
 *   - ถ้าใช้ provider อื่นที่รับ payload แตกต่าง แก้ที่ฟังก์ชัน sendTeamsMessage() ได้
 */

const https = require('https');
const { URL } = require('url');

/**
 * ส่ง payload เข้า Teams Webhook
 */
function sendTeamsMessage(payload) {
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

    const data = JSON.stringify(payload);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
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
 * Helper สำหรับส่ง markdown text
 */
function sendTeamsText(text) {
  return sendTeamsMessage({ text: text });
}

/**
 * Backward-compatible alias (รับได้หลายรูปแบบ)
 */
function sendTeamsCard(payload) {
  if (typeof payload === 'string') {
    return sendTeamsText(payload);
  }
  if (payload && typeof payload === 'object' && typeof payload.text === 'string') {
    return sendTeamsMessage(payload);
  }
  if (payload && payload.attachments) {
    return sendTeamsText(adaptiveCardToText(payload));
  }
  return sendTeamsMessage(payload);
}

// ============================================
// Message Builders (Markdown format)
// ============================================

function buildPrDetectedCard(pr) {
  const time = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const lines = [
    '🔔 **New PR Detected on Staging**',
    '',
    '**' + (pr.title || 'Untitled PR') + '**',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| **PR ID** | #' + (pr.id || '-') + ' |',
    '| **Created By** | ' + (pr.createdBy || '-') + ' |',
    '| **Source** | `' + (pr.sourceBranch || '-') + '` |',
    '| **Target** | `' + (pr.targetBranch || '-') + '` |',
    '| **Repository** | ' + (pr.repository || '-') + ' |',
    '| **Event** | ' + (pr.eventType || '-') + ' |',
    '| **Time** | ' + time + ' (Bangkok) |',
    ''
  ];

  if (pr.url) {
    lines.push('🔗 [Open in Azure DevOps](' + pr.url + ')');
    lines.push('');
  }

  lines.push('_⚙️ Phase 2 — Webhook ทำงานปกติ (ยังไม่ Auto-Approve, รอ Phase 3)_');

  return { text: lines.join('\n') };
}

function buildTestCard(triggeredBy) {
  const time = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const text = [
    '✅ **Test Notification**',
    '',
    'Teams Webhook ทำงานปกติ ระบบ ADO Auto-Approve เชื่อมต่อกับ channel นี้ได้แล้ว',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| **Triggered By** | ' + (triggeredBy || 'Unknown') + ' |',
    '| **Phase** | Phase 2 - Webhook & Notification |',
    '| **Time** | ' + time + ' (Bangkok) |'
  ].join('\n');

  return { text: text };
}

function buildErrorCard(title, errorMessage, context) {
  const lines = [
    '⚠️ **' + title + '**',
    '',
    errorMessage,
    ''
  ];

  if (context && typeof context === 'object') {
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    for (const [k, v] of Object.entries(context)) {
      lines.push('| **' + k + '** | ' + String(v) + ' |');
    }
  }

  return { text: lines.join('\n') };
}

function adaptiveCardToText(adaptiveCardPayload) {
  try {
    const content = adaptiveCardPayload.attachments[0].content;
    const lines = [];
    for (const block of (content.body || [])) {
      if (block.type === 'TextBlock' && block.text) {
        if (block.weight === 'Bolder') {
          lines.push('**' + block.text + '**');
        } else {
          lines.push(block.text);
        }
        lines.push('');
      } else if (block.type === 'FactSet' && Array.isArray(block.facts)) {
        for (const f of block.facts) {
          lines.push('**' + f.title + '** ' + f.value);
        }
        lines.push('');
      }
    }
    return lines.join('\n');
  } catch (e) {
    return JSON.stringify(adaptiveCardPayload);
  }
}

/**
 * Sends a message/payload to a specific Teams Webhook URL.
 */
function notifyTeams(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const urlToUse = webhookUrl || process.env.TEAMS_WEBHOOK_URL;
    if (!urlToUse) {
      return reject(new Error('Teams webhook URL is not configured'));
    }

    let parsed;
    try {
      parsed = new URL(urlToUse);
    } catch (e) {
      return reject(new Error('Teams webhook URL is not a valid URL'));
    }

    const payloadObj = typeof payload === 'string' ? { text: payload } : payload;
    const data = JSON.stringify(payloadObj);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
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

module.exports = {
  sendTeamsMessage,
  sendTeamsText,
  sendTeamsCard,
  buildPrDetectedCard,
  buildTestCard,
  buildErrorCard,
  notifyTeams
};
