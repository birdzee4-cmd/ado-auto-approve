# ☁️ ทักษะการเชื่อมต่อ SharePoint & Microsoft Graph — ADO Auto-Approve

คู่มือนี้รวบรวมข้อกำหนดการเขียนโปรแกรมจัดการข้อมูลบน SharePoint Online ผ่าน Microsoft Graph API สำหรับเก็บประวัติการตรวจสอบ (Audit Log) และการตั้งค่าระบบ

---

## 🔑 1. การตรวจสอบสิทธิ์และการจัดการ Access Token

การเข้าใช้ Microsoft Graph API ทำผ่าน Client Credentials Flow (App-Only Permission):

*   **Token Caching:** โค้ดดึง Token ต้องมีระบบแคชค่าลงตัวแปรหน่วยความจำ (`cachedToken`) และคำนวณวันหมดอายุล่วงหน้า (`tokenExpiresAt`) เพื่อไม่ให้ยิงขอ Token ใหม่ในทุกๆ Request (ช่วยลดความหน่วงและลดความเสี่ยงต่อการโดน Rate limit)
*   **Graph Site & List ID:** ให้ทำการใช้รหัส IDs ของ SharePoint Site และ List ที่หาพบในครั้งแรกบันทึกเก็บไว้ในแคช เพื่อลดการร้องขอข้อมูลโครงสร้างรายการบ่อยเกินความจำเป็น

---

## 📊 2. โครงสร้างคอลัมน์ของ SharePoint Audit Log List

เพื่อให้การบันทึกประวัติการตัดสินใจมีมาตรฐานเดียวกัน:

1.  **การตรวจสอบคอลัมน์ระบบอัตโนมัติ (Auto-Create Columns):**
    *   เมื่อเริ่มรัน โค้ดใน [sharepoint-client.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/sharepoint-client.js) จะเช็คโครงสร้างและพยายามสร้างคอลัมน์ที่จำเป็น (เช่น `Build_Status`, `Build_Result`, `Policy_Status`, `Event_Key`) หากตรวจไม่พบในระบบ
    *   สามารถปิดการทำงานนี้ได้ด้วยการระบุแปรสภาพแวดล้อม `SHAREPOINT_AUTO_CREATE_LOG_COLUMNS=false` ในกรณีที่ทีมผู้ดูแลจัดเตรียม List โครงสร้างสมบูรณ์เรียบร้อยแล้วบน SharePoint
2.  **โครงสร้างคอลัมน์หลัก:**
    *   `Title` (ข้อความสรุป action)
    *   `PR_ID` (หมายเลข PR ของ ADO)
    *   `Action` (เช่น Approved, Rejected, External Approved)
    *   `User` (ชื่ออีเมลผู้ทำรายการ)
    *   `Repository` (ชื่อ repo)
    *   `PR_Title` (ชื่อเรื่องของ PR)
    *   `Target_Branch` (เป้าหมาย branch)
    *   `Result` (เช่น Success, Failed)
    *   `Reason` (คำอธิบายเหตุผลหรือสาเหตุประกอบ)
    *   `Event_Key` (คีย์เฉพาะเพื่อใช้จัดระเบียบป้องกันการยิงซ้ำซ้อน)

---

## 🗑️ 3. ระบบ Log Retention & Archive Cleanup

ข้อมูล Log จะเก็บไว้บน List นาน 180 วัน หลังจากนั้นจะถูกจัดเก็บถาวรและลบออก:

*   **กระบวนการจัดเก็บไฟล์ (Archive):**
    *   ระบบจะกรองรายการ Log เก่าตามค่า `retentionDays` และแปลงเป็นไฟล์ CSV
    *   ไฟล์ CSV ต้องบันทึกด้วยฟอร์แมต **UTF-8 BOM** เพื่อป้องกันปัญหาภาษาไทยแสดงเพี้ยนเมื่อนำไปเปิดในโปรแกรม Microsoft Excel
    *   อัปโหลดไฟล์ CSV เข้า SharePoint Document Library โดยแยกจัดเก็บตามรูปแบบโฟลเดอร์ระบุปีและเดือน เช่น `ADO AutoApprove Archive/YYYY/MM/`
*   **การลบข้อมูล (Delete):**
    *   ระบบต้องได้รับการตอบรับสถานะอัปโหลดไฟล์ CSV สำเร็จก่อนเสมอก่อนที่จะทำการวนลบรายการ Log ออกจาก SharePoint List
    *   การทำงานส่วนนี้ถูกจำกัดสิทธิ์โดย `LOG_RETENTION_TOKEN` ป้อนเข้ามาผ่าน API `x-log-retention-token` ในตอนเรียกใช้

---

## ⚙️ 4. การบันทึกค่ากำหนดระบบ (Settings Event)

*   ระบบใช้ SharePoint List เป็นที่จัดเก็บค่าตั้งค่าโหมดอัตโนมัติ (เช่น โหมด auto-approve) ผ่าน Item พิเศษ
*   ระบุด้วย `Event_Key: settings:auto-approve` เพื่อความง่ายในการค้นหาข้อมูล (ไม่ต้องติดตั้งฐานข้อมูล SQL หรือ NoSQL แยกต่างหาก)
