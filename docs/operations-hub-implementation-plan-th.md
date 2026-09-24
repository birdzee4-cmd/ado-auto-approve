# แผนปรับปรุง Operations Hub

เอกสารนี้เป็น checklist กลางสำหรับดำเนินงานทีละ Phase โดยต้องหยุดตรวจสอบผลก่อนเริ่ม Phase ถัดไป

## หลักการที่ห้ามเปลี่ยน

- คง Production Workflow, Existing SharePoint Incident List และ VSTS Process เดิมไว้
- ห้ามแก้ Production Workflow; automation เพิ่มเติมต้องสร้างเป็น Workflow ใหม่
- คงชื่อ `Operations Hub` และ URL `/operations.html` โดยไม่ใช้คำว่า V2
- ไม่ลบหรือย้ายข้อมูล Production เดิม
- `AdoWorkItemId` ที่ Workflow เดิมสร้างคือ `PRIMARY/TIER1`
- งานของ App Support และ Tier 2 คือ `RELATED`
- Azure DevOps ใช้ relation แบบ `Related` ไม่ใช้ Parent/Child
- RCA อยู่นอกขอบเขตระบบ

## สถานะรวม

| Phase | สถานะ |
|---|---|
| Phase 0 — Baseline | ยังไม่เริ่ม |
| Phase 1 — Data Model และ Compatibility Layer | Repository implementation เสร็จ; รอ provision Lists ใน environment |
| Phase 2 — Azure DevOps Connection และสิทธิ์ | Repository implementation เสร็จ; รอ smoke test กับ ADO จริง |
| Phase 3 — Write API | Repository implementation เสร็จ; feature flags ปิด |
| Phase 4 — Operations Hub UI ใหม่ | Repository implementation เสร็จ |
| Phase 5 — Automation เพิ่มเติม | Endpoint/runbook เสร็จ; รอสร้าง Scheduled Flow ใน tenant |
| Phase 6 — Tests และ UAT | Automated tests เสร็จ; รอ environment UAT |
| Phase 7 — Rollout | Runbook/feature flags เสร็จ; ยังไม่ deploy production |

## Phase 0 — Baseline และสำรองระบบเดิม

- [ ] บันทึก diagram และพฤติกรรม Production Workflow
- [ ] สำรอง Power Automate package และ connection references
- [ ] บันทึก schema และตัวอย่างข้อมูล Existing SharePoint Incident List
- [ ] บันทึก ADO Project, Work Item Type, Area Path และ state ที่ใช้งานจริง
- [ ] ยืนยันว่า Production Workflow ยังทำงานเหมือนเดิม

## Phase 1 — Data Model และ Compatibility Layer

- [x] กำหนด schema `Operations Hub Work Items`
- [x] กำหนด schema `Operations Hub Service Mapping`
- [x] กำหนด schema `Operations Hub Audit`
- [x] เพิ่ม `workItems[]` และ `workItemSummary` ใน Incident model
- [x] แปลง `AdoWorkItemId` เดิมเป็น `PRIMARY/TIER1` โดยไม่แก้ข้อมูลต้นทาง
- [x] รองรับการอ่าน `RELATED` จาก `Operations Hub Work Items`
- [x] ป้องกัน supporting record เปลี่ยน ownership ของ PRIMARY เดิม
- [x] รองรับ Incident เก่าที่ไม่มี Work Item หรือไม่มี optional columns
- [x] เพิ่มการค้นหาจาก Work Item ID, role, team, state และ assignee
- [x] ทำให้ supporting list เป็น opt-in ผ่าน `OPERATIONS_WORK_ITEMS_LIST_NAME`
- [x] เพิ่ม regression tests สำหรับ single/multiple/no-work-item cases
- [ ] Provision Lists ทั้งสามใน environment เป้าหมาย
- [ ] ตั้ง `OPERATIONS_WORK_ITEMS_LIST_NAME=Operations Hub Work Items` หลัง provision สำเร็จ
- [ ] Smoke test กับข้อมูล SharePoint จริง

Checkpoint: ก่อนเริ่ม Phase 2 ต้อง provision Lists, เปิดการอ่าน Work Items List และยืนยันว่า API ประกอบ PRIMARY กับ RELATED ได้โดยไม่เปลี่ยน Existing Incident List

## Phase 2 — Azure DevOps Connection และสิทธิ์

- [x] นำ OAuth/token lifecycle เดิมมาใช้ใน Operations Hub
- [x] เพิ่ม Connect/Reconnect/Disconnect status ใน Operations Hub
- [x] ใช้ Operations Hub URL/hash route เป็น OAuth `returnTo`
- [x] ตรวจ ADO identity จาก Azure DevOps `connectionData` ด้วย delegated token
- [x] แยก Operations Hub identity และ verified ADO identity ใน API contract
- [x] เก็บ verified ADO identity ใน encrypted token record หลัง callback
- [x] เพิ่ม reusable write-role gate สำหรับ Tier 1 และ Admin
- [x] ไม่ใช้ service account fallback ใน connection validation
- [x] ผู้ไม่มี connection ยังอ่าน Incident ได้ตาม role เดิม
- [x] เพิ่ม unit tests สำหรับ identity validation, fail-closed, role gate และ hash return URL
- [ ] Smoke test Connect/Reconnect/Disconnect กับ Azure DevOps จริง
- [ ] ยืนยัน role assignments ของ Tier 1 ใน Static Web Apps production

Checkpoint: ก่อนเริ่ม Phase 3 ต้องยืนยันว่า header แสดง verified ADO identity, reconnect/disconnect ทำงาน และบัญชีที่ไม่มี role ตาม `OPERATIONS_WRITE_ROLES` ไม่ผ่าน write-role gate

## Phase 3 — Operations Hub Write API

- [x] Resolve Service Mapping และ block mapping ที่ไม่ครบ
- [x] Create Related Work Item ด้วย delegated token และ relation แบบ Related
- [x] Link Existing Work Item
- [x] Synchronize PRIMARY และ RELATED
- [x] Confirm Recovery
- [x] ดึงสถานะ ADO ล่าสุดก่อน Validate/Close Incident
- [x] เพิ่ม idempotency และแยก Operations/ADO identity ใน Audit
- [x] เพิ่ม feature flags ที่ปิดเป็นค่าเริ่มต้น
- [ ] ทดสอบกับ SharePoint และ Azure DevOps environment จริง

## Phase 4 — Operations Hub UI ใหม่

- [x] คง Dashboard/URL เดิมและปรับ Incident experience สำหรับ workflow ใหม่
- [x] แสดง Primary และ Related Work Items พร้อมจำนวนปิด/ทั้งหมด
- [x] แสดง ADO connection และ mapping preview แบบ read-only
- [x] เพิ่ม Create/Link/Sync/Confirm Recovery/Close controls
- [x] แสดง closure blockers และ Timeline/Audit
- [x] เพิ่มหน้า Service Mapping แบบ read-only สำหรับ Admin
- [ ] Visual/UAT review ใน environment จริง

## Phase 5 — Automation เพิ่มเติม

- [x] เพิ่ม `/api/operations-reconcile` แยกจาก Production Workflow
- [x] เพิ่ม automation-key authentication และ feature flag
- [x] เพิ่ม notification candidates และ Audit EventKey deduplication
- [x] จัดทำขั้นตอนสร้าง `OperationsHub-WorkItem-Reconciliation`
- [x] ไม่แก้ Production Workflow
- [ ] สร้าง/import Scheduled Flow ใน tenant
- [ ] Duplicate Alert จาก monitoring ยังใช้กติกาของ Production Workflow เดิมจนกว่าจะมีโครงการแยก

## Phase 6 — Tests และ UAT

- [x] Automated test PRIMARY ใบเดียวและ compatibility
- [x] Automated test PRIMARY กับ RELATED
- [x] Automated test closure blockers
- [x] Automated test role, token, mapping, idempotency และ automation key
- [ ] ทดสอบ Alert ซ้ำและ Alert ที่กลับมาหลัง Incident ปิด
- [x] API regression suite ผ่าน
- [x] TypeScript/Vite production build ผ่าน
- [ ] ยืนยัน Production Workflow ไม่มี regression ใน environment
- [ ] Tier 1 ลงนาม UAT

## Phase 7 — Rollout และ Rollback

- [x] จัดทำ deployment sequence แบบ read-only ก่อน
- [x] เพิ่ม feature flags สำหรับ connection/create/link/sync/reconciliation/notification/close
- [x] จัดทำ monitoring checklist
- [x] จัดทำ rollback sequence โดยไม่พึ่งการแก้ Production Workflow
- [x] กำหนดห้ามลบ Work Items/Audit ที่สร้างสำเร็จแล้ว
- [ ] Deploy และเปิดใช้งานตามลำดับใน environment จริง

## Completion Policy

Incident ปิดได้เมื่อ PRIMARY และ RELATED ทุกใบอยู่ใน closed state และ Tier 1 ยืนยัน Recovery แล้วเท่านั้น โดย RCA ไม่มีผลต่อ lifecycle นี้
