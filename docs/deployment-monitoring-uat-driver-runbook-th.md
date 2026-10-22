# รอบทดสอบ driver บน UAT แบบ SELECT-only

วันที่ 22 ตุลาคม 2026 — **รอบ live ครั้งแรก sign-in สำเร็จ แต่ driver check ยังไม่สำเร็จ** เอกสารนี้ไม่ปิด G0 และไม่ใช่ UAT signoff

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
