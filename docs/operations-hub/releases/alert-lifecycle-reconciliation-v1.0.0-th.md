# Operations Hub - Alert Lifecycle Reconciliation v1.0.0

## เป้าหมาย

ตรวจหาอีเมล Monitoring สถานะ `RESOLVED` ที่ Flow หลักอาจพลาด และปรับ Alert Lifecycle ใน SharePoint ให้ถูกต้อง โดยไม่เรียก Grafana API และไม่แก้ไข Azure DevOps โดยตรง

## ขอบเขตการทำงาน

1. ทำงานทุก 5 นาที เขตเวลา Asia/Bangkok
2. อ่านอีเมลจากโฟลเดอร์ `AzureAppServiceHigh5xxRateCritical`
3. ค้นหา `RESOLVED` และพิจารณาเฉพาะอีเมลย้อนหลัง 48 ชั่วโมง
4. แยก Alert, Resource, Resolved At และ Message ID จากอีเมล
5. ตรวจ `LastSourceMessageId` เพื่อไม่ประมวลผลอีเมลเดิมซ้ำ
6. จับคู่เฉพาะ Incident ที่มี Alert + Resource ตรงกัน, ยังเป็น FIRING, ยังไม่มี ResolvedAt และ FirstSeenAt ก่อนเวลา resolved
7. ถ้าพบตรงกันหนึ่งรายการ: อัปเดต AlertStatus, ResolvedAt, LastSourceMessageId, LastSyncedAt และ audit fields
8. ถ้าไม่พบหรือพบมากกว่าหนึ่งรายการ: ไม่แก้ข้อมูลและแจ้ง Teams เพื่อให้ตรวจสอบ
9. ไม่สร้าง ไม่ comment และไม่ปิด VSTS; `Operations Hub - VSTS Reconciliation`/Operations API รับช่วงต่อ

## การป้องกันความผิดพลาด

- Concurrency ของลูปเท่ากับ 1 ป้องกันการแข่งขันของอีเมลหลายฉบับ
- Lookback 48 ชั่วโมงทำให้การหยุด Flow ชั่วคราวไม่ทำให้ RESOLVED สูญหาย
- Idempotency จาก Outlook Message ID ทำให้ lookback ทำงานซ้ำได้อย่างปลอดภัย
- ใช้ strict match และหยุดเมื่อ ambiguous แทนการเลือก Incident แบบคาดเดา
- Flow นี้เขียนเฉพาะฟิลด์ lifecycle และคงค่า VSTS, assignee และ related tickets เดิม

## Connections ตอน Import

- Office 365 Outlook: `it-support@buzzebees.com`
- SharePoint: connection ที่เข้าถึงไซต์ `ADOAuto-Approve`
- Microsoft Teams: connection ที่ส่งข้อความไปกลุ่ม `AzureAppServiceHigh5xxRateCritical`

## UAT ก่อนเปิด Production

1. ปิด Flow นี้ไว้หลัง import และ map connections ให้ครบ
2. เลือก Incident ทดสอบหนึ่งใบที่มี AlertStatus = FIRING
3. ใช้อีเมล RESOLVED จริง หรือรอ alert ทดสอบ resolve
4. กด Test/Run แล้วตรวจว่า Incident เดียวเปลี่ยนเป็น RESOLVED และมี ResolvedAt
5. กด Run ซ้ำ ตรวจว่า OccurrenceCount และ audit ไม่เพิ่มซ้ำจาก Message ID เดิม
6. ตรวจกรณี unmatched ว่ามี Teams warning และไม่มี Incident ถูกแก้
7. เปิด Flow และเฝ้าดู Run history อย่างน้อย 24 ชั่วโมง

## เกณฑ์ติดตาม

- Run สำเร็จต่อเนื่องและเวลาแต่ละรอบไม่เกินรอบถัดไป
- จำนวน Waiting resolved ลดลงหลังอีเมล RESOLVED มาถึงภายในประมาณ 5–10 นาที
- ไม่มี Incident ที่ถูก resolve ผิด Resource
- Teams anomaly ต้องถูกตรวจสอบและแก้ mapping/รูปแบบอีเมลก่อนขยายรองรับ alert ประเภทใหม่

## Hotfix v1.0.1

- ประมวลผลเฉพาะอีเมล `CRITICAL / P1` เพราะ Warning/P2 เป็น notification-only และไม่มี Incident ให้จับคู่
- กรณี `NO MATCH` จะไม่ส่งข้อความ Teams เนื่องจากอาจเป็นอีเมลย้อนหลังหรือ Incident ที่ไม่มีอยู่ตามการออกแบบ
- Teams จะแจ้งเฉพาะ `AMBIGUOUS MATCH` เมื่อพบ Incident ที่เป็นไปได้มากกว่าหนึ่งใบและ Flow จะไม่แก้ข้อมูล
