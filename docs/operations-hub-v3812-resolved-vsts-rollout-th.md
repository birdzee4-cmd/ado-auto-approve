# Operations Hub Incident Automation v3.8.12

## การเปลี่ยนแปลง

- เมื่อพบอีเมล `RESOLVED` ที่จับคู่กับ Incident เดิม ระบบเพิ่ม Comment ใน Primary/Tier 1 VSTS Work Item
- ถ้าไม่มี Related Work Item หรือ Related ทุกใบอยู่ในสถานะปิด ระบบเปลี่ยน Tier 1 เป็น `Closed`
- ถ้ายังมี App Support หรือ Tier 2 เปิดอยู่ ระบบคง Tier 1 ไว้และให้ Reconciliation ตรวจซ้ำในรอบถัดไป
- การ Comment/Close VSTS ล้มเหลวจะไม่ขวางการอัปเดต SharePoint และ Teams notification เดิม
- Reconciliation API จะปิด Tier 1 เมื่อ Alert เป็น `RESOLVED` และ Related ปิดครบ พร้อมบันทึก Audit `AUTO_CLOSE_TIER1_AFTER_RESOLVED`
- Operations Hub Incident ยังคงต้องให้ผู้ใช้กด `Close Incident` เอง

## ขั้นตอนนำขึ้นระบบ

1. Import `artifacts/power-automate/OperationsHub-IncidentAutomation-v3.8.12.zip`
2. เลือก Update existing หรือสร้าง Flow ใหม่ตามขั้นตอน UAT ปัจจุบัน
3. Map connection เดิมของ Outlook, SharePoint, Teams, Approvals และ Azure DevOps
4. Turn on v3.8.12
5. Turn off v3.8.10 หลังยืนยันว่า v3.8.12 เปิดสำเร็จ เพื่อป้องกันอีเมลถูกประมวลผลสอง Flow

## UAT ที่แนะนำ

1. Incident มีเฉพาะ Tier 1: ส่ง RESOLVED แล้วตรวจว่ามี Comment และ Tier 1 เป็น Closed
2. Incident มี Related ที่ยังเปิด: ส่ง RESOLVED แล้วตรวจว่ามี Comment แต่ Tier 1 ยังไม่ปิด
3. ปิด Related ทุกใบ: รอ Reconciliation รอบ 5 นาที แล้วตรวจว่า Tier 1 ถูกปิด
4. ตรวจหน้า Operations Hub ว่า Alert เป็น RESOLVED และแสดง READY TO CLOSE เมื่อทุกใบปิด
5. กด Close Incident ด้วยผู้ใช้เพื่อจบ lifecycle

## Rollback

- Turn off v3.8.12
- Turn on v3.8.10
- การเปลี่ยนกลับไม่ลบ Comment หรือย้อน State ของ VSTS ที่ถูกปิดไปแล้ว
