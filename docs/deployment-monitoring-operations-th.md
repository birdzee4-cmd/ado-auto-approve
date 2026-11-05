# Deployment Monitoring Operations Runbook

## ตรวจสอบข้อมูลล่าสุด

1. เปิดหน้า `deployment.html` และเข้าสู่ระบบด้วย Azure AD
2. ตรวจสอบจำนวน Total, Succeeded, Failed, CI Build และ CD
3. ใช้ Environment filter เพื่อเลือก Development, Staging หรือ Production
4. ใช้ Source filter เพื่อแยก CI Build, YAML CD และ Classic CD
5. กด `View` เพื่อดู Run, Branch, PR, Operator และลิงก์ Azure DevOps

## ค้นหาข้อมูลย้อนหลัง

- ใช้ `From date` และ `To date` เพื่อค้นหาช่วงวันที่
- ใช้ Result filter เพื่อค้นหา Succeeded, Failed หรือ Unknown
- ข้อมูลถูกกรองที่ Backend ก่อนส่งให้หน้าเว็บ
- หน้าเว็บใช้ cursor pagination ครั้งละ 50 รายการ จึงไม่โหลดข้อมูลทั้ง archive ในครั้งเดียว
- ปุ่ม ก่อนหน้า/ถัดไปจะอ่าน cursor จากผลลัพธ์ล่าสุด ทำให้ค้นข้อมูลจำนวนมากได้โดยไม่ใช้ offset ที่ช้าลงตามจำนวนแถว
- ปุ่ม Refresh จะโหลดข้อมูลใหม่ และหน้าเว็บจะ refresh อัตโนมัติทุก 60 วินาที

## ตรวจสอบกรณี Build ล้มเหลว

1. เลือก Result เป็น `Failed`
2. เปิดรายการที่ต้องการตรวจสอบ
3. ตรวจสอบ PR และลิงก์ Pipeline
4. หากมี Build สำเร็จภายหลังของ PR เดียวกัน ระบบจะแสดง `แก้ไขแล้ว`
5. หากยังไม่พบ Build สำเร็จ ระบบจะแสดง `ยังไม่พบ Build สำเร็จ`

## เมื่อข้อมูลไม่เข้าเว็บ

1. ตรวจสอบ History ของ Service Hook ใน Azure DevOps
2. ตรวจสอบว่า Hook ส่งสำเร็จและไม่พบ HTTP 401/403/5xx
3. ตรวจสอบ Basic Authentication หรือ `X-ADO-Webhook-Token`
4. ตรวจสอบว่า `ADO_DEPLOYMENT_EVENTS_ENABLED=true`
5. กด Refresh และตรวจสอบ date range/filter ที่เลือก

## การเก็บข้อมูล

Deployment Events เก็บใน Azure Table `AdoDeploymentEvents` และไม่ถูกลบอัตโนมัติ ข้อมูลเก่ายังคงตรวจสอบได้จาก Azure Table แม้หน้าเว็บจะโหลดข้อมูลเป็นชุดจำกัดต่อครั้ง ดัชนีสำหรับการแสดงผลอยู่ใน `AdoDeploymentEventIndex` และระบบเขียนข้อมูลใหม่ลงทั้งสองตาราง

## ตรวจสอบ Cursor Pagination

การสร้างดัชนีเวลาสำหรับข้อมูลเก่าใช้สคริปต์ `scripts/migrate-deployment-event-index.js` ค่าเริ่มต้นเป็น dry-run หากมีข้อมูลเก่าที่ต้องนำเข้าดัชนี:

```text
node scripts/migrate-deployment-event-index.js
```

ใน Production ปัจจุบันสร้าง `AdoDeploymentEventIndex` แล้วและเปิด `ADO_DEPLOYMENT_EVENT_INDEX_ENABLED=true` เรียบร้อย เนื่องจากเริ่มจากตารางว่างจึงไม่ต้อง migration ข้อมูลเก่า หากมีการกู้คืน archive หรือเติมข้อมูลย้อนหลัง ให้รัน dry-run ตรวจจำนวนก่อน แล้วจึงใช้ `--apply` โดยมี backup/record ของผลการทำงานทุกครั้ง

หากหน้าเว็บไม่พบข้อมูล ให้ตรวจตามลำดับนี้:

1. ตรวจ Service Hook History ว่ารายการส่งสำเร็จ
2. ตรวจ Function App logs ว่า webhook ตอบ HTTP 200 และไม่มีข้อความเขียน index ล้มเหลว
3. ตรวจ app settings ว่า index flag และชื่อตารางตรงกับด้านบน
4. กด Refresh หลังตรวจ filter และช่วงวันที่

## Export ข้อมูล

- ตั้งค่า Environment, Source, Result และช่วงวันที่ตามที่ต้องการ
- กด `Export CSV` ระบบจะดาวน์โหลดไฟล์ `deployment-events.csv` ตาม filter ปัจจุบัน
- หากดาวน์โหลดไม่ได้ ให้ตรวจสิทธิ์หน้าเว็บและตรวจว่า API ตอบกลับสถานะ 200

## ตรวจข้อความ Teams ซ้ำ

- PR notification ใช้ Event ID เป็น `eventKey` สำหรับป้องกันการส่งซ้ำ
- หาก Azure DevOps ส่ง Event เดิมซ้ำ ระบบจะบันทึกและส่ง Teams เพียงครั้งเดียว
- ห้ามลบ Service Hook จากภาพข้อความเพียงอย่างเดียว ให้ตรวจ History ของ Hook และ Event ID ก่อน
