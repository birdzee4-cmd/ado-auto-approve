# Deployment Monitoring: driver, pool และ service/cursor

วันที่ 22 ตุลาคม 2026 — พัฒนาต่อแบบ offline ตามการอนุมัติของผู้ใช้ **G0 ยัง pending** ไม่มีการเชื่อม UAT/production ในรอบนี้

เอกสารนี้อัปเดตส่วน driver/service/cursor ที่ระบุว่ายังไม่มีใน [ขอบเขตชั่วคราวรอบก่อน](deployment-monitoring-provisional-development-th.md) โดยยังใช้ข้อสรุป mapping/timezone เดิม ไม่เปลี่ยนเป็น owner-approved facts

## Dependency และ executor

- เพิ่ม `mssql` exact `12.7.10` ผ่าน npm พร้อม lockfile; resolved Tedious `20.3.8` ต้องการ Node >=22 ตรงกับ runtime เป้าหมาย ตรวจ release/engines กับ npm และ API จาก [เอกสาร node-mssql](https://tediousjs.github.io/node-mssql/)
- เปรียบเทียบ lockfile กับ HEAD ก่อนแก้: เพิ่ม 23 package entries ไม่มี existing package version เปลี่ยนหรือถูกลบ
- `deployment-monitoring-executor.js` ไม่เชื่อม DB ตอน import/สร้าง factory และปิดโดย default ต้องผ่าน enabled/authorizeConnection แบบ boolean true ก่อนอ่าน config หรือโหลด driver; config เป็น trusted server-side provider ไม่รับจาก HTTP input ไม่อ่าน secrets/environment อัตโนมัติ
- บังคับ TLS encrypt=true/trustServerCertificate=false, useUTC=true สำหรับ SQL wall-clock carriers, readOnlyIntent=true; read intent ไม่ใช่ตัวบังคับสิทธิ์
- ใช้หนึ่ง executor instance ต่อ API worker เพื่อแชร์ pool/connecting promise: max 5/min 0, connect timeout 5 วินาที, acquire timeout 5 วินาที, query timeoutไม่เกิน 10 วินาที ไม่ใช่ SLA รวมของทั้ง request
- หลัง connect แต่ละ pool รัน SELECT ตรวจ database ที่คาดหมาย, SELECT source, flags INSERT/UPDATE/DELETE/ALTER/CONTROL และ db_owner/db_datawriter/sysadmin ก่อนอ่าน source; unknown/null หรือสิทธิ์กว้างตาม flags ที่ตรวจจะปฏิเสธและปิด pool การตรวจนี้ไม่ใช่การรับรองสิทธิ์ทุก object ใน database และไม่ใช้ write probe
- Bind ผ่าน Request.input ระบุชนิด Int/NVarChar/DateTime เท่านั้น; executor เป็น internal module สำหรับ query repository ไม่ใช่ arbitrary SQL endpoint และ SELECT-prefix guard ไม่ใช่ SQL parser/security boundary
- รับ pool error โดยไม่ log raw error, ล้าง pool ที่เสีย, reset หลัง connect fail เพื่อให้คำขอถัดไปลองใหม่ ไม่มี automatic retry; ปิด pool หลัง connect จบเพื่อหลีกเลี่ยง close-while-connecting ของ node-mssql
- requestTimeout และ timer เรียก cancel; รองรับ AbortSignal ใน executor แต่ยังไม่มี HTTP/runtime adapter ส่ง disconnect signal เข้ามา จึงยังไม่อ้างว่าปิดแท็บ browser แล้ว SQL ยกเลิกจริง

## Service และ cursor

- `deployment-monitoring-service.js` เชื่อม validated inputs ของ HTTP handler factory กับ raw-query interface ของ repository; ทดสอบ HTTP factory → service → repository โดยใช้ executor จำลอง
- `deployment-monitoring-cursor.js` ใช้ HMAC-SHA256 กับ secret ที่ inject อย่างน้อย 32 bytes ต้องจัดการผ่าน server secret store ก่อนเปิดใช้จริง ไม่เก็บ secret จริงใน code/docs และไม่สร้าง key ใหม่ต่อ request
- Cursor มี version/expiry 15 นาทีและ boundary TargetDate/ID; ผูก from/to/pageSize/project/q/status, timezone assumption, mapping version, sort และ development projection version ปฏิเสธ signature/shape/date/ID/filter mismatch ก่อน source query
- อ่านหน้าถัดไปแบบ keyset `TargetDate < @afterDate OR (TargetDate = @afterDate AND ID < @afterId)` ภายใต้ range/filter เดิม ทั้งสองค่าเป็น typed parameters ไม่มี OFFSET หรือ cursor SQL fragment
- service ส่ง page.nextCursor=null เมื่อจบหน้า และ consistency=live เพราะข้อมูลอาจเปลี่ยนระหว่าง requests ไม่ใช่ snapshot ข้ามหน้า
- summary ยังคง aggregate ทั้งช่วงและไม่รับ cursor; detail คืน null เพื่อให้ handler ส่ง 404 เมื่อไม่พบ
- ก่อน release ต้องเพิ่ม policy/scope version ใน cursor fingerprint หาก owner กำหนด row scope ต่างกัน; projection/scope ปัจจุบันเป็น development assumptions เท่านั้น

## หลักฐานตรวจรอบนี้

- Monitoring/History: 8 test files, **49/49 ผ่าน** รวม executor 9 และ service/cursor 6 tests ใหม่
- Report Summary, Monthly Summary, LINE Monthly Summary, Deployment Model/Excel: 5 test files, **22/22 ผ่าน**
- รวม **71/71 ผ่าน** บน Node 24.15.0 โดยรันแต่ละไฟล์ด้วย `node --test --test-isolation=none` เพื่อแยก mocks และข้อจำกัด spawn ของ sandbox ไม่ใช่การรัน full repository suite
- Tests ใช้ synthetic rows/fake driver เท่านั้น ยกเว้น smoke test ที่โหลด installed mssql และสร้าง Request/input โดยไม่ connect
- `npm ci --ignore-scripts --no-audit --no-fund` ใน temporary directory แยกสำเร็จและโหลด driver ได้ ไม่ reinstall node_modules ของ workspace ด้วย npm ci; ลบเฉพาะ temporary directory ที่สร้างและตรวจ path แล้ว
- npm audit พบ high 1 package (`brace-expansion` รุ่น 1.1.18 และ nested 2.1.4) อยู่ใน baseline lockfile เดิม ไม่ได้เพิ่มโดย driver; ยังไม่ได้แก้ dependency นอก scope จึงไม่อ้างว่า security audit ผ่านทั้งหมด
- Syntax check ของ modules ที่เปลี่ยน และ git diff --check ผ่าน

## งานที่ยังเหลือ

ยังไม่มี live driver integration, Node 22 runtime test, API hosting/identity/network verification, owner-approved visibility/field allowlist, endpoint registration หรือ public UI change ไม่มี performance/load test, UAT signoff หรือ release approval ไม่เปลี่ยน legacy sync/history/CSV consumers ไม่มี push/PR/deploy

รอบเชื่อม UAT ครั้งถัดไปต้องขออนุมัติ scope SQL ก่อนตามคำสั่งผู้ใช้ และใช้ SELECT-only identity ที่อนุมัติ การเพิ่ม driver/pool ใน code ไม่ใช่การอนุมัติให้เปิด connection โดยอัตโนมัติ
