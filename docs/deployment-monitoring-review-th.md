# Deployment Monitoring — สรุปตรวจงานก่อนรอ DBA

วันที่ 22 ตุลาคม 2026 (Asia/Bangkok) · branch `feature/deployment-monitoring-foundation-20261022` · baseline `d1b6f19`

**G0: pending ตามคำยืนยันผู้ใช้** ยังไม่มี UAT/config/identity หรือผล discovery ที่ DBA ยืนยัน ไม่มีการต่อ production ทดแทน งานเตรียมที่ไม่ต้องใช้ DB สำหรับรอบนี้เสร็จและหยุดรอหลักฐาน ไม่ใช่การส่งมอบ SQL integration หรือการแทนหน้า production ที่เสร็จแล้ว

## เอกสารที่ส่งให้ DBA ได้

[รายการ/แบบฟอร์ม DBA](deployment-monitoring-dba-handoff-th.md) ระบุ UAT server/database/network/authentication/SELECT-only โดยใช้ secret-store reference, [SQL discovery](sql/deployment-monitoring-discovery.sql) และลำดับ metadata ก่อน rows, รูปแบบผล CSV แยก result sets/สรุปพร้อม evidence, ข้อสรุป 49/57/PK/uniqueness/nullability/timezone และ mapping Status/DeployType/GetType/Priority/field visibility

เอกสารเป็น template ไม่มีข้อมูล DB/credential จริง ยังไม่ได้ส่งให้ DBA หรือบุคคลอื่นผ่านเครื่องมือใด ไม่ให้รันส่วนข้อมูลใน SQL จนกว่าจะยืนยัน permission/metadata/timezone/parameters

## ไฟล์ที่เพิ่ม/เปลี่ยนในงานนี้

| กลุ่ม | ไฟล์ |
|---|---|
| แผนและการตรวจ | `docs/deployment-monitoring-implementation-plan-th.md`, `docs/deployment-monitoring-progress-th.md`, `docs/deployment-monitoring-dba-handoff-th.md`, `docs/deployment-monitoring-review-th.md`, `docs/sql/deployment-monitoring-discovery.sql` |
| API preparation ที่ยังไม่ลงทะเบียน | `api/shared/deployment-monitoring-validation.js`, `deployment-monitoring-status.js`, `deployment-monitoring-http.js` (สองชื่อหลังอยู่ใน directory เดียวกัน) |
| Tests | `api/test/deployment-history-compatibility.test.js`, `deployment-monitoring-contract.test.js`, `deployment-monitoring-http.test.js`, `deployment-monitoring-ui-state.test.js`, `deployment-monitoring-preview.test.js` (ชื่อหลังอยู่ใน api/test เช่นกัน) |
| UI prototype นอก public | `docs/prototypes/deployment-monitoring.html`, `.css`, `deployment-monitoring-controller.mjs`, `deployment-monitoring-fixtures.mjs`, `deployment-monitoring-preview.mjs`, `README.md` |
| Preview tool | `scripts/preview-deployment-monitoring.cjs` |

มีเพียงไฟล์งานนี้ใน commits; งานผู้ใช้เดิม tracked/untracked ยังคงอยู่และไม่ถูก stage/commit/reset/stash การแก้แผนในรอบสรุปมีเพียงเปลี่ยน Markdown hard-break spaces สามจุดเป็นย่อหน้าเพื่อให้ diff --check ผ่าน ไม่มีการแก้ข้อกำหนด gate

## Local commits

| Commit | ผลงาน |
|---|---|
| `684b630` | แผน/discovery/บันทึก G0 |
| `d0c665d` | validation, unknown mapping, legacy compatibility tests |
| `1bf605e` | handler factory และ security tests |
| `41f2882` | headless UI state/controller และ tests |
| `1e3a29c` | ผลทดสอบและข้อจำกัด |
| `b508cca` | หน้าต้นแบบสังเคราะห์/local server/tests |
| `32a335b` | วิธีใช้ preview/browser checks |
| `d61e335` | ป้องกัน failed service envelope กลายเป็น HTTP 200 |
| `24c14d2` | ปฏิเสธ fetchedAt ที่ invalid/ไม่มี offset |
| `31ae781` | แบบฟอร์ม DBA รอบแรก |

commit เอกสารสรุปรอบสุดท้ายเพิ่ม format ผลตอบ DBA, รายงานนี้ และปรับ whitespace ในแผน ไม่มี runtime code เปลี่ยนในรอบสุดท้าย

## ผลทดสอบรอบสุดท้าย

รัน Node v24.15.0 ภายใต้ sandbox ด้วย `node --test --test-isolation=none <file>` แยก process ต่อไฟล์ (runner แบบปกติเคยติด spawn EPERM และไม่รวมไฟล์ต่าง suite ใน process เดียวเพื่อเลี่ยง mock contamination):

- รวม 23 ไฟล์ **159 tests: ผ่าน 155, ล้มเหลว 4**
- ชุด Monitoring/History/preview **26/26 ผ่าน**: validation/calendar/unknown mapping, auth-before-service/default-disabled/method/error redaction/request IDs/failed envelopes, state cancellation/stale/auth/timestamp, synthetic filters และ loopback server allowlist/CSP
- Report Summary, Monthly Summary, LINE Monthly Summary และ Deployment Model/Excel/Summary **25/25 ผ่าน**
- baseline failures ยังเป็น 4 กรณีเดิม: `appservice-logs.test.js` inferred PRD; `operations-api.test.js` capabilities; `operations-service.test.js` create-related description และ related preview description ไม่แก้ไฟล์เหล่านี้เพราะเป็นงานเดิมนอกขอบเขต
- `node --check` ของ JS/MJS/CJS ที่เพิ่มใน branch รวม 12 ไฟล์ผ่าน
- `git diff --check` เฉพาะ scope งานจาก baseline ผ่านหลังแก้ Markdown spaces
- เทียบ baseline กับ working tree ของ `public/`, history/sync/report-summary/monthly-summary/LINE consumers, deployment-store, API manifest/lock และ workflows ไม่มี diff

browser checks รอบก่อนบน synthetic prototype: desktop/mobile 390×844, raw status 0, dialog/Escape/focus, stale timestamps/rows, auth clear, empty/disabled/unavailable/forbidden และ hostile HTML เป็น text ผ่านการตรวจจริง ยังไม่รัน browser ซ้ำหลังการแก้ timestamp/controller (มี unit coverage ของการแก้นี้)

## สิ่งที่ยังไม่ได้ทดสอบ/ยังไม่ได้ทำ

ไม่มี SQL driver/adapter/parameterized repository/pool หรือ registered monitoring endpoints จึงยังไม่ทดสอบ schema drift/SQL parameter binding/connection permissions/TLS/network/timeout recovery/real pagination/summary/detail/ID 52844 กับ DB ไม่มี Node 22/clean npm ci validation, real-host auth boundary, UAT load/performance, UAT signoff หรือ release/rollback rehearsal

หน้า `/deploy-history.html` และ alias `/deploy-history` ยังเป็นหน้าเดิม; sync contract และ CSV consumers คงเดิม UI เป็น local synthetic prototype เท่านั้น ไม่มี production frontend integration, pagination หรือ separate summary API integration ไม่ใช้ Azure Tables แทน SQL และไม่ยืนยัน AC01–AC10 ครบจาก tests เหล่านี้

## สถานะหยุดรอ

ไม่มี push/PR/merge/deploy ไม่มีการส่ง secrets/SQL rows และไม่มี task-generated temporary artifacts ค้าง หยุด local preview server ที่เริ่มโดยงานนี้แล้ว; เปิดใหม่ได้ด้วยคำสั่งใน `docs/prototypes/README.md`

รอ DBA/owner ส่ง configuration reference/authorization และผล discovery ตามแบบฟอร์ม เมื่อได้รับจึงตรวจ G0 ต่อ ไม่เปลี่ยน pending เป็นผ่านจากคำว่า “ดำเนินการต่อ” หรือใช้ production ทดแทน
