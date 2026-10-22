# รอบทดสอบ driver บน UAT แบบ SELECT-only

วันที่ 22 ตุลาคม 2026 — **รอบล่าสุดอ่าน list/detail/summary ผ่าน Node driver บน UAT สำเร็จหลังใช้ tenant ที่ SQL ยืนยัน** ผลรอบก่อนเก็บเป็นประวัติด้านล่าง เอกสารนี้ไม่ปิด G0 และไม่ใช่ UAT signoff

ใช้ `scripts/deployment-monitoring/run-uat-driver.cjs` เพื่อทดสอบ executor → repository → service ที่พัฒนาไว้ โดยไม่เปิด API server หรือเปลี่ยน public UI

## ขอบเขตที่ต้องขออนุมัติก่อนรัน

1. เชื่อม UAT server/database ที่ผู้ใช้ยืนยันไว้ด้วย Microsoft Entra interactive/MFA ผ่าน TLS ตรวจ certificate; ใช้ public client application เดิมที่ได้รับอนุญาตสำหรับ JDBC ไม่เพิ่มสิทธิ์หรือแก้ app registration
2. Permission SELECT ของ executor: ยืนยัน database/SELECT บน source และปฏิเสธ flags สิทธิ์เขียน/DDL/CONTROL หรือ roles กว้างตามที่ตรวจ หากตรวจไม่ได้จะหยุดก่อนอ่าน source
3. List: `TOP (@take)` โดย take=2 (pageSize 1 และ lookahead 1) เฉพาะ TargetDate >= from และ < toExclusive ของวัน **2026-10-22** สมมติ SQL เก็บเวลาไทย; เรียง TargetDate DESC, ID DESC ไม่อ่านหน้าถัดไป
4. Detail: SELECT projection เดียวกับ list เฉพาะ ID หนึ่งที่เพิ่งอ่านได้ หาก list ว่างจะข้าม
5. Summary: GROUP BY Status/IsPrepared และ COUNT_BIG เฉพาะช่วงวันเดียวกัน ไม่มี full-table count และไม่มีการอ่าน lookup/module เพิ่ม

ทั้งสาม data queries ใช้ fixed repository SQL และ typed parameters ไม่รับ arbitrary SQL จาก CLI/ไฟล์ ไม่มี INSERT/UPDATE/DELETE/DDL/EXEC หรือ write probe ไม่ใช้ Azure Tables แทน

Projection ภายใน memory เป็น development projection ของ repository รวมชื่อ Project/Owner แต่ **ไม่พิมพ์แถวข้อมูล** ออก stdout/ไฟล์/log; รายงานเพียง returnedRows/hasMore/detail match/total/prepared/unknown และผลขั้นตอน ไม่มีชื่อบุคคล รายละเอียดงาน ID หรือ raw cursor/token ในรายงาน การทดสอบนี้ไม่อนุมัติ field visibility สำหรับ browser

## การรัน

ค่าเริ่มต้นไม่อ่าน config หรือเรียก credential/DB:

```powershell
node scripts/deployment-monitoring/run-uat-driver.cjs
```

หลังอนุมัติขอบเขตจึงส่ง `--connect-approved --read-approved` **ทั้งคู่** พร้อม `--server`, `--database`, `--day`, `--storage-timezone`, `--client-id` และ `--tenant-id` ที่ได้รับอนุญาต ไม่มี password/token argument ไม่บันทึกค่าจริงลงเอกสารหรือ source control

Interactive flow ใช้ [InteractiveBrowserCredential ของ Azure Identity](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/interactivebrowsercredential?view=azure-node-latest) ซึ่งติดตั้งอยู่แล้ว token cache เป็น memory-only ไม่มีการอ่าน DBeaver secure store หรือเปิด persistence ผู้ใช้เลือกบัญชี UAT และทำ MFA เอง หากพบ consent ขอสิทธิ์เพิ่มเติมหรือ admin approval ให้หยุด ไม่อนุมัติขยายสิทธิ์แทนผู้ใช้

รอ sign-in สูงสุด 240 วินาทีและหยุด process เมื่อครบเวลา ไม่มี retry อัตโนมัติ ต้องขออนุมัติรอบใหม่ก่อน retry ไม่ใช้ browser credential/cookies มาเป็น SQL credential และไม่ให้ผู้ใช้ส่ง password/MFA/token ในแชต

## การตีความผล

- plan-only: connected=false/sourceRead=false ไม่ใช่การทดสอบ connection
- approved-uat-read: รายงาน permissionGatePassed และผล list/detail/summary หลังเรียกสำเร็จ; storageTimezoneAssumption/mappingProvisional ยังชั่วคราว และ releaseApproved=false เสมอ
- detail changed-or-missing ไม่ใช่ integration match; อาจเกิดจาก live data เปลี่ยนระหว่าง query ต้องรายงานตามจริง
- หาก list ว่าง detail เป็น not-tested-empty-list ห้ามอ้างว่าทดสอบ detail จริงผ่าน
- exception แสดงเฉพาะ fixed error code ไม่มี raw SQL/Auth error หรือ secrets หากเกิด failure จะไม่ไล่อ่าน query ถัดไป และปิด pool ที่สร้าง
- ยังไม่ได้ตรวจ HTTP hosting/direct-host auth, runtime Node 22, cursor หน้าถัดไปกับ DB จริง, performance/concurrency, timezone หรือ business outcomes และยังไม่ใช่ release approval

## ผล offline

Tests `api/test/deployment-monitoring-uat-runner.test.js` ผ่าน 5/5: default-off, dual approval/config validation, query scope/bounds, token/PII output redaction, empty list และ fail-stop/close; ใช้ synthetic executor/token ทั้งหมด Plan-only CLI และ syntax check ผ่าน ไม่เชื่อม DB

## ผล live ครั้งแรกหลังผู้ใช้อนุมัติขอบเขต

ผู้ใช้อนุมัติ scope ตามข้อ 1–5 แล้วและทำ sign-in เอง ตัวรันรายงาน SIGN_IN_COMPLETE ตามด้วย LIST_AND_PERMISSION_CHECK_STARTED และหยุดด้วย MONITORING_UNAVAILABLE / exit 1 ไม่มี LIST_COMPLETE จึงยังไม่มีผล list/detail/summary ที่ยืนยันว่าผ่าน และจากข้อความรอบนี้ยังแยกไม่ได้ว่า connection, permission หรือ query ขั้นใดล้มเหลว ไม่อ้างว่าไม่มีการอ่าน source จาก error code เพียงอย่างเดียว ไม่มี automatic retry, push/PR/deploy หรือ write operation

เตรียม diagnostics เพิ่มเฉพาะ fixed stage เช่น CONNECT_FAILED/PERMISSION_QUERY_FAILED/PERMISSION_CHECK_FAILED/DATA_QUERY_FAILED และ error code ที่อยู่ใน allowlist รวม cause code ที่ปลอดภัย ไม่แสดง exception message/stack, SQL/config, identity, token หรือ row; observer ที่ล้มไม่เปลี่ยน permission/query behavior ทดสอบด้วย fake errors ก่อนใช้จริง รอบเชื่อมซ้ำยังต้องขออนุมัติใหม่ตามคำสั่งผู้ใช้

## ผล live ครั้งที่สองและขั้นวิเคราะห์ถัดไป

ผู้ใช้อนุมัติรอบซ้ำหนึ่งครั้งและทำ sign-in แล้ว ผลคือ SIGN_IN_COMPLETE → CONNECT_FAILED / ELOGIN → MONITORING_UNAVAILABLE / exit 1 ดังนั้นรอบนี้ยังไม่ถึง permission SELECT และไม่ได้อ่าน source rows ไม่ลด TLS/เปลี่ยนสิทธิ์/retry อัตโนมัติ

พบความต่างใน code: Node runner ขอ token ด้วย tenant common ขณะที่ JDBC callback เดิมใช้ stsurl ที่ SQL ส่งมา ยังเป็นเพียงประเด็นที่ต้องตรวจ ไม่ใช่ข้อสรุปว่าสาเหตุ ELOGIN คือ tenant ผิด

เตรียม `scripts/deployment-monitoring/UatAuthorityDiscovery.java` แยกจาก JDBC probe เดิม เพื่อรับเฉพาะ authentication authority metadata ผ่าน TLS โดยไม่ขอ/ส่ง access tokenและไม่มี SQL statements ค่าเริ่มต้น plan-only และ live ต้องมี `--handshake-approved` + server/database ที่ได้รับอนุญาต callback ยอมรับเฉพาะ SQL resource scope, HTTPS login.windows.net/login.microsoftonline.com และ tenant UUID แล้วหยุด login โดยตั้งใจ ไม่อ่าน DBeaver config/cache หรือ token ข้อมูล tenant UUID เป็น authentication configuration ไม่เก็บค่าจริงใน source control

ตัวตรวจนี้ต้องขออนุมัติก่อนรัน network เช่นเดียวกับ connection รอบอื่น หากยืนยัน authority ได้ ค่อยเสนอรอบ Node ที่ใช้ explicit tenant นั้น ไม่มีการเปิด/เพิ่ม role หรือเปลี่ยน database users เพื่อแก้ ELOGIN

ทดสอบ authority validator แบบ offline ผ่าน 9/9 รวมการปฏิเสธ host/scope/HTTP/port/userinfo/query และ common tenant; plan-only รายงาน connected=false/tokenRequested=false/sqlExecuted=false ไม่มี live authority discovery ในขั้นเตรียมนี้

## ผล authority handshake หลังอนุมัติแยก

ผู้ใช้อนุมัติ authentication handshake ของ UAT หนึ่งครั้งแล้ว ตัวตรวจคืน AUTHORITY_CONFIRMED / exit 0 และ tenant UUID ที่เจาะจงจาก SQL ไม่ใช่ common พร้อม tokenRequested=false/sqlExecuted=false ตามขอบเขต ไม่บันทึกค่า tenant จริงใน source control ไม่มี MFA/token request หรือ SQL statement ในรอบนี้

ขั้นถัดไปที่เตรียมพร้อมคือใช้ runner เดิมพร้อม `--tenant-id` ที่ SQL ยืนยันแทน common โดยคง server/database/client application/TLS/permission checks และขอบเขต list/detail/summary วันเดียวเดิมทั้งหมด ต้องขออนุมัติรอบเชื่อมใหม่ก่อนรัน การยืนยัน authority ยังไม่พิสูจน์ว่าแก้ ELOGIN ได้หรือว่า integration ผ่าน

## ผล Node driver รอบล่าสุดด้วย explicit tenant จาก SQL

ผู้ใช้อนุมัติรอบนี้แยกแล้ว ใช้ UAT/บัญชี/client application และ TLS เดิม เปลี่ยนเฉพาะ tenant configuration จาก common เป็น tenant UUID ที่ SQL ยืนยัน ไม่เปลี่ยนสิทธิ์หรือ database users ผล process exit 0:

- SIGN_IN_COMPLETE → CONNECT_COMPLETE → PERMISSION_CHECK_COMPLETE
- List สำเร็จ คืน 1 รายการตาม pageSize=1 และมี lookahead (TOP 2); hasMore=true และสร้าง signed cursor ได้ ไม่พิมพ์ชื่อบุคคล/รายละเอียดงาน/ID/cursor/token
- Detail ของ ID จาก list สำเร็จและ matched-id
- Summary ในช่วง TargetDate วันที่ 2026-10-22 ตามสมมติฐานเวลาไทย: total=40, prepared=0, unknown=0, จำนวนกลุ่ม raw Status/IsPrepared=6 ณ เวลารันทดสอบ เป็นข้อมูล live ไม่ใช่ baseline คงที่หรือผลทุกวัน
- Source data queries ครบสามครั้งตาม scope แล้วปิด pool ไม่มี retry/write/DDL, push/PR/deploy

**ผ่านเฉพาะ live read integration ของ driver → executor → repository → service ใน scope นี้** unknown=0 หมายถึง label ครอบคลุมรหัสที่พบตาม provisional mapping ไม่ได้ยืนยัน business outcomes หรือ owner approval ผล prepared=0 มาจาก aggregate ของช่วงที่ตรวจ ไม่ใช่ fallback แทน error

ยังไม่ทดสอบ cursor หน้าถัดไป/empty/not-found/error/cancellation/pool recovery กับ DB จริง, HTTP hosting/direct-host trust, role/row visibility, runtime Node 22 หรือ load/performance; timezoneConfirmed=false/mappingProvisional=true/releaseApproved=false ตามผล runner ไม่มี UAT signoff และ G0 ยัง pending ส่วนยืนยัน semantics/visibility/hosting การใช้ explicit tenant สำเร็จในรอบนี้สนับสนุนประเด็น tenant configuration ของรอบก่อน แต่ไม่ใช่หลักฐานว่าทุก ELOGIN เกิดจากสาเหตุเดียวกัน

## ผลรอบ cursor pagination ที่อนุมัติล่าสุด

เพิ่มโหมด `--pagination-approved` เพื่อเรียกหน้าที่สองด้วย signed cursor โดยคงวันและตัวกรองเดิม หน้าแรก/หน้าถัดไปยังจำกัดที่ pageSize=1 และไม่พิมพ์แถวข้อมูลหรือ cursor ออกผลลัพธ์

ผู้ใช้อนุมัติรอบนี้แล้วและทำ sign-in สำเร็จ แต่การเชื่อมต่อหยุดที่ `CONNECT_FAILED / ELOGIN` ก่อน permission check ดังนั้นยังไม่มีการอ่าน list, cursor, detail หรือ summary ในรอบนี้ ไม่มีการ retry และไม่มีการเปลี่ยน TLS/สิทธิ์/ข้อมูล ฐานข้อมูลยังไม่มีหลักฐานยืนยัน pagination จาก UAT

สิ่งที่ต้องให้ DBA/ผู้ดูแลตรวจสำหรับรอบถัดไปคือสาเหตุ authentication ของ client application/tenant ที่ยืนยันแล้ว, audience และสิทธิ์ database principal ของ token รวมถึง policy ที่ทำให้ login ถูกปฏิเสธ โดยไม่ส่ง password, token, raw SQL error หรือ secret ในแชต หลังแก้ configuration แล้วต้องขออนุมัติรอบเชื่อมต่อใหม่อีกครั้ง

## การแก้ diagnostics หลังรอบ ELOGIN

runner ตรวจ JWT claims ใน memory ก่อนสร้าง SQL executor โดยเปรียบเทียบ tenant กับค่าที่ระบุ, audience ต้องเป็น Azure SQL, และตรวจ `exp`/`nbf` ตามเวลาปัจจุบัน การตรวจนี้ไม่ตรวจลายเซ็นและไม่แทน SQL authentication; หากไม่ผ่านจะหยุดด้วย `TOKEN_INVALID`, `TOKEN_TENANT_MISMATCH`, `TOKEN_AUDIENCE_MISMATCH`, `TOKEN_EXPIRED` หรือ `TOKEN_NOT_YET_VALID` โดยไม่เปิด connection

ไม่มีหลักฐาน identity ของรอบที่สำเร็จถูกเก็บไว้ จึงยังเปรียบเทียบ account identity ระหว่างรอบสำเร็จกับรอบ ELOGIN ไม่ได้ และไม่บันทึก/แสดง `oid`, `sub`, email หรือ claims จริง diagnostics ของ executor เพิ่มได้เฉพาะ SQL error number/state/class ที่อยู่ใน allowlist และยังไม่เปิดเผยข้อความหรือ stack

ตาม trailing-slash resource identifier ของ Azure SQL runner ขอ scope เป็น `https://database.windows.net//.default` โดยคง audience acceptance แบบ exact เป็น `https://database.windows.net/` เท่านั้น การเปลี่ยนนี้ไม่เพิ่ม allowlist, ไม่ normalize audience และไม่เปลี่ยน tenant/client/authentication method/permissions

ผล pagination จะรายงานผ่านก็ต่อเมื่อ key `(TargetDate, ID)` ของสองหน้าลำดับถูกต้องและไม่ซ้ำกัน ไม่ตั้งค่า `cursorStable` เป็น true โดยอัตโนมัติอีกต่อไป
