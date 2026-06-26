# 🛠️ ศูนย์รวมคู่มือกฎเกณฑ์และทักษะการพัฒนา (SKILL Registry) — ADO Auto-Approve

ระบบ **ADO Auto-Approve** ถูกขับเคลื่อนด้วยกฎและทักษะเฉพาะในแต่ละเทคโนโลยี เพื่อให้การดูแลรักษาและการพัฒนาโดยมนุษย์และ AI Assistant เป็นไปในแนวทางเดียวกัน เอกสารชุดนี้ถูกจัดแบ่งออกตามความเชี่ยวชาญเฉพาะทาง ดังนี้:

---

## 📚 สารบัญและหัวข้อสกิลเฉพาะด้าน

### 1. 💻 [ทักษะและการพัฒนา JavaScript & Node.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/SKILL-JavaScript.md)

* **ครอบคลุม:** มาตรฐานการเขียน Vanilla JS (ES2017+) บนฝั่ง Client และการจัดการโค้ดบน Azure Functions Node.js 22 (Backend)
* **ประเด็นหลัก:** นโยบาย Zero Dependency, การจัดการ Error แบบ lazy loading / try-catch, และมาตรฐาน JSON/HTTP Status Code Response

### 2. 🎨 [ทักษะการออกแบบและการจัดสไตล์ด้วย CSS](file:///d:/Github/ado-auto-approve/ado-auto-approve/SKILL-CSS.md)

* **ครอบคลุม:** การจัดหน้าตาและ UI/UX ของระบบให้มีความพรีเมียม สวยงาม และ Responsive
* **ประเด็นหลัก:** การเขียน Vanilla CSS เท่านั้น (ห้ามใช้ Tailwind/Bootstrap), การใช้ชุดสี HSL, sleek dark modes, micro-animations, และการทำ Confirm Dialog เพื่อลดข้อผิดพลาด

### 3. ☁️ [ทักษะการเชื่อมต่อ SharePoint & Microsoft Graph](file:///d:/Github/ado-auto-approve/ado-auto-approve/SKILL-SharePoint.md)

* **ครอบคลุม:** การเชื่อมต่ออ่าน/เขียน SharePoint Online Lists และ Drive ผ่าน Microsoft Graph REST API
* **ประเด็นหลัก:** วิธีการดึงและแคช OAuth Client Credentials Token, การสร้างคอลัมน์อัตโนมัติ, การทำงานของ Log Retention Cleanup และการอัปโหลดไฟล์ Archive CSV

### 4. 🚀 [ทักษะการเชื่อมต่อ Azure DevOps REST API](file:///d:/Github/ado-auto-approve/ado-auto-approve/SKILL-AzureDevOps.md)

* **ครอบคลุม:** การดึงข้อมูล PR, การจัดการโหวต, การตั้งค่า Auto-Complete, และการอนุมัติ Classic Release Pipeline
* **ประเด็นหลัก:** ค่าและกลไกการโหวต PR (vote score), Release Approval Pending checking logic, การหลีกเลี่ยงการแก้ไข Worklist และข้อกำหนด Manual Workflow สำหรับ MergeCode

### 5. 🔒 [กฎความปลอดภัยและการควบคุมสิทธิ์ (Security)](file:///d:/Github/ado-auto-approve/ado-auto-approve/SKILL-Security.md)

* **ครอบคลุม:** กฎความปลอดภัยของระบบและการตรวจสอบสิทธิ์การทำรายการ
* **ประเด็นหลัก:** การเช็คสิทธิ์ role `it_support_approve`, การกรอง Target branch (Staging check), การยืนยันสิทธิ์ Token ในการทำงานแบบ Cron job และ Timing Attack Protection

---

## 🛠️ ขั้นตอนการตรวจสอบความพร้อมก่อนส่งโค้ด (Pre-commit checklist)

ก่อนทำการ Push โค้ดใดๆ ขึ้น GitHub โปรดทำการรันคำสั่ง Local Validation ดังต่อไปนี้ใน PowerShell เพื่อตรวจสอบข้อผิดพลาดเบื้องต้น:

```powershell
# 1. ตรวจสอบ syntax ของ JavaScript ฝั่ง Client และ Serverless API
node --check public\core.js
node --check public\dashboard.js
node --check public\activity.js
node --check public\logs.js
node --check public\health.js
node --check public\merge.js
node --check api\list-prs\index.js
node --check api\approve-pr\index.js
node --check api\reject-pr\index.js
node --check api\logs\index.js
node --check api\merge-lookup\index.js

# 2. ตรวจสอบ syntax ไฟล์ config ของ Azure Static Web App
node -e "JSON.parse(require('fs').readFileSync('public/staticwebapp.config.json','utf8')); console.log('SWA public config JSON: OK')"
```

