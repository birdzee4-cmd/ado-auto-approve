# Operations Hub Incident Automation v3.8.58 — Late approval ADO comment

## การเปลี่ยนแปลง

เมื่อ Incident ถูก RESOLVED แล้วจึงมีการ Approve ภายหลัง ระบบจะทำงานดังนี้:

- assign งาน VSTS ให้ผู้อนุมัติย้อนหลัง
- เพิ่มคอมเมนต์ใน VSTS ระบุว่าเป็นการอนุมัติหลัง Incident RESOLVED
- คง `System.State` ของ VSTS เดิมไว้ ไม่เปิดงานกลับและไม่เปลี่ยนสถานะ
- ยังคงบันทึกผลการอนุมัติย้อนหลังใน SharePoint ตามเดิม

กรณี Reject หรือผลลัพธ์อื่นที่ไม่ใช่ Approve จะบันทึกเฉพาะประวัติใน SharePoint และไม่แก้ไข VSTS

## การป้องกัน

การอัปเดต VSTS ใช้ revision guard (`/rev`) ก่อนเขียน เพื่อป้องกันการเขียนทับข้อมูลที่มีการเปลี่ยนแปลงระหว่างการอ่านและการอัปเดต

แพ็กเกจนำเข้า: `OperationsHub-IncidentAutomationv3.8.58-LateApprovalAdoComment-Import.zip`
