# 🔒 กฎความปลอดภัยและการควบคุมสิทธิ์ — ADO Auto-Approve

เอกสารนี้ระบุข้อกำหนดทางด้านความปลอดภัยและการยืนยันตัวตนทั้งหมดในระบบ ADO Auto-Approve นักพัฒนาทุกคนจำเป็นต้องปฏิบัติตามมาตรฐานเหล่านี้เพื่อป้องกันช่องโหว่และการดำเนินงานที่ผิดพลาด

---

## 👥 1. ระบบยืนยันตัวตนและบทบาทผู้ใช้ (RBAC)

*   **Entra ID Integration:** ระบบเชื่อมต่อเข้ากับ Microsoft Entra ID (Azure AD) ผ่าน Static Web Apps Authentication
*   **Role Validation (`it_support_approve`):**
    *   สำหรับ API Endpoint ที่มีการเปลี่ยนแปลงสถานะข้อมูลบน Azure DevOps ([approve-pr](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/approve-pr/), [reject-pr](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/reject-pr/), [approve-release](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/approve-release/)) ต้องมีโค้ดตรวจสอบบทบาทผู้ใช้ (Role checking) เสมอ
    *   ดึงรายละเอียดบทบาทจาก Header `x-ms-client-principal` หากผู้ใช้ไม่มีสิทธิ์ในกลุ่มบทบาท `it_support_approve` ระบบต้องตอบกลับเป็น `403 Forbidden` ทันทีและปฏิเสธการดำเนินการทุกกรณี
*   **Fallback Display:** ในหน้า Frontend หากตรวจพบว่าผู้ใช้ไม่มีสิทธิ์ในการอนุมัติ ให้ทำการซ่อนปุ่มดำเนินการทั้งหมดบนเว็บ แต่ยังให้แสดงรายละเอียดหน้า PR เพื่อช่วยอำนวยความสะดวกในการตรวจสอบ

---

## 🎯 2. กฎการตรวจสอบ Target Branch (Branch Protection)

*   **Staging Lock:** โค้ด Backend ต้องมีเงื่อนไขตรวจสอบ Branch ปลายทางของ PR
*   **เงื่อนไข:** อนุญาตเฉพาะ PR ที่มีปลายทางเป็น `refs/heads/staging` (หรือ Branch ที่ระบุตาม Environment Variable `STAGING_BRANCH_REF` เท่านั้น)
*   **การปฏิเสธการทำรายการ:** หากผู้ใช้พยายามเรียกอนุมัติ PR ที่มีเป้าหมาย Branch เป็น Branch อื่นๆ (เช่น `refs/heads/main` หรือ `refs/heads/master`) Backend จะต้องขัดขวางและตอบกลับรหัส `403 Forbidden` เสมอ เพื่อลดความเสี่ยงที่โค้ดส่วนอื่นที่ไม่เหมาะสมจะถูกผสานโดยไม่ได้ตั้งใจ

---

## 🛡️ 3. การล็อก API ที่ทำงานเบื้องหลัง (Cron & Token Authorization)

สำหรับ API Endpoints ที่เรียกใช้ผ่าน Logic Apps หรือตัวตั้งเวลาอัตโนมัติ:

*   **Token Verification:**
    *   Endpoint ของ [daily-summary](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/daily-summary/), [exception-scan](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/exception-scan/) และ [log-retention-cleanup](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/log-retention-cleanup/) จะต้องตรวจเช็ค Token ความปลอดภัยใน Header ทุกครั้งที่มีการเรียกใช้
    *   ตรวจสอบคีย์ผ่าน:
        *   `x-daily-summary-token` สำหรับการสรุปประจำวัน
        *   `x-exception-scan-token` สำหรับการแกะดูประวัติ exception
        *   `x-log-retention-token` สำหรับสิทธิ์จัดการลบข้อมูลเก่า
    *   *ระบบสำรอง (Fallback):* หากไม่ได้ตั้งค่า token เฉพาะ ให้ระบบสำรองกลับไปตรวจสอบกับ `DAILY_SUMMARY_TOKEN` เสมอ
*   **การเชื่อมต่อภายนอก (Webhook Auth):**
    *   หากมีการเชื่อมต่อ Endpoint [webhook](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/webhook/) ด้วย Basic Auth จะต้องใช้การเปรียบเทียบรหัสผ่านแบบคงที่โดยประเมินเวลาในการทดสอบ (Constant-time string comparison) เพื่อป้องกันความปลอดภัยต่อการทำ Timing Attack

---

## ⛔ 4. ข้อจำกัดห้ามแก้ไข Worklist บน ADO

*   ระบบห้ามทำการเข้าไปแก้ไขหรือเปลี่ยนสถานะการทำงานของ Work Items / Tasks บน Azure DevOps ทุกกรณี
*   ต้องระบุค่าพารามิเตอร์ `"transitionWorkItems": false` เสมอในส่วนของการส่งข้อมูล Auto-Complete
