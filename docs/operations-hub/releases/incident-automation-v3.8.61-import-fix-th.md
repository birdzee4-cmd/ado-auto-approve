# Operations Hub Incident Automation v3.8.61 — Import fix

แพ็กเกจ v3.8.60 มีโครงสร้าง `runAfter` ที่ Power Automate ไม่ยอมรับตอน Import เนื่องจากอ้างอิง Action คนละระดับของ Scope

v3.8.61 แก้โครงสร้างดังกล่าวแล้ว โดยคงพฤติกรรมเดิม:

- duplicate `RESOLVED` จะเรียก `/api/operations-reconcile`
- ตรวจสถานะ Work Item ก่อนดำเนินการ
- ไม่สร้าง Work Item หรือคอมเมนต์ซ้ำ
