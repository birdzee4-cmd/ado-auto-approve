# Deployment Analytics UAT Checklist

## Safety gates

- [ ] หน้า `Monitor งานประจำวัน` ยังเปิดและแสดงข้อมูลได้เหมือนเดิม
- [ ] ไม่มี request แบบ POST, PUT, PATCH หรือ DELETE จากหน้า Analytics
- [ ] Azure DevOps ไม่มี Pipeline, Build, PR หรือ Deployment ถูกแก้ไข
- [ ] Service Hook configuration ไม่ถูกเปลี่ยน

## Data reconciliation

เลือกอย่างน้อย 10 runs จาก Azure DevOps ที่มีทั้ง succeeded, failed, canceled และ running แล้วตรวจ:

- [ ] Pipeline name ตรงกัน
- [ ] Run ID / Build number ตรงกัน
- [ ] Stage ตรงกัน
- [ ] Result ตรงกัน
- [ ] Environment grouping ไม่จัด Production/Staging/Development ผิด
- [ ] เวลาแสดงเป็น Asia/Bangkok
- [ ] PR / Commit link เปิดไปยังรายการเดิม
- [ ] รายการที่ไม่มี timestamp ไม่ถูกนำไปคำนวณ duration

## Analytics behavior

- [ ] Filter วันที่เปลี่ยนข้อมูลทุก view สอดคล้องกัน
- [ ] Filter Environment และ Result ทำงานถูกต้อง
- [ ] Pipeline drill-down แสดงเฉพาะ Pipeline ที่เลือก
- [ ] P50/P80/P95 แสดง `-` เมื่อไม่มี duration samples
- [ ] Empty state และ API error state อ่านเข้าใจได้
- [ ] หน้าจอใช้งานได้บน desktop และหน้าจอแคบ

## Sign-off evidence

- Validation command: `node scripts/validate-deployment-analytics.js`
- Record the UAT date, tester, selected Azure DevOps runs, and screenshots separately.
- Do not store credentials or tokens in this repository.
