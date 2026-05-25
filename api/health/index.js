/**
 * GET /api/health
 *
 * Health check endpoint สำหรับ:
 *  - Uptime monitor (ping ตรวจว่าระบบยังอยู่)
 *  - Smoke test หลัง deploy
 *  - Frontend ตรวจสถานะ backend
 *
 * Endpoint นี้ไม่ต้อง login
 */
module.exports = async function (context, req) {
  const startTime = process.env.WEBSITE_START_TIME || new Date().toISOString();

  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    },
    body: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      phase: 'Phase 1 - Foundation',
      version: '1.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      node_version: process.version,
      message: 'ADO Auto-Approve API is running'
    }
  };
};
