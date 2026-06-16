/**
 * GET /api/deploy-history
 *
 * อ่านไฟล์ CSV จาก SharePoint Document Library และแปลงเป็น JSON ส่งกลับไปให้หน้าเว็บ
 */

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
    const yearParam = req.query && req.query.year ? String(req.query.year).trim() : '';
    let filePath = 'deploy-history/stg-deployments.csv';
    
    if (yearParam && /^\d{4}$/.test(yearParam)) {
      filePath = `deploy-history/stg-deployments-${yearParam}.csv`;
    }

    context.log(`Downloading deployment history CSV from SharePoint: ${filePath}...`);
    const result = await sp.downloadArchiveFile(filePath);
    
    // กรณีที่ยังไม่มีไฟล์ประวัติบน SharePoint
    if (result.status === 404) {
      context.log.warn(`Staging deployments CSV file not found on SharePoint (HTTP 404): ${filePath}. Returning empty list.`);
      jsonResponse(200, {
        ok: true,
        count: 0,
        deployments: [],
        message: yearParam ? `ยังไม่มีข้อมูลการ Deploy ของปี ${yearParam}` : 'ยังไม่มีข้อมูลการ Deploy กรุณารัน Sync ประวัติก่อน'
      });
      return;
    }

    if (!result.ok) {
      throw new Error(`SharePoint API returned HTTP ${result.status}`);
    }

    // อ่านข้อมูล CSV จาก response body
    const csvText = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    
    context.log('Parsing CSV content to JSON...');
    const deployments = parseCsv(csvText);

    jsonResponse(200, {
      ok: true,
      count: deployments.length,
      deployments: deployments
    });

  } catch (err) {
    context.log.error('Failed to get deploy history:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Failed to retrieve deployment history',
      detail: err && err.message ? err.message : String(err)
    });
  }
};

/**
 * ฟังก์ชันสำหรับแยกวิเคราะห์ CSV (CSV Parser) แบบรองรับการครอบอักษรด้วยเครื่องหมายคำพูด (Double quotes) และขึ้นบรรทัดใหม่ใน Cell
 */
function parseCsv(csvText) {
  if (!csvText) return [];
  
  const lines = [];
  let row = [''];
  let inQuotes = false;
  
  // ลบ UTF-8 BOM ถ้ามี
  if (csvText.startsWith('\uFEFF')) {
    csvText = csvText.substring(1);
  }

  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    const next = csvText[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        // กรณีเจอเครื่องหมายคำพูดเบิ้ล "" แปลว่าเป็นเครื่องหมายคำพูดเดี่ยวภายในข้อความ
        row[row.length - 1] += '"';
        i++; // ข้ามไปตัวถัดไป
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      lines.push(row);
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }

  // เก็บบรรทัดสุดท้ายหากไม่มีการจบบรรทัดด้วย newline
  if (row.length > 1 || row[0] !== '') {
    lines.push(row);
  }
  
  if (lines.length === 0) return [];

  const headers = lines[0].map(h => h.trim());
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];
    // ข้ามบรรทัดเปล่าหรือบรรทัดที่มีจำนวนคอลัมน์ไม่สัมพันธ์กับหัวตาราง
    if (values.length < headers.length) continue; 
    
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (values[j] || '').trim();
    }
    data.push(obj);
  }

  return data;
}
