/**
 * ============================================
 * LINE Messaging API Notifier
 * ============================================
 *
 * ส่งข้อความเข้ากลุ่ม LINE หรือผู้ใช้รายคน ผ่าน LINE Official Account Messaging API
 * Endpoint: POST https://api.line.me/v2/bot/message/push
 *
 * Environment variables:
 *   LINE_CHANNEL_ACCESS_TOKEN = Channel Access Token จาก LINE Developers
 *   LINE_TARGET_ID            = ID ปลายทาง (Group ID 'C...' หรือ User ID 'U...')
 */

const https = require('https');
const { URL } = require('url');

/**
 * ส่ง Push Message ไปยัง LINE Messaging API
 * @param {string} text ข้อความที่ต้องการส่ง (จำกัด 5,000 ตัวอักษร)
 * @returns {Promise<{ok: boolean, status: number, body: string}>}
 */
function sendLinePush(text) {
  return new Promise((resolve, reject) => {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = process.env.LINE_TARGET_ID;

    if (!accessToken) {
      return reject(new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured in environment variables'));
    }
    if (!targetId) {
      return reject(new Error('LINE_TARGET_ID is not configured in environment variables'));
    }

    // จำกัดจำนวนอักขระที่ 5,000 ตัวอักษรตามข้อกำหนดของ LINE Text Message
    let messageText = String(text || '').trim();
    if (messageText.length > 4900) {
      messageText = messageText.substring(0, 4890) + '\n... [ข้อความถูกตัดเนื่องจากเกินขีดจำกัดของ LINE]';
    }

    if (messageText.length === 0) {
      return resolve({ ok: false, status: 400, body: 'Empty message text' });
    }

    const apiUrl = 'https://api.line.me/v2/bot/message/push';
    const parsed = new URL(apiUrl);

    const payload = {
      to: targetId,
      messages: [
        {
          type: 'text',
          text: messageText
        }
      ]
    };

    const data = JSON.stringify(payload);
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 10000 // 10 วินาที timeout
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
      reject(new Error('LINE push notification timeout (10s)'));
    });

    req.write(data);
    req.end();
  });
}

module.exports = {
  sendLinePush
};
