# Operations Hub Incident Automation v3.8.7

## เป้าหมาย

เวอร์ชันนี้เป็น Production hotfix สำหรับปัญหา Approval หนึ่งรายการบล็อกอีเมลรายการถัดไป โดยแก้เฉพาะ Intake safety และคง Approval/VSTS/SharePoint logic เดิม

## การเปลี่ยนแปลง

- ปิด Trigger Concurrency Control ใน package อย่างถาวร
- ถอด Subject Filter `🔥 ALERT FIRING` เพื่อให้ trigger รับทั้ง FIRING และ RESOLVED
- ใช้ `Condition_AppService_Subject_Routing` ภายใน Flow กรอง subject ที่รองรับ
- คง `SourceMessageId` และ `IncidentId` deduplication
- คง `Start and wait for an approval` เพื่อไม่เปลี่ยนผล Approve/Reject ใน hotfix นี้
- คงเวลาแสดงผล Asia/Bangkok และ canonical timestamp เดิม
- คง Tier 1 Tag เป็น `ITSupport_Pool` เท่านั้น

## Artifact

- `artifacts/power-automate/OperationsHub-IncidentAutomation-v3.8.7.zip`
- SHA-256: `315291E97F49B5FF6D7CF43F27E5F13A88DF86A6FF9EA26916BABDE49E24230A`

## Import และ Cutover

1. Import ZIP และเลือก **Create as new** เป็น `Operations Hub - Incident Automation v3.8.7`.
2. ผูก Connections เดิมให้ครบ: Outlook, SharePoint, Teams, Approvals และ Azure DevOps.
3. เปิด Flow checker และยืนยันว่าไม่มี connection error.
4. ตรวจ Trigger Settings:
   - Folder = `AzureAppServiceHigh5xxRateCritical`
   - Subject Filter ว่าง
   - Concurrency Control = Off
5. ปิด v3.8.6 ก่อนเปิด v3.8.7 ห้ามเปิดพร้อมกันกับ mailbox folder เดียวกัน.
6. ส่ง controlled FIRING หนึ่งรายการและตรวจ Incident/VSTS/Approval.
7. ขณะที่ Approval แรกยัง Pending ให้ส่ง P2 หรือ WaitAlert หนึ่งรายการ; run ใหม่ต้องเริ่มได้โดยไม่ขึ้น Waiting.
8. ส่ง RESOLVED ที่สัมพันธ์กันและตรวจว่าอัปเดต Incident เดิมโดยไม่สร้าง VSTS ซ้ำ.

## Production checkpoint — 2026-09-27

- [x] ผู้ดูแล Import `Operations Hub - Incident Automation v3.8.7` สำเร็จและไม่พบ connection/import error
- [x] เปิด v3.8.7 แล้ว
- [x] ปิด v3.8.6 แล้ว จึงไม่มี Flow สองตัวอ่าน mailbox folder พร้อมกัน
- [ ] Natural P1 FIRING สร้าง Incident, VSTS และ Approval อย่างละหนึ่งรายการ
- [ ] ขณะ Approval แรกยัง Requested งานถัดไปเริ่มได้โดยไม่ขึ้น Waiting
- [ ] Natural RESOLVED อัปเดต Incident เดิมและไม่สร้าง VSTS เพิ่ม
- [ ] ตรวจ SourceMessageId/IncidentId/Work Item ID หลัง UAT ว่าไม่มีรายการซ้ำ

## Rollback

1. ปิด v3.8.7.
2. เปิด v3.8.6 ซึ่ง Production ได้ปิด Concurrency Control ไว้แล้ว.
3. ตรวจ SourceMessageId/IncidentId และ VSTS ก่อน retry รายการที่สถานะไม่ชัดเจน.

## งานถัดไป

แยก Approval Response เป็น Flow อีกตัวเพื่อให้ Intake จบหลังสร้าง Approval โดยไม่ถือ run รอผู้อนุมัติ งานนี้ต้องใช้ trigger schema จาก export ของ Power Automate ที่สร้างจริงและจะออกเป็น release แยก ไม่รวม definition ที่ยังไม่ผ่าน import validation ใน v3.8.7 hotfix.
