# Operations Hub Rollout และ Rollback Runbook

## ก่อน Deploy

- [ ] สำรอง Production Workflow package และ connection references
- [x] Provision `OperationsHubWorkItems`, `OperationsHubServiceMapping`, `OperationsHubAudit`
- [x] ใช้ `OperationsHubAudit` event `INCIDENT_CLOSED/SUCCEEDED` เป็น closure source of truth เพื่อให้ใช้สิทธิ์เขียน item เดิมและไม่ต้องขอสิทธิ์จัดการ SharePoint schema
- [x] เพิ่มและยืนยัน Service Mapping สำหรับ App Support/Tier 2 แล้ว; ไม่กระทบการแสดง PRIMARY จาก Production Workflow เดิม
- [ ] ยืนยัน Tier 1 role และ Azure DevOps permissions
- [ ] ตั้ง supporting-list settings โดยยังปิด feature flags ทั้งหมด

## Deployment sequence

1. Production Workflow เดิมสร้าง PRIMARY/TIER1 ต่อไปตามปกติ; ห้ามสร้าง PRIMARY ซ้ำจาก Operations Hub
2. Deploy API/UI โดย feature flags ของ Operations Hub write actions ทั้งหมดเป็น `false`
3. Smoke test dashboard, incident history และการแสดง PRIMARY ที่ Production Workflow สร้าง
4. Smoke test Connect/Reconnect/Disconnect
5. เปิด Sync/Link/Close ทีละ feature หลังผ่าน UAT และยืนยัน feature flags
6. เปิด `OPERATIONS_CREATE_ENABLED` เฉพาะช่วง UAT ที่ได้รับอนุมัติ แล้วปิดกลับทันทีหลังทดสอบ; mappings ของ App Support/Tier 2 ยืนยันแล้ว
7. สร้าง Flow ใหม่แยกจาก Production Flow แล้วทดสอบก่อนเปิด schedule
8. เปิด notification เป็นขั้นตอนสุดท้าย

## Production smoke checkpoint — 2026-09-24

- [x] Operations Hub production page opens and ADO displays Connected as `kiattisak.yo@buzzebees.com`.
- [x] Incident list loads. `INC-2026-000214` displays existing PRIMARY `#882323` (`TIER1`, Processing); no duplicate PRIMARY was created.
- [x] Production read-only verification on 2026-09-25: `INC-2026-000217` shows `APPROVAL_COMPLETED`, Primary Work Item `#882396`, and last sync from Power Automate; approval completion does not mean the Incident is closed (`0/1` Work Items closed, tracking remains OPEN).
- [ ] Recovery correlation is not yet verified: Outlook contains a matching `RESOLVED` alert for `AzureAppServicePlanCpuVeryHighCritical` / `prd-th-appserviceplan-service-center03` (FIRING at 06:22, RESOLVED at 06:27), while `INC-2026-000217` still displays `FIRING` and no Resolved At. Do not mark lifecycle UAT complete until the flow run and SharePoint update are confirmed.
- [ ] Power Automate details for `Operations Hub - Incident Automation v3.7.9 CT2` show a trigger-concurrency throttling warning and many recent runs in `Waiting`. Treat this as a possible alert-processing delay/drop; investigate with the Flow owner before any change. Do not modify the existing Production Flow as part of this rollout.
- [ ] Superseding test evidence (2026-09-25): user screenshot shows `Operations Hub - Incident Automation v3.8.0` is `On` with recent successful runs; await a fresh P1 FIRING/RESOLVED incident before marking recovery correlation passed. The attached `OperationsHub-IncidentAutomation-v3.8.0.zip` is internally mismatched: its package manifest and flow definition identify `Operations Hub - Incident Automation v3.7.9 CT2` / `3.7.9.2` and describe a controlled-test routing behavior. Do not import or treat this ZIP as the v3.8.0 release until replaced/verified.
- [ ] New test case in progress (user screenshot, 2026-09-25): `INC-2026-000219` has Primary Work Item `#882513` and an Approval request linked to that Work Item; Approval UI shows `Requested`, while Operations Hub shows `FIRING` / `OPEN` / `PROCESSING`. Wait for the authorized approver's decision, then verify the approval outcome and (when the matching email arrives) that RESOLVED updates this same Incident without creating another Work Item.
- [x] All six Operations feature-flag entries are present in the Production environment. The administrator reports all are `false`; values were not independently read back, so keep the server-side fail-closed behavior and do not run write actions.
- [x] Service Mapping มี 2 enabled mappings ที่ยืนยันแล้ว: App Support ใช้ `Service Form`/ไม่ assign และ Tier 2 ใช้ `IT Support Case`/assign `ITSupport Admin`
- [x] `operations-hub-reconcile` runs every 10 minutes with `dryRun=true`; two manual/recurrence smoke runs succeeded on 2026-09-25, inputs/outputs are secured, and Sync/Reconciliation flags remain `false`.
- [x] Service Mapping admin page now exposes disabled drafts for review, while mapping resolution continues to ignore disabled entries.
- [x] After deployment, the Production browser UI reads write capabilities from the authorized API; Create, Link, Synchronize, and Close controls are disabled while flags are false.
- [ ] Review repeated recent alert entries before declaring duplicate suppression/UAT passed; do not infer distinct incidents or merge records from alert name alone.
- [x] Confirmed the deployed Production page includes Monitoring Alert Details for Incident `INC-2026-000214` (resource, subscription, resource group, plan, host, metric, value, threshold, summary).
- [x] Deployment commit `c1c6f46` completed successfully in GitHub Actions run `36026482037`.

## Smoke/UAT scenarios

- [ ] Incident เดิมแสดง PRIMARY/TIER1 ถูกต้อง
- [x] Tier 1 สร้าง APP_SUPPORT RELATED จาก mapping ได้ — Production `INC-2026-000233` สร้าง `#882972` เป็น `Service Form`, New, ไม่ assign, tags `appsupport_pool; ITSupport_Pool`
- [x] Tier 1 สร้าง TIER2 RELATED จาก mapping ได้ — Production `INC-2026-000233` สร้าง `#882973` เป็น `IT Support Case`, New, assign `ITSupport Admin`, tag `ITSupport_Pool`
- [x] double click/retry ไม่สร้างงานซ้ำ — API บังคับหนึ่ง RELATED ต่อ Incident/ทีมแม้ request key เปลี่ยน และ UI ปิดทีมที่มีใบงานอยู่แล้ว; Production `INC-2026-000233` มี App Support `#882972` และ Tier 2 `#882973` เพียงทีมละหนึ่งใบ
- [ ] Link Existing สร้าง Related relation
- [x] Synchronize อัปเดต state/assignee/closed time — targeted Production UAT `INC-2026-000224` เมื่อ 2026-09-26: Work Items 3 ใบสำเร็จทั้งหมด, failed 0, notification disabled และ reconciliation flag ถูกปิดกลับ
- [x] ปิด Incident ไม่ได้เมื่อมีงานเปิด — Production UI UAT `INC-2026-000224` เมื่อ 2026-09-26: 2/3 closed, Primary `#882895` ยัง Processing; ปุ่ม Close ถูก disable
- [x] ปิด Incident ไม่ได้เมื่อ Alert ยัง FIRING — UAT รายการเดียวกันแสดง blocker `Monitoring alert is not RESOLVED` และไม่มีคำสั่งปิดถูกส่ง
- [x] ตรวจเงื่อนไขพร้อมปิด — `INC-2026-000224` แสดง `RESOLVED`, Work Items `3/3 closed` และ `READY_TO_CLOSE`; พบว่า tracking เคยขึ้น `CLOSED` ก่อนมี `INCIDENT_CLOSED` จึงเพิ่ม regression guard ให้ Incident ที่มี RELATED คง `OPEN` จนกด Close สำเร็จ
- [x] ปิดได้เมื่อมี Primary, Work Item ทุกใบปิด และ Alert RESOLVED — Production UAT `INC-2026-000224` สำเร็จเมื่อ 2026-09-27 01:15 (Asia/Bangkok); Tracking เปลี่ยนเป็น `CLOSED` และ Timeline มี `INCIDENT_CLOSED`
- [x] Close UAT ของ `INC-2026-000224`: รอบแรกได้ HTTP 500; structured error เปิดเผย HTTP 403 จากการสร้าง closure columns จึงเปลี่ยนมาใช้ append-only Audit เป็น source of truth และทดสอบซ้ำสำเร็จโดยไม่เพิ่ม SharePoint schema permission
- [x] แก้ POST error boundary ให้ await write handler ภายใน try/catch เพื่อคืน sanitized error code/detail แทน Azure 500 แบบ body ว่าง
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
