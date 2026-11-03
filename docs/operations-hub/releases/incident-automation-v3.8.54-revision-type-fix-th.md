# Incident Automation v3.8.54: แก้ InvalidTemplate หลัง Approve

แพ็กเกจ: `artifacts/power-automate/OperationsHub-IncidentAutomationv3.8.54-LateApprovalGuard-Import.zip`

## หลักฐานระบบจริง

Run `08584083579124030555113485491CU13` ของ INC-2026-000550 / VSTS #897313 บน v3.8.53 รับ Approval และอ่าน VSTS สำเร็จ แต่ Condition Approval Still Current ล้มเหลวด้วย InvalidTemplate: `empty()` รับค่า Integer ไม่ได้ ค่า `rev` ของ Azure DevOps เป็น Integer จึงไม่สามารถใช้ empty(rev) ได้

ขณะตรวจใบงานยัง New, Approval Status New, Unassigned และ SharePoint ยัง FIRING/AWAITING_APPROVAL ไม่มีการ retry, resubmit, สร้างงานเพิ่ม หรือแก้ข้อมูลเดิม หลักฐาน error อยู่ที่ `artifacts/power-automate/IncidentAutomation-v3.8.53-integer-revision-error.png`

## การแก้

- เปลี่ยนเงื่อนไข revision เป็น `greater(int(coalesce(rev,0)),0)` เพื่อรองรับ revision ตัวเลขจริง และปิดทางเขียนเมื่อ revision หาย/ศูนย์/ติดลบ
- คงการอ่านสถานะล่าสุด, ตรวจคำขอเดิม, ADO revision test, SharePoint ETag และ historical response ตาม v3.8.53
- เพิ่ม Terminate_After_Technical_Failure หลัง handler ส่งแจ้งเตือนสำเร็จ เพื่อให้ run เป็น Failed เมื่อ Scope หลักล้มเหลว ไม่แสดง Succeeded เพียงเพราะแจ้งเตือนสำเร็จ
- ตัวทดสอบ WDL แบบ local ปฏิเสธ empty(number) ตาม runtime จริงแล้ว ตัวจำลองเดิมยอมรับตัวเลขผิด จึงพลาด bug นี้

## Validation และสถานะนำเข้า

แพ็กเกจใหม่ผ่าน validator 43 checks และตรวจ assertion ของ Terminate เพิ่มด้วย สร้างจากฐาน v3.8.52 โดยใช้ builder ที่แก้แล้ว เลือก v3.8.54 หลังสแกน ZIP ทุกชื่อและพบ baseline สูงสุด v3.8.53 เก็บ ZIP v3.8.53 เดิมโดยไม่แก้ไข

ยืนยันนำเข้าแบบ Update Flow ID เดิม `bd8d4c3c-ee57-4a88-b15d-d0c063c1592a` สำเร็จแล้ว ตรวจวันที่ 29 ตุลาคม 2026 เวลา 15:04 น. พบ Flow v3.8.54 สถานะ On และ Flow checker Errors (0) / Warnings (0) หลักฐาน `artifacts/power-automate/IncidentAutomation-v3.8.54-on-checker.png` ยังต้องตรวจ runtime UAT ของเส้นทาง Approval จริง

หลัง import ต้องทดสอบผล Approve จริงอีกครั้ง: Active/New ต้องผ่าน guard และอัปเดตใบงานเดิมเป็น Processing พร้อม Assign ส่วน Recovered/Closed ต้องเข้า historical path และคงสถานะ/owner ไม่เปลี่ยน ผล local tests และ Flow checker ไม่แทน UAT

## ใบงานที่ค้างจาก v3.8.53

อย่า resubmit FIRING run ที่ล้มเหลวเพื่อชดเชย Approval เพราะต้นทางสร้าง Incident และ Work Item แล้ว และการตอบคำขอใหม่/เก่าอาจใช้คนละ definition ต้องตรวจ Approved responder, current Incident state, current VSTS revision และ related work ก่อนซ่อมเฉพาะข้อมูลเดิม เก็บผล Approval และเหตุผลการซ่อมใน audit trail ถ้าฟื้นตัวหรือปิดงานแล้ว ให้เก็บผลย้อนหลัง ไม่เปิดหรือ Assign งานกลับ

Run ที่กำลังรอ Approval ตั้งแต่ v3.8.53 ยังใช้ definition เดิม การนำเข้า v3.8.54 ไม่ได้แก้ run เหล่านั้น ต้องจัดการรายรายการโดยไม่ยกเลิกงานที่ยัง Active แบบเหมารวม

