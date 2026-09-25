# แผนปรับปรุง Operations Hub

เอกสารนี้เป็น checklist กลางสำหรับดำเนินงานทีละ Phase โดยต้องหยุดตรวจสอบผลก่อนเริ่ม Phase ถัดไป

## หลักการที่ห้ามเปลี่ยน

- คง Production Workflow, Existing SharePoint Incident List และ VSTS Process เดิมไว้
- ห้ามแก้ Production Workflow; automation เพิ่มเติมต้องสร้างเป็น Workflow ใหม่
- คงชื่อ `Operations Hub` และ URL `/operations.html` โดยไม่ใช้คำว่า V2
- ไม่ลบหรือย้ายข้อมูล Production เดิม
- `AdoWorkItemId` ที่ Workflow เดิมสร้างคือ `PRIMARY/TIER1`
- งานของ App Support และ Tier 2 คือ `RELATED`
- ระยะเริ่มต้นใช้ Production Workflow เดิมสร้าง PRIMARY/TIER1 ตามปกติ; Operations Hub แสดงและติดตามใบงานนี้ ไม่สร้าง PRIMARY ซ้ำ
- ยืนยันค่า PRIMARY/TIER1 จากตัวอย่าง Work Item: Project `Buzzebees`, Type `IT Support Case`, Area `Buzzebees\Other\IT Support Team`, Iteration `Buzzebees`, Assigned To `kiattisak.yo@buzzebees.com`
- Azure DevOps ใช้ relation แบบ `Related` ไม่ใช้ Parent/Child
- RCA อยู่นอกขอบเขตระบบ

## สถานะรวม

| Phase | สถานะ |
|---|---|
| Phase 0 — Baseline | ยังไม่เริ่ม |
| Phase 1 — Data Model และ Compatibility Layer | Read path ผ่าน; Tier 1 PRIMARY ใช้ Flow เดิมได้; Mapping จำเป็นเฉพาะก่อนเปิด Related creation |
| Phase 2 — Azure DevOps Connection และสิทธิ์ | Production แสดง ADO Connected เป็น `kiattisak.yo@buzzebees.com`; ยังรอทดสอบ reconnect/disconnect และยืนยัน role ของ Tier 1 |
| Phase 3 — Write API | Repository implementation เสร็จ; flag defaults ปิด; เพิ่ม capabilities read endpoint ให้ UI ตรวจสถานะ |
| Phase 4 — Operations Hub UI ใหม่ | Repository implementation เสร็จ; ปุ่ม write ถูกปิดตาม capabilities จาก API |
| Phase 5 — Automation เพิ่มเติม | สร้าง Logic App reconciliation ใน tenant แล้วในสถานะ Disabled; รอเปิด Sync/Reconciliation หลัง UAT |
| Phase 6 — Tests และ UAT | Automated tests 61/61 ผ่าน และ UI build ผ่าน; เคส `INC-2026-000219`/Primary `#882513` เข้าระบบแล้ว แต่ Approval ยัง `Requested` และ Incident ยัง `FIRING`; รอผลอนุมัติและ RESOLVED เพื่อยืนยัน lifecycle end-to-end; ZIP ที่แนบชื่อ v3.8.0 มี manifest/definition ภายในเป็น v3.7.9 CT2 จึงห้ามใช้แทน release artifact จนกว่าจะตรวจ/สร้างใหม่ |
| Phase 7 — Rollout | Runbook พร้อม; rollout ที่มี write actions ยังรอ mapping, automation และ UAT |

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
- [x] Provision supporting Lists ทั้งสามใน environment เป้าหมาย
- [x] ตรวจชนิดคอลัมน์และ Indexes ของ supporting Lists
- [x] ตรวจหน้า SharePoint `OperationsHubServiceMapping` โดยตรง: headers ตาม schema ครบ; รายการยังว่าง ณ 2026-09-24
- [x] ตั้งค่า backend app settings ใน Production environment ให้ตรงกับชื่อ Lists จริง:
  - `OPERATIONS_WORK_ITEMS_LIST_NAME=OperationsHubWorkItems`
  - `OPERATIONS_MAPPINGS_LIST_NAME=OperationsHubServiceMapping`
  - `OPERATIONS_AUDIT_LIST_NAME=OperationsHubAudit`
- [x] Smoke test read-only กับ Operations Hub/Dashboard และ Service Mapping ผ่าน
- [ ] เพิ่ม Service Mapping ที่ยืนยัน routing แล้วและตั้ง Enabled = Yes ก่อนทดสอบสร้าง Related Work Item (ปัจจุบัน list ว่าง)

Checkpoint: Read path และ Tier 1 PRIMARY เดิมพร้อมใช้งาน; ก่อนทดสอบ Create Related สำหรับ App Support/Tier 2 ต้องเพิ่ม mapping ของทีมปลายทางที่ยืนยันแล้ว และห้ามเปิด write feature flags ก่อน UAT

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
- [x] ยืนยันสถานะ ADO `Connected` ในหน้า Production; backend status เชื่อมต่อผ่าน delegated identity verification
- [ ] ทดสอบ Reconnect/Disconnect กับ Azure DevOps จริง
- [ ] ยืนยัน role assignments ของ Tier 1 ใน Static Web Apps production

Checkpoint: การเชื่อมต่อของบัญชีปัจจุบัน verified แล้ว; ก่อนเปิด write actions ต้องทดสอบ reconnect/disconnect และยืนยัน role assignments ของ Tier 1

## Phase 3 — Operations Hub Write API

- [x] Resolve Service Mapping และ block mapping ที่ไม่ครบ
- [x] Create Related Work Item ด้วย delegated token และ relation แบบ Related
- [x] ประกอบ Description ของ Related Work Item จาก Alert fields ที่ Production Workflow parse จากอีเมล FIRING/RESOLVED
- [x] Link Existing Work Item
- [x] Synchronize PRIMARY และ RELATED
- [x] ปิด Incident โดยตรวจ Primary และสถานะ Work Item ทุกใบ; ไม่บังคับ Recovery confirmation
- [x] ดึงสถานะ ADO ล่าสุดก่อน Validate/Close Incident
- [x] เพิ่ม idempotency และแยก Operations/ADO identity ใน Audit
- [x] เพิ่ม feature flags ที่ปิดเป็นค่าเริ่มต้น
- [ ] ทดสอบกับ SharePoint และ Azure DevOps environment จริง

## Phase 4 — Operations Hub UI ใหม่

- [x] คง Dashboard/URL เดิมและปรับ Incident experience สำหรับ workflow ใหม่
- [x] แสดง Primary และ Related Work Items พร้อมจำนวนปิด/ทั้งหมด
- [x] แสดง Grafana Alert Details ที่ parse จาก Incident: Resource, Subscription, Resource Group, Plan, Host, Metric, Current Value, Threshold และ Summary
- [x] แสดง ADO connection และ mapping preview แบบ read-only
- [x] เพิ่ม Create/Link/Sync/Close controls; ถอด Confirm Recovery ออกจาก UI
- [x] แสดง closure blockers และ Timeline/Audit
- [x] เพิ่มหน้า Service Mapping แบบ read-only สำหรับ Admin
- [ ] Visual/UAT review ใน environment จริง

## Phase 5 — Automation เพิ่มเติม

- [x] เพิ่ม `/api/operations-reconcile` แยกจาก Production Workflow
- [x] เพิ่ม automation-key authentication และ feature flag
- [x] เพิ่ม notification candidates และ Audit EventKey deduplication
- [x] จัดทำขั้นตอนสร้าง `OperationsHub-WorkItem-Reconciliation`
- [x] ไม่แก้ Production Workflow
- [x] สร้าง Scheduled Flow `operations-hub-reconcile` ใน tenant เป็นรอบทุก 10 นาที โดยเริ่มต้นสถานะ Disabled
- [x] ตั้ง `OPERATIONS_AUTOMATION_KEY` โดยไม่เปิดเผยค่า และตรวจยืนยันว่า `OPERATIONS_RECONCILIATION_ENABLED=false`, `OPERATIONS_SYNC_ENABLED=false`
- [ ] เปิด Scheduled Flow หลัง Sync/Reconciliation UAT ผ่าน
- [ ] Duplicate Alert จาก monitoring ยังใช้กติกาของ Production Workflow เดิมจนกว่าจะมีโครงการแยก

## Phase 6 — Tests และ UAT

- [x] Automated test PRIMARY ใบเดียวและ compatibility
- [x] Automated test PRIMARY กับ RELATED
- [x] Automated test closure blockers
- [x] Automated test role, token, mapping, idempotency และ automation key
- [ ] ทดสอบ Alert ซ้ำและ Alert ที่กลับมาหลัง Incident ปิด
- [x] API test suite ผ่าน: 50/50 tests (`node test/<file>.test.js`; `node --test` ถูกจำกัดโดย environment ด้วย `spawn EPERM`)
- [x] TypeScript/Vite production build ผ่าน
- [ ] ยืนยัน Production Workflow ไม่มี regression ใน environment
- [ ] Tier 1 ลงนาม UAT

## Phase 7 — Rollout และ Rollback

- [x] จัดทำ deployment sequence แบบ read-only ก่อน
- [x] เพิ่ม feature flags สำหรับ connection/create/link/sync/reconciliation/notification/close
- [x] จัดทำ monitoring checklist
- [x] จัดทำ rollback sequence โดยไม่พึ่งการแก้ Production Workflow
- [x] กำหนดห้ามลบ Work Items/Audit ที่สร้างสำเร็จแล้ว
- [x] ตรวจค่า Production ผ่าน Azure CLI เมื่อ 2026-09-25: `OPERATIONS_CREATE_ENABLED=false`, `OPERATIONS_LINK_ENABLED=false`, `OPERATIONS_SYNC_ENABLED=false`, `OPERATIONS_CLOSE_ENABLED=false`, `OPERATIONS_RECONCILIATION_ENABLED=false`; automation key ถูกตั้งแล้วโดยตรวจเฉพาะการมีอยู่ ไม่อ่านหรือพิมพ์ค่าความลับ
- [x] Deploy `operations-hub-reconcile` ทุก 10 นาทีในสถานะ Disabled; API และ scheduler จึงยังไม่เกิด write จนกว่าจะผ่าน UAT และเปิด flags ตามลำดับ
- [ ] เพิ่มและยืนยัน Service Mapping สำหรับทีมปลายทางก่อนเปิด Related creation
- [x] ทดสอบ Production read-only หลัง deploy: dashboard/incident list โหลดได้, ADO แสดง Connected และ Incident `INC-2026-000214` แสดง PRIMARY `#882323`; Monitoring Alert Details แสดงครบ และ write controls ปิดตาม flags=false; ยังไม่ถือว่า UAT หรือเปิด write actions ผ่าน

## Completion Policy

Incident ปิดได้เมื่อมี PRIMARY และ PRIMARY/RELATED ทุกใบอยู่ใน closed state เท่านั้น ไม่ต้องยืนยัน Recovery และไม่ใช้สถานะ Alert `RESOLVED` เป็นเงื่อนไขปิดงาน; สถานะ Alert ยังคงแสดงเพื่ออ้างอิง ส่วน RCA อยู่นอกระบบนี้
