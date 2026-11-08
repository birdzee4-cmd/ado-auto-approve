# Operations Hub Incident Automation v3.8.59 — RESOLVED reconciliation API

เมื่อ Flow ได้รับอีเมล `RESOLVED` และพบ Incident ที่ตรงกัน ระบบจะ:

1. อัปเดต Incident ใน SharePoint เป็น `RESOLVED`
2. เรียก `POST /api/operations-reconcile` โดยระบุ Incident ID และ scope `PRIMARY`
3. ให้ API อ่านสถานะล่าสุดของ Work Item และตรวจสอบเงื่อนไขก่อนดำเนินการ
4. ให้ API เพิ่มคอมเมนต์ RESOLVED และปิด Work Item หลักเมื่อผ่านเงื่อนไข

การเรียก API มี retry แบบ exponential 2 ครั้ง และ Teams notification จะทำงานต่อแม้ API ล้มเหลว เพื่อให้เห็นผลการทำงานและตรวจสอบย้อนหลังได้

หลัง Import ต้องกำหนดค่า `operationsAutomationKey` ให้ตรงกับ `OPERATIONS_AUTOMATION_KEY` ของ API ก่อนเปิดใช้งาน Flow

แพ็กเกจ: `OperationsHub-IncidentAutomationv3.8.59-ResolvedReconcileAPI-Import.zip`
