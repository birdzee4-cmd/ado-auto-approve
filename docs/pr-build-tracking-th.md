# เมนูติดตาม PR / CI-CD

เพิ่มในหน้า `/deployment.html` ใช้ API `GET /api/ado-pr-build-tracking` สำหรับ role `it_support_approve` และ `admin` ตาม Deployment summary เดิม

## พฤติกรรม

- ค้นหา Project (Azure DevOps), Repository, Pipeline และหมายเลข PR พร้อมกรอง Environment และสถานะค้าง
- นับ run/attempt จากประวัติ Hook ทั้งหมดที่เก็บไว้ ไม่ใช้เฉพาะหน้า pagination ปัจจุบัน
- แยก project, repository, source type, pipeline, target branch, environment และ stage เพื่อไม่ให้ CI success ปิด CD failure
- Deduplicate run/stage/attempt; หาก Hook ไม่มี attempt ID จะแยก retry ภายใน run เดียวกันไม่ได้ จะแสดงสถานะล่าสุดของ run/stage นั้น
- แสดง failed run กับ successful run ถัดไปและ PR ที่มีข้อมูล โดยคงประวัติ fail ไว้
- Classic Release ใหม่เก็บ Build artifact IDs และ attempt ID; ใช้ Build ID ที่อ้างอิงจริงเพื่อเติม PR เมื่อมี artifact เดียวและมี CI event ต้นทาง ห้ามใช้ PR ล่าสุดแทน
- แจ้งเตือนในหน้าเว็บเมื่อพบ failures ที่ยังไม่กลับมาสำเร็จ พร้อม Refresh และอัปเดตทุก 60 วินาทีเมื่อเปิดเมนู
- Summary เดิมใช้ recovery logic เดียวกัน และแก้การอ้าง `successRuns` ที่ไม่ได้ประกาศ

## ขอบเขตข้อมูลและงานเชื่อมต่อที่เหลือ

เป็นการติดตามจาก stored service hooks ยังไม่ได้ดึง Azure DevOps ย้อนหลัง ข้อมูลเก่าที่ไม่มี PR, artifact หรือ attempt ID จะไม่ถูกเติมอัตโนมัติ ไม่มีการส่งข้อความแจ้งเตือนภายนอกเพิ่ม

คำว่า “กลับมาสำเร็จ” หมายถึง lane เดิมมี run สำเร็จภายหลัง ยังไม่ใช่การยืนยันว่า PR นั้นแก้ปัญหาใบงานเดิม ไม่รวม canceled/unknown เป็น success และไม่จับคู่ข้าม stage

เพิ่มแถวโปรเจกต์ `oceanlife-web-stg` จาก mapping ที่ตรวจหน้า Azure DevOps จริงวันที่ 5 พ.ย. 2026: Project ID `aee92c2c-3918-4dbd-bcf3-15e5191aa4a1`, Repository `Net_Web_OceanLife`, CI ID `11169`, CD ID `10239`, branch `refs/heads/staging`, CD stage `Azure Automated Deployment` เก็บใน `api/shared/pr-build-project-map.json` แยกจาก mapping legacy ที่มี OceanLife ชื่ออื่น

หลักฐาน: Build `608087` / `20261027.1` → PR `375391`; แท็บ Releases ของ Build ลิงก์ไป Release `426752` / `Release-frontend-oceanlife-web 20261105_1745` และ CD definition `10239` จึงรองรับ Release ใหม่ที่ใช้ Build เก่า แถวโปรเจกต์จะถือว่า CI/CD สำเร็จเมื่อ Release ล่าสุดอ้างอิง Build ล่าสุดจริง ถ้ามี rollback/redeploy ของ Build เก่าภายหลังจะไม่คงสถานะสำเร็จของ CI ล่าสุด

ยังไม่ได้อ่านฐานข้อมูล Project Planning หรือดึงแถวใบงาน SQL มาเชื่อม แถว Project ใช้ชื่อที่ยืนยันจาก Monitor กับ mapping เท่านั้น จึงไม่มีหมายเลขใบงาน SQL และไม่มีการอนุมานสถานะจากสีของ Monitor เพิ่มโปรเจกต์อื่นได้เมื่อยืนยัน mapping ของโปรเจกต์นั้น

Build hooks ใหม่ที่ไม่มี PR ID จะค้น completed PR ของ repository/target branch สูงสุด 100 รายการ แล้วเทียบ `lastMergeCommit.commitId` กับ `sourceVersion` แบบตรงกันเท่านั้น ถ้าไม่พบ/ไม่ชัดเจน/API ใช้ไม่ได้จะเก็บ PR ว่างและยังบันทึก Build ปกติ ไม่เดาจากข้อความหรือ PR ล่าสุด

ถ้า Classic Release มีหลาย Build artifacts จะคง PR ว่างเพื่อไม่ระบุ PR ผิด หากต้นทางไม่มี Build/Release hooks ข้อมูลจะไม่ปรากฏ ต้องตรวจ subscriptions และ `ADO_DEPLOYMENT_EVENTS_ENABLED` บน hosting จริงก่อน UAT

## การตรวจสอบ

รัน `node --test --test-isolation=none test/pr-build-tracking.test.js test/ado-deployment-event-service.test.js` จาก `api/` ครอบคลุม recovery ข้าม PR, แยก scope/stage, duplicate hooks, retry attempts, artifact เก่า, unknown lineage และ authorization/error ของ endpoint

Preview ในเครื่อง: `node scripts/preview-pr-build-tracking.cjs` แล้วเปิด `http://127.0.0.1:4174/deployment.html` เป็นข้อมูลจำลองที่ระบุชัดเจน ไม่มี cloud calls หรือ storage writes และ bind เฉพาะ loopback

ยังไม่ได้ deploy หรือทดสอบ Azure Storage integration จริง การตรวจ Azure DevOps API ด้วย credential ที่มีใน environment ได้ HTTP 401 จึงใช้ browser session ที่ผู้ใช้เปิดไว้ยืนยัน mapping แทน ไม่อ้างว่า API credential พร้อมใช้งานจริง

ผลตรวจรอบ 5 พ.ย. 2026: tests ที่เกี่ยวข้องผ่าน 22/22, syntax checks และ `git diff --check` ผ่าน ตรวจ Chrome ด้วย preview ข้อมูลจำลองแล้ว: สลับเมนูได้, แสดง CI ล่าสุดรอ CD พร้อมเตือน Build เก่า, เปิดตารางแสดง CI fail PR #1001 → success PR #1002 และ CD fail → success ของ Build เดิมได้ ไม่มีการ publish/push/deploy ในการตรวจนี้

## ตรวจ hosting จริง (5 พ.ย. 2026)

- Azure CLI เข้าถึง subscription Buzzebees Staging ได้ ยืนยัน SWA `ado-auto-approve` ใน resource group `rg-ado-auto-approve` มี hostname ตรงกับ URL ที่ผู้ใช้ระบุ
- อ่านเฉพาะ settings ที่จำเป็นใน memory ไม่แสดงหรือบันทึก token/connection string ลงไฟล์หรือแชต
- Hosting ตั้ง ADO organization/project เป็น Buzzebees, มี `ADO_PAT` และ `ADO_DEPLOYMENT_EVENTS_ENABLED=true`
- เรียก GET Build 608087 ด้วย PAT ของ hosting จริงได้ HTTP 401 จึงยืนยันว่าปัญหา credential ไม่ได้จำกัดเฉพาะเครื่อง local แต่ยังระบุไม่ได้ว่า token หมดอายุ ถูก revoke หรือมีเหตุอื่น
- อ่าน event storage จริงสำเร็จ แต่ query `pipelineId eq '11169' or pipelineId eq '10239'` ไม่คืนรายการ จึงยังไม่มีหลักฐานว่าระบบเก็บประวัติ Oceanlife ตาม IDs ที่ยืนยันไว้แล้ว ไม่ใช่การยืนยันว่า subscription hooks ไม่มีอยู่ หรือทั้งตารางว่าง
- ไม่เปลี่ยน app settings, credential, subscriptions, event rows หรือ deploy ในการตรวจนี้ ต้องให้เจ้าของ credential ต่ออายุ/เปลี่ยน `ADO_PAT` บน SWA โดยคงสิทธิ์ที่ระบบเดิมจำเป็นต้องใช้ ก่อนตรวจการดึงย้อนหลัง/PR enrichment กับ Azure DevOps จริงต่อ ไม่ส่ง secret ผ่านแชต
