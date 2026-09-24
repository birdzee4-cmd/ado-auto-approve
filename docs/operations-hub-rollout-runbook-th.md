# Operations Hub Rollout และ Rollback Runbook

## ก่อน Deploy

- [ ] สำรอง Production Workflow package และ connection references
- [ ] Provision `Operations Hub Work Items`, `Operations Hub Service Mapping`, `Operations Hub Audit`
- [ ] เพิ่ม optional Operations columns ใน Existing Incident List
- [ ] ใส่ Service Mapping จริงอย่างน้อยหนึ่ง service สำหรับ pilot
- [ ] ยืนยัน Tier 1 role และ Azure DevOps permissions
- [ ] ตั้ง supporting-list settings โดยยังปิด feature flags ทั้งหมด

## Deployment sequence

1. Deploy API/UI โดย feature flags ทั้งหมดเป็น `false`
2. Smoke test dashboard, incident history และ PRIMARY compatibility
3. Smoke test Connect/Reconnect/Disconnect
4. เปิด `OPERATIONS_SYNC_ENABLED=true` และทดสอบ Incident pilot
5. เปิด `OPERATIONS_LINK_ENABLED=true`
6. เปิด `OPERATIONS_CREATE_ENABLED=true` เฉพาะเมื่อ mapping pilot ถูกต้อง
7. เปิด `OPERATIONS_CLOSE_ENABLED=true` หลัง closure UAT
8. สร้าง Flow ใหม่ แล้วเปิด `OPERATIONS_RECONCILIATION_ENABLED=true`
9. เปิด `OPERATIONS_NOTIFICATION_ENABLED=true` เป็นขั้นตอนสุดท้าย

## Smoke/UAT scenarios

- [ ] Incident เดิมแสดง PRIMARY/TIER1 ถูกต้อง
- [ ] Tier 1 สร้าง APP_SUPPORT RELATED จาก mapping ได้
- [ ] Tier 1 สร้าง TIER2 RELATED จาก mapping ได้
- [ ] double click/retry ไม่สร้างงานซ้ำ
- [ ] Link Existing สร้าง Related relation
- [ ] Synchronize อัปเดต state/assignee/closed time
- [ ] ปิด Incident ไม่ได้เมื่อมีงานเปิด
- [ ] ปิด Incident ไม่ได้หากยังไม่ Confirm Recovery
- [ ] ปิดได้เมื่อทุกใบปิดและ Confirm Recovery
- [ ] Audit แยก Operations identity กับ ADO identity
- [ ] ผู้ไม่มี write role และผู้ไม่ Connect ถูกปฏิเสธ
- [ ] Production Workflow ยังรับ Alert และสร้าง PRIMARY เหมือนเดิม

## Monitoring

ติดตาม API 4xx/5xx, `ADO_CREATE_FAILED`, `MAPPING_NOT_FOUND`, `INCIDENT_CLOSE_BLOCKED`, reconciliation HTTP 207, notification failure, duplicate WorkItemId และ `LastSyncedAt` ที่เก่าเกินรอบ schedule

## Rollback

1. ปิด `OPERATIONS_NOTIFICATION_ENABLED`
2. ปิด `OPERATIONS_RECONCILIATION_ENABLED` และ Scheduled Flow ใหม่
3. ปิด `OPERATIONS_CLOSE_ENABLED`, `OPERATIONS_CREATE_ENABLED`, `OPERATIONS_LINK_ENABLED`, `OPERATIONS_SYNC_ENABLED`
4. คง API/UI เป็น read-only หรือ rollback deployment
5. ห้ามลบ ADO Work Items หรือ Audit ที่สร้างแล้ว
6. Production Workflow เดิมต้องทำงานต่อโดยไม่ต้องเปิดหรือแก้ไข
