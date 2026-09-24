# Workflow ใหม่สำหรับ Operations Hub

เอกสารนี้ใช้สร้าง automation ใหม่โดยไม่แก้ Production Workflow เดิม

## OperationsHub-WorkItem-Reconciliation

สร้าง Scheduled cloud flow ใหม่:

1. Trigger: Recurrence ทุก 10 นาที
2. HTTP POST ไปที่ `https://<static-web-app>/api/operations-reconcile`
3. Headers: `Content-Type: application/json` และ `x-operations-automation-key` จาก secure environment variable/connection reference
4. Body: `{ "maxItems": 100 }`
5. HTTP 200 หมายถึงสำเร็จทั้งหมด; HTTP 207 หมายถึงบาง Incident sync ไม่สำเร็จ
6. เปิด Secure Inputs/Outputs สำหรับ action ที่มี automation key
7. ตั้ง retry เป็น exponential และห้ามเรียก Production Workflow

Endpoint จะ:

- ตรวจ automation key แบบ fail-closed
- อ่านเฉพาะ Incident ที่ยังไม่ปิด
- sync PRIMARY และ RELATED ผ่าน ADO PAT สำหรับ background operation
- อัปเดต Existing Incident List และ Operations Hub Work Items
- บันทึก Audit ทุกครั้ง
- ไม่ปิด Incident อัตโนมัติ

## OperationsHub-Incident-Notification

การแจ้งเตือนรวมอยู่ใน reconciliation endpoint และเปิดด้วย `OPERATIONS_NOTIFICATION_ENABLED=true` เพื่อไม่ต้องสร้าง Flow ที่สองในระยะแรก ระบบส่งเฉพาะ:

- synchronization failed
- Related Work Items ยังเปิด
- Work Items ปิดครบและรอ Tier 1 Confirm Recovery

Audit `EventKey` ใช้ป้องกันข้อความสถานะเดิมซ้ำ หากรายการหรือสถานะเปลี่ยนจะได้ EventKey ใหม่

## Environment checkpoint

- [ ] สร้าง Flow ใหม่โดยไม่ clone/แก้ Production Workflow
- [ ] เก็บ automation key ใน secure configuration
- [ ] ทดสอบด้วย `maxItems: 1`
- [ ] ตรวจ Audit และ Teams notification
- [ ] เปิด schedule หลัง UAT เท่านั้น
- [ ] ยืนยันว่าปิด Flow ใหม่นี้แล้ว Production Workflow ยังทำงานต่อ
