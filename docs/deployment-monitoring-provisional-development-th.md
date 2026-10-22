# การพัฒนาต่อด้วยข้อสรุปชั่วคราว — 22 ตุลาคม 2026

ผู้ใช้อนุญาตให้ใช้การวิเคราะห์จากหลักฐานเพื่อพัฒนาต่อ โดยไม่ถือว่าปิด G0 หรืออนุมัติ release เอกสารนี้ขยายลำดับงานในแผนสำหรับ offline development เท่านั้น ไม่อนุญาตเชื่อม DB รอบใหม่หรือเปิดใช้ production

## หลักฐานและสมมติฐาน

- หน้า UAT `/ProjectPlanning/ProjectPlanningList.aspx`: dropdown Status และฟังก์ชัน getStatus ให้ label; ใช้ label ใน dropdown แยก 409/410 ซึ่งฟังก์ชันแสดงผลย่อเป็น Waiting Document เหมือนกัน
- UI ระบุ Type 0=Backend, 1=Frontend, 2=No Action และ GetType 0=Get, 1=Merge, 2=Resize; โค้ดสร้างรายการส่งทั้งสองค่าไป cbackCreate และฟอร์มอ้าง DeployType โดยตรง แต่ยังไม่ได้ตรวจ handler ฝั่ง server จึงเป็น provisional mapping
- ฟังก์ชัน getStatus แสดงค่าติดลบเป็น Terminate รวม -110 ที่ปรากฏในภาพ SQL; นี่เป็นพฤติกรรม UI ไม่ใช่ข้อสรุป business outcome สำหรับ reporting
- Priority คง raw integer ไม่ตั้งชื่อ 0 ว่า Normal/Low
- ใช้ storageTimezone=Asia/Bangkok เป็นสมมติฐานสำหรับ development เท่านั้น ต้องส่ง configuration ชัดเจน ไม่มี default ที่เลือก timezone เอง และทดสอบ UTC เป็นทางเลือก
- category/isTerminal ยัง unknown/null ไม่คำนวณ success rate/overdue จาก label หรือ CompletedDate

## ขอบเขต implementation

`deployment-monitoring-provisional.js` เป็น mapping opt-in แยกจาก mapping unconfirmed เดิม เพื่อคง contract และ prototype เดิม

`deployment-monitoring-sql.js` เป็น query adapter/repository ที่ยังไม่ลงทะเบียน endpoint และไม่มี SQL driver/network implementation รับ execute และ authorizeSource ที่ inject เท่านั้น ปิดโดย default ต้องเปิด developmentEnabled แบบ boolean และยืนยัน source authorization ก่อนแต่ละ query รายการคอลัมน์เป็น development projection ไม่ใช่ owner-approved field visibility

- SELECT list/detail/summary จาก dbo.Internal_ProjectPlanning เท่านั้น ไม่มี SELECT *, NOLOCK, SQL write, Azure Tables fallback หรือ legacy API change
- พารามิเตอร์ระบุ Int/NVarChar/DateTime; future executor ต้อง bind ผ่าน driver ห้ามแทน string ด้วย interpolation; LIKE escape ~, %, _, [
- DateTime parameters เป็น Date ที่ใช้ UTC components ถือ SQL wall-clock จึงต้องใช้ driver useUTC=true เมื่อ implement executor; projection วันที่ใช้ CONVERT เฉพาะ SELECT ไม่ครอบ TargetDate ใน WHERE และส่ง offset ตามสมมติฐาน configuration
- ทุก query มี timeout descriptor 10 วินาที แต่การบังคับ timeout/cancel/pool จริงยังต้องทำใน driver executor
- list ใช้ TargetDate DESC, ID DESC และอ่าน pageSize+1; ระบุ hasMore/paginationAvailable=false ชัดเจน ยังไม่มี cursor และยังไม่พร้อมต่อหน้าจริง
- repository รับ raw query ไม่ใช่ validated internal filters ของ HTTP factory จึงต้องมี service layer เชื่อมก่อน ห้ามนำไป inject ให้ handler โดยตรง
- detail จำกัด projection เช่นเดียวกับ list ยังไม่เปิด remarks/description/เอกสาร/paths/JSON/stage details
- summary aggregate ทั้งช่วงตาม filters รักษา null/รหัสดิบ ไม่ใช้จำนวนเฉพาะหน้าเป็น total และป้องกัน count เกิน JS safe integer
- exception จาก executor/authorization ถูกเปลี่ยนเป็นข้อความคงที่ ไม่มี raw SQL errors และไม่มี retry อัตโนมัติ

## ผลตรวจและงานที่ยังเหลือ

Tests ใหม่ใช้ executor จำลองทั้งหมด ครอบคลุมการปิด feature/ตรวจ source approval, injection/LIKE, ขอบเขตวัน Bangkok/UTC/leap day/SQL datetime minimum, DTO projection/null dates, truncation/not-found, aggregate/unknown และ error redaction ไม่มีแถวข้อมูลจริงหรือข้อมูลบุคคลใน fixtures

ยังไม่มี live SQL integration, driver binding/permission probe จาก API identity, pool/reconnect/cancel, cursor/service layer, endpoint/public UI, performance/Node 22 validation หรือ UAT signoff ต้องยืนยัน mapping/timezone/scope/field allowlist และ hosting ก่อน release ไม่มี push/PR/deploy
