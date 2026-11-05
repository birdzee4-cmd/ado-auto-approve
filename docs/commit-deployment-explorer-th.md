# ตรวจสอบ Commit / เวอร์ชันที่ Deploy

หน้า `deployment.html` เมนูติดตาม PR / CI-CD ใช้ Commit เป็นมุมมองหลัก แสดงหนึ่งแถวต่อ Project + Repository + commit เต็ม ค้นเลขเต็มหรือ prefix 7–40 ตัวอักษร ถ้าพบหลาย commit/repository จะแสดงทุกแถวพร้อมข้อความให้เลือกตรวจ ไม่มีการเลือกผลแรกแทนผู้ใช้

## แหล่งข้อมูล

- ค่าเริ่มต้นอ่าน Azure DevOps ของ `oceanlife-web-stg` อัตโนมัติผ่าน delegated connection ของผู้ใช้เมื่อเปิดเมนู ไม่ใช้ PAT แทนเมื่อ connection ใช้ไม่ได้
- เลือกอ่านล่าสุดอย่างละ 20 หรือ 100 Builds/Releases ได้ ไม่อ้างว่าครบประวัติทั้งหมด หากค้นไม่พบจะแจ้งขอบเขตที่อ่าน
- เลือก Events ที่เก็บไว้เพื่อดู commit ของ Project อื่นได้ โดยไม่นำข้อมูลจำลองเข้า storage โปรเจกต์ที่ต้องการ live history เพิ่มต้องยืนยัน CI/CD mapping ก่อน
- API เดิมเพิ่ม query `commit` และ `limit=20|100` สำหรับ live history ตรวจ role ก่อนอ่าน token และไม่คืน token ใน response ข้อมูลส่วนบุคคลใช้เฉพาะ scope ที่ระบบอนุญาตเดิม

## ความหมายตัวเลขและสถานะ

- Builds นับ Project/Pipeline/Run ID ไม่ซ้ำ แยกจาก Pipeline stages และ Hook Events
- Deploy attempts นับเฉพาะ Classic Release ที่เชื่อม commit ได้จาก artifact จริง ไม่ถือว่า YAML stage ทุกอันเป็น CD โดยอัตโนมัติ
- “ยังไม่ตรวจสอบ” หมายถึงแหล่งข้อมูล/Environment ยังไม่ถูกตรวจ “ไม่พบในประวัติที่อ่าน” ใช้เฉพาะ Environment ที่ตรวจแล้วและไม่พบข้อมูลในขอบเขตนั้น
- “ล่าสุดที่ Deploy สำเร็จ” เทียบภายใน Pipeline/Environment/Stage ของประวัติที่อ่าน ไม่ยืนยันเวอร์ชัน runtime หรือปิดบังการพยายาม Deploy ที่ fail ภายหลัง ดูรายละเอียดเพื่อไล่ทุก attempt
- STG/PRD ที่มี commit เดียวกันยังอาจเป็นคนละ Build แสดงผลเทียบ Build artifact ID เพิ่ม ไม่มีข้อมูล image digest จึงไม่อ้างว่าตรวจ image content ผ่านแล้ว
- PR ใช้ merge commit ที่ตรงกัน ไม่จับจากชื่อ/PR ล่าสุด ข้อความ commit อ่านผ่าน Git Commit API เมื่อค้นเจอ commit เดียวใน repository ที่เลือก ([Microsoft API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/commits/get?view=azure-devops-rest-7.1))

ทดสอบครอบคลุมหลาย Build ต่อ commit, artifact ต่าง Build, prefix ชน, repository scope, Pipeline stage ไม่นับเป็น Deploy, สถานะล่าสุดที่สำเร็จ, delegated token/validation และ regression เดิม
