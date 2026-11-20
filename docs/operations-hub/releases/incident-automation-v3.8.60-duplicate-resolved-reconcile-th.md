# Operations Hub Incident Automation v3.8.60 — Duplicate RESOLVED reconciliation

แก้กรณีอีเมล `RESOLVED` ถูกบันทึกหรือถูกประมวลผลแล้ว แต่ Flow จบที่เงื่อนไข `Message Already Processed` ก่อนเรียก reconciliation API

การเปลี่ยนแปลง:

- ถ้าอีเมลซ้ำเป็น `RESOLVED` Flow จะเรียก `POST /api/operations-reconcile` ด้วย `IncidentId` เดิม
- API ยังคงเป็น idempotent: ตรวจสถานะล่าสุดของ Work Item ก่อนเพิ่มคอมเมนต์หรือเปลี่ยนเป็น `Closed`
- อีเมลซ้ำที่ไม่ใช่ `RESOLVED` ยังคงจบแบบ duplicate ตามเดิม
- ไม่สร้าง VSTS Work Item ใหม่ และไม่เพิ่มคอมเมนต์ซ้ำ เพราะใช้ audit event key เดิม

หลัง import ต้องตรวจ parameter `operationsReconcileEndpoint` และ `operationsAutomationKey` รวมถึงค่า `OPERATIONS_RECONCILIATION_ENABLED` และ `ADO_RESOLVED_COMMENT_PAT` ของ API ให้พร้อมใช้งาน
