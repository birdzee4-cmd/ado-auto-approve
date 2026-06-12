# 💻 ทักษะและการพัฒนา JavaScript & Node.js — ADO Auto-Approve

คู่มือนี้รวบรวมข้อกำหนดและแนวทางปฏิบัติสำหรับการเขียนโปรแกรมด้วย JavaScript ทั้งฝั่งไคลเอนต์ (Frontend Browser) และฝั่งเซิร์ฟเวอร์ (Azure Functions Backend Node.js 22) ในระบบ ADO Auto-Approve

---

## 🌐 1. มาตรฐาน JavaScript ฝั่ง Frontend (Browser)

ไฟล์ JavaScript ฝั่ง Frontend ถูกแยกออกตามหน้าที่การทำงาน (เช่น [public/core.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/core.js), [public/dashboard.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/dashboard.js)) มีข้อกำหนดดังต่อไปนี้:

*   **Vanilla JS (ES2017+):** เขียนด้วย JavaScript มาตรฐาน ไม่ใช้เฟรมเวิร์กอย่าง React, Vue, Angular หรือไลบรารีดั้งเดิมอย่าง jQuery
*   **Asynchronous Operations:** การดึงข้อมูลจาก API ต้องใช้คำสั่ง `fetch` ร่วมกับ `async/await` ห้ามบล็อกการเรนเดอร์ของเบราว์เซอร์
*   **Dynamic DOM Updates:** เมื่อเรียกใช้ API เช่นการอนุมัติสำเร็จ หรือรีเฟรช Queue ระบบต้องทำการเลือกและปรับปรุง Element ในหน้าเว็บเฉพาะจุด (ห้ามสั่ง reload หน้าเว็บทั้งหมดหากไม่จำเป็น)
*   **Error Handling on UI:** ทุกการเรียก Fetch API ต้องมีส่วน `catch` เพื่อแจ้งเตือนข้อผิดพลาดให้ผู้ใช้ทราบบนหน้าจออย่างเป็นมิตร (ไม่ควรแสดง stack trace ใน alert)

---

## 💻 2. มาตรฐาน JavaScript ฝั่ง Backend (Azure Functions Node.js 22)

การจัดการระบบหลังบ้านในโฟลเดอร์ [api/](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/) มีความเฉพาะเจาะจงกับสภาพแวดล้อม Serverless:

### 2.1 นโยบาย Zero External Dependencies
*   ห้ามติดตั้งไลบรารีภายนอก (npm modules) ลงใน [api/package.json](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/package.json) หากไม่จำเป็นอย่างยิ่งยวด
*   **วิธีเรียกใช้อินเทอร์เน็ต/API ภายนอก:** ให้ใช้โมดูลในตัวของ Node.js คือ `const https = require('https')` และสร้าง Promise ครอบเป็นฟังก์ชันส่ง HTTP requests
*   **เหตุผล:** เพื่อรักษาขนาดของแอปพลิเคชันให้เล็กที่สุด ส่งผลให้ขั้นตอน cold start ของ Azure Functions ทำงานได้อย่างรวดเร็ว

### 2.2 Lazy Loading & Defensive Coding
เพื่อป้องกันไม่ให้ระบบล่มในกรณีที่โหลดบางไฟล์ไม่สำเร็จ หรือการดึงโมดูลทำงานผิดปกติ:
*   ให้ทำการ `require` โมดูลร่วม (Shared modules) แบบไดนามิก (Lazy require) หรือใส่ไว้ภายใน try-catch 
*   **ตัวอย่างโครงสร้างโค้ดปลอดภัย:**
    ```javascript
    let adoClient;
    try {
      adoClient = require('../shared/ado-client');
    } catch (e) {
      // ป้องกันการล่มขณะโหลดไฟล์ ให้ไปแจ้งเตือนเมื่อฟังก์ชันถูกเรียกใช้แทน
    }
    ```

### 2.3 มาตรฐานการตอบกลับ JSON (API Response Standard)
*   ทุกๆ Endpoint ต้องส่ง Response Header `Content-Type: application/json` เสมอ
*   **เมื่อสำเร็จ (Success Response):**
    ```json
    {
      "ok": true,
      "data": { ... } // หรือข้อมูลอื่น ๆ ที่เกี่ยวข้อง
    }
    ```
*   **เมื่อล้มเหลว (Error Response):**
    ```json
    {
      "ok": false,
      "error": "ข้อความภาษาไทยอธิบายรายละเอียดความผิดพลาดให้ผู้ใช้เห็นบน UI",
      "code": "ERROR_CODE_EN" // สำหรับระบบใช้อ้างอิง
    }
    ```

### 2.4 การใช้งาน HTTP Status Codes
Backend ต้องระบุ HTTP Status Code ให้ถูกต้องตามลักษณะเหตุการณ์:
*   `200 OK`: สำหรับทุกการเรียกอ่านข้อมูล หรือการจัดการสำเร็จ
*   `400 Bad Request`: สำหรับเคสที่ข้อมูลส่งมาจาก Client ไม่ถูกต้องตามข้อกำหนด (เช่น ความเห็นของ Reject สั้นกว่า 3 ตัวอักษร)
*   `401 Unauthorized`: สำหรับกรณีตรวจไม่พบประวัติการ Login หรือ session หลุด
*   `403 Forbidden`: สำหรับกรณีผู้ใช้ Login แล้วแต่ไม่มี Role `it_support_approve` ในการทำ action ที่มีผลต่อระบบ
*   `500 Internal Server Error`: สำหรับความล้มเหลวของการต่อเชื่อมฐานข้อมูล/API ภายนอกที่นอกเหนือการควบคุม
