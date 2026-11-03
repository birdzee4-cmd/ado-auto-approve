# Alert Lifecycle Reconciliation v1.0.11 — First Seen guard

## สิ่งที่ตรวจพบ 19 ตุลาคม 2026

- ภาพ Teams แสดงการสร้าง INC-2026-000324 (High5xxRateCritical, Work Item 892972) แต่ข้อความ ready to close อ้าง INC-2026-000323 (5xxCountCritical, Work Item 892970) เป็นคนละ alert แม้ resource เดียวกัน
- อ่าน SharePoint แบบ read-only พบเคส 324 ถูกเขียน RESOLVED ด้วยเหตุการณ์เก่า: FirstSeenAt `2026-10-19T04:39:00Z`, ResolvedAt `2026-10-19T03:29:00Z` ซึ่งอยู่ก่อน First Seen 70 นาที
- ReceivedAt ของเคส 324 คือ `2026-10-19T11:39:36Z` แต่ LastAlertAt คือ `2026-10-19T10:29:37Z` ยืนยันว่า recovery ที่ใช้เก่ากว่าเวลารับเคส
- ขณะตรวจ เคส 323 มี recovery ใหม่ LastAlertAt `2026-10-19T11:44:56Z` จึงไม่ควรสรุปว่า 323 ยังไม่ฟื้นจากภาพก่อนหน้านั้นเพียงอย่างเดียว
- เวลา FirstSeenAt/ResolvedAt ที่ Flow บันทึกใน SharePoint มีความคลาดจากเวลารอบเหตุการณ์ 7 ชั่วโมงอยู่แล้ว จึงไม่แก้ประวัติทั้งหมดโดยบวกเวลาหรือเดา timezone

## สาเหตุและการแก้ไข

Flow v1.0.10 ใช้ Title + Resource + FIRING + FirstSeenAt < ResolvedAt เรียง FirstSeenAt ล่าสุดและเลือก `$top=1` โดยไม่ได้เทียบ First Seen ของอีเมล recovery กับรอบเหตุการณ์ ทำให้อีเมลเก่าในช่วงย้อนหลัง 7 วันจับเคสใหม่ได้เมื่อเวลาที่เก็บคลาด timezone

v1.0.11 อ่าน First Seen จากอีเมลเต็ม สร้าง deterministic IncidentId ด้วย expression เดียวกับ Incident Automation และจับคู่ IncidentId + Alert + Resource เท่านั้น ตรวจว่า recovery อยู่หลัง First Seen ของอีเมล ไม่ใช้เวลารับอีเมลหรือ utcNow แทนเวลาที่อ่านไม่ได้ ขอผลลัพธ์ 2 รายการและยอมรับเฉพาะพบ 1 เคส เพื่อหยุดกรณีกำกวม

Backend เพิ่ม guard ป้องกัน automatic Tier1 closure, standard incident closure และ ready-to-close/24-hour notification เมื่อ ResolvedAt <= FirstSeenAt หรือ LastAlertAt < ReceivedAt สำหรับข้อมูลเก่าไม่มี timestamp ยังคง behavior เดิม ส่วน API ingest ไม่ให้ IncidentId ข้ามการตรวจ First Seen และไม่ยอมรับวันที่เสีย

## การนำไปใช้

1. Import `artifacts/power-automate/OperationsHub-AlertLifecycleReconciliationv1.0.11-FirstSeenGuard-Import.zip` และตรวจ connection ของ flow ก่อนเปิดใช้แทน reconciliation เดิม ห้ามเปิดทั้งสองเวอร์ชันพร้อมกัน
2. Deploy API changes ใน `operations-alert-service.js`, `operations-service.js`, และ `operations-reconcile/index.js` ผ่านกระบวนการ deploy ปกติ
3. ตรวจ event ล่าสุดของ 323/324 ก่อนซ่อมสถานะ ห้าม reopen หรือปิด Work Item จากภาพเก่าเพียงอย่างเดียว และไม่แก้ historical FirstSeenAt แบบเหมารวม

การทำงานครั้งนี้ไม่ได้ import/deploy, ส่ง Teams, restart App Service หรือแก้ข้อมูล production

## Validation

- สแกน ZIP ทั้ง import/export ใต้ artifacts/power-automate: baseline สูงสุด 1.0.10; เวอร์ชันใหม่ 1.0.11
- ตรวจ filename, package display name, flow display name, contentVersion `1.0.11.0`, JSON ทั้ง ZIP, exact lookup, ambiguity guard และ runAfter dependencies ผ่าน
- API tests ที่รัน 50 รายการ: ผ่าน 48; 2 failures เรื่อง App Support description เป็นปัญหาเดิม ตรวจเทียบ HEAD ของทั้ง service/reconcile แล้วยืนยัน 2 failures เดิม
- Regression tests ใหม่ครอบคลุม explicit ID กับ First Seen คนละรอบ, invalid date, stale recovery ของเคส 324, receipt-order guard และ recovery ใหม่ที่ถูกต้อง
- SHA256: `27EC64D2F2118813C64574C58E03C243710D4DBE1599E9CBBADBDFA62A7122D3`
