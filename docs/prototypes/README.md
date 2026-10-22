# Deployment Monitoring local prototype

ต้นแบบนี้ใช้ข้อมูลสังเคราะห์ทั้งหมดเพื่อทบทวนหน้าจอและพฤติกรรมระหว่างรอ G0 ไม่ใช่หน้า production, SQL integration หรือ UAT result และไม่ได้เสิร์ฟจาก `public/` ใน workflow ของ repository

เปิดจาก repository root:

```powershell
node scripts/preview-deployment-monitoring.cjs
```

เปิด http://127.0.0.1:4177/ ใน browser หยุด server ด้วย Ctrl+C; server bind เฉพาะ loopback และเสิร์ฟเฉพาะไฟล์ต้นแบบใน allowlist ไม่มี API/DB และ CSP ปิด connect-src

ทดสอบด้วยตัวกรองหรือเปิด “ทดสอบสถานะหน้าจอด้วยข้อมูลสังเคราะห์” ด้านล่างเพื่อเลือก success, HTML/XSS text, empty, error/stale, unavailable, disabled, 401 และ 403 หากมีข้อมูลเดิม (รวม empty ที่โหลดสำเร็จ) แล้ว refresh ล้มเหลว จะแสดง stale พร้อม fetchedAt เดิม; 401/403 จะล้างข้อมูลเสมอ หากยังไม่มีข้อมูลและเป็น 503 จะแยก disabled จาก unavailable

ทุก Status เป็น unknown แม้มี CompletedDate; IsPrepared เป็น readiness เท่านั้น ค่า code 0/7/-1/null เป็นเพียงตัวอย่าง ไม่ใช่การยืนยันรหัสใน SQL จริง วันปฏิทินตัวกรองใช้ Bangkok; TargetDate/CompletedDate ใน fixture เป็น wall-clock strings สำหรับตัวอย่าง ไม่ได้ยืนยัน DB timezone

หน้าทดสอบมี filter/readiness/unknown cards/table/dialog และ manual refresh ไม่มีปุ่ม sync, เขียนข้อมูล, deploy, auto polling, export หรือ pagination รายการใน fixture แสดงทั้งชุดที่กรองแล้ว จึงไม่ใช่การทดสอบ summary API แยกจาก list หรือ keyset cursor

ผลตรวจ Chrome วันที่ 22 ตุลาคม 2026:

- สำเร็จ 4 รายการ, readiness true 2 / false 1 / null 1 และ unknown 4; รหัส 0 กรองเหลือ 1 รายการ
- เปิดรายละเอียด/กด Escape/คืน focus ไปปุ่มเดิมได้
- stale เก็บแถวและ fetchedAt เดิม; auth failures ล้างแถวและแสดง `—` แทนจำนวนที่อาจทำให้เข้าใจว่าสำเร็จ
- empty/disabled/unavailable/forbidden แยก state ได้
- ชื่อโครงการ `<img src=x onerror=alert(1)>` และเวอร์ชัน `javascript:alert(1)` แสดงเป็น text; ตรวจ DOM ไม่พบ image/link ในแถวและไม่มี JS alert
- desktop ตรวจภาพหน้าจอแล้ว; viewport 390×844 ตรวจภาพเต็มหน้าและ DOM: document width 375 ≤ viewport 390, table scroll area 341px / content 1080px; คืน viewport override หลังทดสอบแล้ว

รัน unit/preview-server tests (คำสั่งจาก repository root):

```powershell
node --test --test-isolation=none api/test/deployment-monitoring-preview.test.js api/test/deployment-monitoring-ui-state.test.js api/test/deployment-monitoring-contract.test.js api/test/deployment-monitoring-http.test.js api/test/deployment-history-compatibility.test.js
```

ยังต้องยืนยัน schema/key/timezone/scope/mapping/field allowlist, trusted host, SELECT-only permissions และ UAT connectivity ก่อน SQL adapter/endpoint/การแทน `public/deploy-history.*` ตามแผน implementation; UI นี้ยังไม่มี core.js authentication integration, pagination, summary API integration หรือ real SQL detail fields
