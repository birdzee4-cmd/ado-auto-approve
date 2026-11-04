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

Deployment Events เก็บใน Azure Table `AdoDeploymentEvents` และไม่ถูกลบอัตโนมัติ ข้อมูลเก่ายังคงตรวจสอบได้จาก Azure Table แม้หน้าเว็บจะโหลดข้อมูลเป็นชุดจำกัดต่อครั้ง

## เตรียม Cursor Pagination

การสร้างดัชนีเวลาสำหรับข้อมูลเก่าใช้สคริปต์ `scripts/migrate-deployment-event-index.js` ค่าเริ่มต้นเป็น dry-run:

```text
node scripts/migrate-deployment-event-index.js
```

เมื่อตรวจสอบผลแล้วจึงใช้ `--apply` เพื่อเขียนข้อมูลลง `AdoDeploymentEventIndex` และตั้งค่า `ADO_DEPLOYMENT_EVENT_INDEX_ENABLED=true` หลัง migration สำเร็จ
