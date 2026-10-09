# Workflow ใหม่สำหรับ Operations Hub

เอกสารนี้ใช้สร้าง automation ใหม่โดยไม่แก้ Production Workflow เดิม

## OperationsHub-WorkItem-Reconciliation

สร้าง Scheduled cloud flow ใหม่:

1. Trigger: Recurrence ทุก 5 นาที
2. HTTP POST ไปที่ `https://<static-web-app>/api/operations-reconcile`
3. Headers: `Content-Type: application/json` และ `x-operations-automation-key` จาก secure environment variable/connection reference
4. Body: `{ "maxItems": 5, "scope": "ALL" }`
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

การแจ้งเตือน **Ready to close** แยกเปิดด้วย `OPERATIONS_READY_TO_CLOSE_NOTIFICATION_ENABLED=true` หลัง UAT เพื่อให้เปิดเฉพาะการแจ้งเตือนนี้ได้โดยไม่เปิดข้อความอื่นข้างต้น เมื่อ alert เป็น `RESOLVED` และ Work Item ที่ติดตามทุกใบอยู่ในสถานะสิ้นสุด (รวม `Reject` ตามกติกาปัจจุบัน) ระบบจะส่ง Teams พร้อมลิงก์ไปยัง INC โดยตรงหนึ่งครั้งต่อ INC ผ่าน Audit `EventKey` คงที่ ผู้รับผิดชอบต้องกด Close Incident เอง; reconciliation ไม่ปิด INC ให้

ตั้งค่า secret `TEAMS_READY_TO_CLOSE_WEBHOOK_URL` เป็น Teams Workflows webhook URL ของแชต `AzureAppServiceHigh5xxRateCritical` ก่อน deploy การเปลี่ยนปลายทางนี้ Ready to close จะส่ง Adaptive Card เฉพาะ URL ดังกล่าว; ถ้าไม่มีค่า ระบบจะไม่ส่งและไม่ fallback ไป `TEAMS_WEBHOOK_URL` ของ General การแจ้งประเภทอื่นยังใช้ `TEAMS_WEBHOOK_URL` เดิม `EventKey` ของปลายทางใหม่นับแยกจาก General จึงส่ง INC ที่ยัง Ready to close ไปห้องใหม่ได้หนึ่งครั้ง

## Environment checkpoint

- [x] สร้าง Flow ใหม่โดยไม่ clone/แก้ Production Workflow
- [x] เก็บ automation key ใน secure configuration
- [x] ทดสอบด้วย `maxItems: 1`
- [ ] ตรวจ Audit และ Teams notification
- [x] เปิด schedule หลัง UAT เท่านั้น — live ทุก 5 นาทีแบบ `scope=ALL`, batch 5; Flow v1.3.0 ปิดแล้ว และ notification ยังปิด
- [ ] ยืนยันว่าปิด Flow ใหม่นี้แล้ว Production Workflow ยังทำงานต่อ
