# แจ้งเตือนเคสที่ RESOLVED แล้วแต่ยังไม่ปิดเกิน 24 ชั่วโมง

API `operations-reconcile` ตรวจ Incident ที่ยังไม่ `CLOSED` ตามรอบของ reconciliation เดิม เมื่อ Monitoring เป็น `RESOLVED` และครบ 24 ชั่วโมงหลังระบบบันทึกการรับ RESOLVED (`LastAlertAt`) จะส่งข้อความ `⏰ Operations Hub: Resolved incident still open after 24 hours` พร้อมลิงก์เข้าเคสบนเว็บ

- ส่งไปที่ `TEAMS_READY_TO_CLOSE_WEBHOOK_URL` เมื่อเปิด `OPERATIONS_READY_TO_CLOSE_NOTIFICATION_ENABLED=true`
- ส่งหนึ่งครั้งต่อ Incident โดยใช้ Audit EventKey `operations-notification:<incidentId>:resolved-open-24h` แยกจากการแจ้ง `🔔 Operations Hub: Incident ready to close`
- ไม่ส่งหาก Incident ถูกปิดแล้ว หรือไม่มีเวลา `LastAlertAt` ที่อ่านได้
- ไม่บังคับว่า Azure DevOps Work Item ทุกใบต้องปิดแล้ว ข้อความจึงระบุให้ตรวจงานก่อนปิดเคส
- เวลาเริ่มนับคือเวลาที่ระบบบันทึกการรับ RESOLVED ซึ่งอาจช้ากว่าเวลาในอีเมล; ไม่ใช้ `ResolvedAt` ของเคสเก่าที่เคยมีความคลาดเคลื่อนของเขตเวลา

การเปลี่ยนนี้อยู่ใน API จึงต้อง deploy API ที่แก้ไขแล้วเพื่อเริ่มทำงาน ไม่ต้อง import Power Automate package เพิ่ม และไม่เปลี่ยนข้อความ `✅ RESOLVED` จาก Flow
