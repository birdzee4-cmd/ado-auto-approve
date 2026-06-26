# 🚀 ทักษะการเชื่อมต่อ Azure DevOps REST API — ADO Auto-Approve

คู่มือนี้กำหนดมาตรฐานและกลไกในการคุยกับ Azure DevOps REST API เพื่อดึงสถานะ ตรวจสอบความถูกต้อง และอนุมัติการทำงานต่างๆ ในโปรเจกต์ ADO Auto-Approve

---

## 🔑 1. การร้องขอข้อมูลและจัดการสิทธิ์ผ่าน PAT

*   **Authentication:** ใช้ Personal Access Token (PAT) ที่มีสิทธิ์เฉพาะทางในการเขียนอ่านรหัสและทำงานร่วมกับ Release Pipeline
*   **Security Control:** สิทธิ์ของ PAT ต้องจำกัดขอบเขต (Scope) ไว้แคบที่สุดเท่าที่เป็นไปได้:
    *   `Code (Read & Write)` สำหรับจัดการ Pull Requests
    *   `Release (Read, Write & Manage)` สำหรับตรวจสอบและอนุมัติ Classic Release Pipelines
    *   *ข้อห้าม:* **ห้ามให้สิทธิ์จัดการ Work Items** เพื่อความปลอดภัยและเป็นไปตามข้อตกลงของโปรเจกต์

---

## 🗳️ 2. มาตรฐานการโหวต Pull Request & Auto-Complete

การอัปเดตสถานะของ PR บน Azure DevOps จะต้องทำผ่านคำสั่ง REST API ตามรูปแบบมาตรฐาน:

*   **Reviewer Vote Values:**
    *   `10` = Approved (อนุมัติ PR)
    *   `-10` = Rejected (ปฏิเสธและคืนงานกลับไปแก้ไข)
    *   `0` = No Vote (เคลียร์สถานะโหวต)
*   **การตั้งค่า Auto-Complete (หลังโหวตอนุมัติ):**
    *   เมื่อหน้าเว็บบรรลุการอนุมัติ โค้ดจะส่งคำสั่ง PATCH เพื่อตั้งค่า auto-complete ของ PR
    *   **กฎเหล็ก:** ใน parameter payload ต้องกำหนดค่า `"transitionWorkItems": false` ทุกครั้ง ห้ามละเว้นเด็ดขาด เพื่อป้องกันไม่ให้เกิดการเปลี่ยนสถานะหรือการลบของ Work Items/Tasks ที่ผูกไว้กับ PR บน Azure DevOps

---

## 📦 3. กลไกตรวจสอบและอนุมัติ Classic Release (Release Approval)

ระบบนี้รองรับการอนุมัติ Release Pipeline ที่ผูกติดกับ build ของ PR ในหน้า Dashboard:

1.  **การดึงข้อมูล Release สถานะ:**
    *   โค้ดใน [ado-client.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/ado-client.js) จะหาประวัติการรัน Classic Release ที่สัมพันธ์กับ Build ID ของ PR นั้นๆ
2.  **การอนุมัติ (Approve Release Action):**
    *   ปุ่ม `Approve Release` บนหน้าจอหน้าเว็บจะแสดงขึ้น**เฉพาะในกรณีที่ Azure DevOps ระบุว่าสถานะการอนุมัติ (Pre-deploy approval) เป็น `pending` เท่านั้น**
    *   *ขั้นตอน:* ก่อนจะส่งข้อมูลยืนยันการอนุมัติ ระบบต้องตรวจสอบสถานะจริงของ Release นั้นบน ADO อีกครั้ง (Re-check) เพื่อป้องกันการส่งโหวตซ้ำซ้อนใน Release ที่ถูกอนุมัติไปแล้วภายนอก

---

## 🛑 4. นโยบายงดอนุมัติอัตโนมัติสำหรับ MergeCode PRs

*   **MergeCode & MergeCodeProduction:** เป็น Pull Request ที่จัดอยู่ในกลุ่มประเภทความเสี่ยงสูง (เช่น การผสานโค้ดข้ามสาขาหลัก)
*   **ข้อกำหนด:** ระบบจะไม่สร้างปุ่มการอนุมัติหรือปฏิเสธผ่านหน้า Dashboard บนเว็บ (ห้ามให้โปรแกรมจัดโหวตและ Auto-Complete บนเว็บโดยเด็ดขาด)
*   **พฤติกรรมระบบ:** หน้า Dashboard จะซ่อนปุ่มแอคชันและเปิดเฉพาะปุ่ม `Open ADO` เพื่อให้นักพัฒนากดเข้าไปประเมินและอนุมัติด้วยตนเองที่หน้าเว็บของ Azure DevOps (Manual Workflow)

---

## 📂 5. การปรับปรุงแผนผัง CI/CD Mappings

ข้อมูล CI และ CD ในระบบถูกผูกไว้ใน [api/shared/stg-ci-cd-map.json](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/stg-ci-cd-map.json):

*   **กระบวนการอัปเดต:** ห้ามเข้าไปแก้ไขไฟล์ `stg-ci-cd-map.json` โดยตรงด้วยมือ (Manual edit)
*   **ขั้นตอนที่ถูกต้อง:** ให้เข้าไปเพิ่มหรือแก้ไขข้อมูลในตาราง CSV ต้นทาง (`pipelines.csv`, `release-pipelines.csv`, `ci_cd_mapping.csv`) จากนั้นให้รันสคริปต์แปลงไฟล์เพื่อให้ระบบสร้าง JSON ตัวใหม่ที่ถูกต้องออกมาใช้งานแทน
