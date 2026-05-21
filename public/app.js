// ============================================
// ADO Auto-Approve - Dashboard Script
// ============================================

(async function init() {
  // 1. ตรวจสอบว่า login แล้วหรือยัง
  try {
    const authResp = await fetch('/.auth/me');
    const authData = await authResp.json();

    if (!authData.clientPrincipal) {
      // ถ้ายังไม่ login → ส่งกลับหน้า login
      window.location.href = '/';
      return;
    }

    // 2. แสดงข้อมูล user ที่ login
    const principal = authData.clientPrincipal;
    document.getElementById('userName').textContent = principal.userDetails || 'Unknown';
    document.getElementById('displayName').textContent = principal.userDetails || '-';
    document.getElementById('userEmail').textContent = principal.userDetails || '-';
    document.getElementById('userId').textContent = principal.userId || '-';
    document.getElementById('loginTime').textContent = new Date().toLocaleString('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    // 3. เรียก API /userinfo เพื่อทดสอบ backend
    try {
      const userResp = await fetch('/api/userinfo');
      if (userResp.ok) {
        const userData = await userResp.json();
        // ถ้ามีชื่อจาก API ให้ใช้ชื่อนั้นแทน
        if (userData.name) {
          document.getElementById('displayName').textContent = userData.name;
        }
        if (userData.email) {
          document.getElementById('userEmail').textContent = userData.email;
        }
      }
    } catch (e) {
      console.warn('API not available:', e);
    }

    // 4. ตรวจ Health ของ Backend API
    try {
      const healthResp = await fetch('/api/health');
      const healthCard = document.getElementById('apiStatus');
      if (healthResp.ok) {
        healthCard.querySelector('.status-icon').textContent = '✅';
        healthCard.querySelector('.status-desc').textContent = 'Backend ทำงานปกติ';
      } else {
        healthCard.classList.remove('status-ok');
        healthCard.classList.add('status-error');
        healthCard.querySelector('.status-icon').textContent = '❌';
        healthCard.querySelector('.status-desc').textContent = 'Backend ตอบไม่ปกติ';
      }
    } catch (e) {
      const healthCard = document.getElementById('apiStatus');
      healthCard.classList.remove('status-ok');
      healthCard.classList.add('status-pending');
      healthCard.querySelector('.status-icon').textContent = '⚠️';
      healthCard.querySelector('.status-desc').textContent = 'เชื่อมต่อ Backend ไม่ได้';
    }

  } catch (err) {
    console.error('Auth check failed:', err);
    window.location.href = '/';
  }
})();
