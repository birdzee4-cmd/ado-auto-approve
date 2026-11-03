# Incident Automation v3.8.55: เก็บ SharePoint hyperlink เดิม

แพ็กเกจ: `artifacts/power-automate/OperationsHub-IncidentAutomationv3.8.55-LateApprovalGuard-Import.zip`

## สาเหตุจาก runtime จริง

Run `08584083510711177541547882235CU29` เวลา 13:36 วันที่ 29 ตุลาคม 2026 (INC564 / ADO897380) ผ่าน Condition Approval Still Current และ Assign Work Item to Approver แต่ Update Incident Approved ตอบ HTTP400: PrimitiveValue node / StartObject expected

Get Incident After Approval แสดง AdoWorkItemUrl เป็น object `{Description, Url}` แต่ body ของ REST MERGE ส่ง field นี้เป็น string URL การแปลง PatchItem เป็น REST ใน v3.8.53/v3.8.54 ไม่ได้คงชนิด Hyperlink จึงเกิดข้อผิดพลาด หลักฐาน `artifacts/power-automate/IncidentAutomation-v3.8.54-sharepoint-hyperlink-error.png`

## การแก้และตรวจ

v3.8.55 ตัด AdoWorkItemUrl และ AdoWorkItemId ออกจาก REST MERGE หลัง Approval ทุกแขนง เพราะการตอบ Approval ไม่ควรเปลี่ยนตัวตนหรือลิงก์ใบงานที่สร้างไว้แล้ว คง revision test และ SharePoint ETag เดิม เพิ่ม assertion ใน validator ว่า conditional writes ไม่เขียนสอง field นี้

สแกนชื่อ ZIP ทั้งหมดแล้ว baseline สูงสุด v3.8.54 จึงสร้าง v3.8.55 ผ่าน validator43 checks ก่อนและหลังบีบอัด รวม assertion ใหม่ เก็บแพ็กเกจเดิมทั้งหมด immutable และตรวจชื่อ/metadata/contentVersion สอดคล้องกัน

SHA256: `970A00DD130C0982CE000EA1DBDD936904B673EDD70666DD63A60818CB3ECED6`

ผู้ใช้สร้าง Flow ใหม่ v3.8.55 และเปิด On สำเร็จวันที่ 29 ตุลาคม 2026 เวลา 15:25 น. Flow checker แสดง Errors (0) / Warnings (0) หลักฐาน `artifacts/power-automate/IncidentAutomation-v3.8.55-on-checker.png` Flow ID ใหม่ `c9ab45c9-cc70-4f43-85da-c6b09e1bc195`; v3.8.54 ปิด Off แล้ว ยังต้องผ่าน runtime UAT โดยรอ incident Active จริงและตรวจ late response หลัง Closed

## ข้อมูลเดิม

ห้าม resubmit FIRING run เต็มรายการ: Assign ADO สำเร็จแล้วก่อน SharePoint ล้มเหลว ต้องอ่านสถานะ/owner/revision ปัจจุบันและผล Approval จริงก่อนซ่อมเฉพาะรายการเดิม เก็บ audit และไม่เปิดงานที่ฟื้นตัวกลับ

INC550 ในหน้ารายการ Operations Hub ที่ตรวจเวลา15:05 แสดง Recovered / Closed / Unassigned แต่รายละเอียดตอบ HTTP500 จึงยังไม่ได้แก้ metadata ของรายการนั้น

## UI

PR15: https://github.com/birdzee4-cmd/ado-auto-approve/pull/15 ถูก merge เข้า `main` ด้วย merge commit `6d3f96f83306b688ccd2e725f2a2d669f5683bf7` เปลี่ยนเฉพาะ `components.tsx` และ `Incidents.tsx` รวม 4 บรรทัด functional และ whitespace ท้ายไฟล์

Azure Static Web Apps production run #723 เสร็จสำเร็จแล้ว หลัง cache-busting reload หน้า production ตรวจ `INC-2026-000550` พบ `Workflow status: Cancelled` และ `Approval: Cancelled` โดย ADO work item ยังคง `Closed`

