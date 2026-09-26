# Operations Hub Escalation Plan

## ข้อกำหนดที่ยืนยันแล้ว

- Power Automate v3.8.5 เป็น Production baseline สำหรับรับ FIRING/RESOLVED, สร้าง Primary Ticket และ Approval
- Primary Ticket เป็น `IT Support Case` ของ Tier 1
- เมื่อ Tier 1 แก้ไขไม่ได้ ผู้ใช้เลือกสร้าง App Support, IT Tier 2 หรือทั้งสองใบพร้อมกันได้
- App Support ใช้ Work Item Type `Service Form`
- IT Tier 2 ใช้ Work Item Type และรายละเอียดเดียวกับ IT Tier 1
- Description ของทั้งสามใบต้องเหมือน Description ของ Primary Ticket ใน Azure DevOps
- Incident ปิดได้เมื่อ Work Item ที่เกี่ยวข้องทุกใบปิด และสถานะ Alert ผ่านการตรวจสอบ
- ยังไม่ทำ First Response SLA, RCA และ Daily Report ในระยะนี้
- Production write flags ต้องปิดระหว่างพัฒนาและ UAT แบบ read-only

## สถาปัตยกรรม

- Azure DevOps REST API เป็นกลไกอ่าน/สร้าง/เชื่อม/synchronize Work Item
- Service Mapping เป็น routing configuration แบบบาง ไม่เก็บโครงสร้างฟอร์มทั้งหมด
- Ticket Profile ในโค้ดควบคุม validation และค่าเฉพาะของ `Service Form` และ `IT Support Case`
- `OperationsHubWorkItems` เก็บ Primary/Related state รายใบ
- Reconciliation อ่านสถานะทุก Work Item และคำนวณ readiness; ไม่ปิด Incident อัตโนมัติ
- Teams notification แยกเป็น outbox และ Flow เฉพาะหลัง ticket creation เสถียรแล้ว

## แผนดำเนินการ

### Phase 1 — Ticket profiles และ Description parity

- [x] อ่าน ADO field metadata ของ `Service Form` และ `IT Support Case`
- [x] ใช้ Description ล่าสุดจาก Primary Work Item เป็น source of truth
- [x] เพิ่ม profile `APP_SUPPORT_SERVICE_FORM_V1`
- [x] เพิ่ม profile `IT_TIER2_SUPPORT_CASE_V1`
- [x] ปรับ Draft Mapping ให้ตรง Work Item Type/Area/assignment จริง โดยยัง `Enabled = No`

### Phase 2 — Hybrid escalation

- [x] เลือก App Support, Tier 2 หรือทั้งสองทีม
- [x] Preview mapping/profile, Tags, Title และ Description จริงจาก Primary Ticket ก่อนสร้าง
- [x] Batch create แบบผลลัพธ์รายทีม
- [x] Retry เฉพาะทีมที่ล้มเหลวโดยไม่สร้างรายการซ้ำ
- [x] เชื่อม Related link กับ Primary และบันทึก Audit

### Phase 3 — Aggregate reconciliation

- [x] Sync Primary และ Related Work Items ทุกใบ
- [x] แยก scheduled state synchronization ออกจาก Manual Sync/approval repair; reconciliation อ่าน ADO และ mirror สถานะลง SharePoint โดยไม่แก้ Approval หรือปิด Incident
- [x] คำนวณ `WAITING_FOR_APP_SUPPORT`, `WAITING_FOR_TIER2`, `READY_TO_CLOSE`
- [x] ห้าม scheduled reconciliation ปิด Incident อัตโนมัติ

### Phase 4 — UX/UI

- [x] Escalation workspace พร้อม target selector
- [x] Ticket cards แยก Tier 1/App Support/Tier 2
- [x] Preview Description จาก Primary Ticket และ routing ก่อนสร้าง
- [x] Partial success/error พร้อม retry
- [x] Closure checklist แสดง blocker ราย Ticket และ Alert

### Phase 5 — UAT และ rollout

- [x] Automated API/UI tests
- [x] รองรับ targeted reconciliation ด้วย Incident ID สำหรับ Controlled UAT โดยไม่กระทบ Incident อื่น
- [ ] Import UAT flow เป็น Create as new และคงสถานะ Off
- [x] Read-only/dry-run verification และ targeted live reconciliation UAT ผ่านกับ `INC-2026-000224`: synchronized 3, failed 0; ปิด flag กลับหลังทดสอบ
- [x] เปิด create flag ชั่วคราวเพื่อ Production test ที่ได้รับอนุญาต
- [ ] รายงานเลข Work Item ที่สร้างทุกใบ
- [x] ปิด `OPERATIONS_RECONCILIATION_ENABLED=false` หลัง targeted UAT และยืนยัน Audit compatibility

## Deferred

- First Response SLA
- RCA workflow
- Daily Report
- Teams notification outbox/flow (ทำหลัง ticket creation เสถียร)
