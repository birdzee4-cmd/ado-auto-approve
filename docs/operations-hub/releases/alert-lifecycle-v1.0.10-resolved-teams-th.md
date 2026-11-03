# Alert Lifecycle Reconciliation v1.0.10

แพ็กเกจ: `artifacts/power-automate/OperationsHub-AlertLifecycleReconciliationv1.0.10-ResolvedTeams-Import.zip`

Flow หลัก Incident Automation v3.8.45 รับอีเมลจากโฟลเดอร์ `NowAlert_AppService` ส่วน Flow ตามเก็บ RESOLVED v1.0.9 อ่านโฟลเดอร์ `AzureAppServiceHigh5xxRateCritical` และอัปเดต Incident โดยไม่ได้ส่งข้อความ Teams จึงอาจเห็นเพียง `Operations Hub: Incident ready to close` หลังสถานะเปลี่ยนเป็น RESOLVED

v1.0.10 เพิ่มข้อความ `✅ RESOLVED` ใน Group chat เดิมทันทีหลัง `Update_Matching_Incident_RESOLVED` สำเร็จ โดยแสดง Alert, Severity/Priority, Resource, Subscription, Resource Group, Plan, Default Host, First Seen และ Resolved At ตามเวลาไทย การแจ้ง FIRING, P1 incident created, acknowledged และ ready to close ยังคงใช้ Flow เดิม

ก่อนนำเข้า ให้เลือกอัปเดต Flow `Operations Hub - Alert Lifecycle Reconciliation` และตรวจสอบการเชื่อมต่อ Outlook, SharePoint และ Teams รวมถึง Group chat ปลายทาง จากนั้นทดสอบอีเมล RESOLVED ใหม่หนึ่งเหตุการณ์และตรวจ Run history ว่า `Post_RESOLVED_to_Teams` สำเร็จ ข้อความของเหตุการณ์เก่าจะไม่ถูกส่งย้อนหลังหากระบบบันทึกว่าอีเมลนั้นประมวลผลแล้ว
