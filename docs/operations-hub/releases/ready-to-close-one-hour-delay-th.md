# Ready to close: รอ 1 ชั่วโมงก่อนแจ้งครั้งแรก

ปรับ `api/operations-reconcile/index.js` ให้บันทึก Audit `RECONCILIATION_NOTIFICATION_SCHEDULED` เมื่อ reconciliation พบครั้งแรกว่า monitoring เป็น RESOLVED และ Work Item ทุกใบอยู่ในสถานะปลายทาง แต่ Incident ใน Operations Hub ยังไม่ CLOSED

- ไม่ส่ง Teams ทันที โดยกำหนดเวลาแจ้งครั้งแรกเป็นเวลา Audit + 1 ชั่วโมง
- รอบ reconciliation ก่อนครบเวลาจะใช้กำหนดเวลาเดิม ไม่เลื่อนออกไปทุกครั้ง และอ่านกำหนดเวลาเดิมได้หลัง API restart
- เมื่อครบเวลา จะส่งในรอบ reconciliation ถัดไป เฉพาะเมื่อ Incident ยังเข้าเงื่อนไขพร้อมปิดและยังไม่ CLOSED
- ใช้ EventKey แจ้งสำเร็จเดิมเพื่อป้องกันส่งซ้ำ ส่วน Audit กำหนดเวลาใช้ suffix `:scheduled` แยกกัน
- Dry run แสดง scheduledAt, dueAt และ due โดยไม่บันทึก Audit
- การแจ้งเตือน RESOLVED ค้างเปิด 24 ชั่วโมงยังใช้เงื่อนไขเดิม

Incident ที่เคยส่ง ready-to-close สำเร็จแล้วจะไม่ส่งใหม่ ส่วน Incident ที่ยังไม่เคยส่งจะเริ่มนับจากรอบที่ตรวจพบหลัง deploy

ต้อง deploy API เพื่อเปิดใช้การเปลี่ยนแปลงนี้ ไม่ต้อง import Power Automate ZIP ใหม่ เนื่องจากจุดส่งข้อความอยู่ใน API

ตรวจสอบด้วย unit tests สำหรับกำหนดเวลา การไม่ส่งก่อนครบเวลา การส่งเมื่อครบเวลา การปิดระหว่างรอ การไม่ส่งซ้ำ และ dry run
