# Incident Automation v3.8.49 — แก้การจับคู่ RESOLVED

วันที่ 15 ตุลาคม 2026 ตรวจ Run history ของ `Operations Hub - Incident Automation v3.8.47` สำหรับเมล `✅ RESOLVED AzureAppServiceHigh5xxRateCritical | App=prd-module-rider-new` เวลา 10:44 น. พบว่า `Get_items_by_SourceMessageId` คืนค่า 0 (ไม่ใช่เมลซ้ำ) แต่ `Get_latest_open_FIRING` ก็คืนค่า 0 และ `Post_RESOLVED_to_Teams` ถูก Skipped ด้วย `ActionBranchingConditionNotSatisfied`

ตัวกรองที่รันจริงใช้ `Metric eq ''` เนื่องจากเมล RESOLVED ไม่มีฟิลด์ Metric ในขณะที่ Incident เดิมของ INC-2026-000308 มี `Http5xxRate` จึงจับคู่ไม่สำเร็จ แม้ Operations Hub จะถูกอัปเดตเป็น Recovered จากเส้นทางอื่น

แพ็กเกจ `OperationsHub-IncidentAutomationv3.8.49-ResolvedCorrelation-Import.zip` ต่อจาก v3.8.48 โดยเลิกใช้ Metric สำหรับเมล RESOLVED และจับคู่ด้วย Alert, Resource, Environment, ADO Work Item, สถานะ FIRING/RESOLVED และ First Seen ภายใน ±1 นาทีจากอีเมล จำกัดผลลัพธ์หนึ่งรายการและเลือกเวลาล่าสุดก่อน Resolved At จากนั้นส่ง `✅ RESOLVED` ทันทีหลังอัปเดต Incident สำเร็จ

ตรวจ ZIP แล้วมี 5 รายการ ชื่อแพ็กเกจ Flow resource และ `contentVersion` เป็น v3.8.49 ตรงกัน การตรวจนี้ยังไม่ใช่ผลทดสอบจริงใน Power Automate หลัง import ให้ Update Flow v3.8.48 เดิม เลือก connection ทั้ง 6 รายการ แล้วตรวจ Run history ของเมล P1 RESOLVED ใหม่ว่า `Get_latest_open_FIRING` พบ Incident เดียว, `Update_matching_incident_RESOLVED` และ `Post_RESOLVED_to_Teams` สำเร็จ
