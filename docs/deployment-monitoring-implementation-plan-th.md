# Implementation Plan: เปลี่ยน Deployment Archive เป็น Deployment Monitoring

วันที่ตรวจสอบ: 22 ตุลาคม 2026 (Asia/Bangkok)  
Repository: `birdzee4-cmd/ado-auto-approve`  
ฐานอ้างอิงล่าสุดที่ตรวจ: `main` commit `d1b6f19e06befb244d8025df5515f6000935ca94` (20 ตุลาคม 2026)  
สถานะ: จัดทำแผนและ SQL discovery แล้ว; ยังไม่แก้หน้า production / ไม่เชื่อมฐานข้อมูล / ไม่ deploy

## 1. เป้าหมายและขอบเขตที่อนุมัติ

แทนที่เนื้อหา `public/deploy-history.html`, JavaScript และ CSS ของหน้าเดิมด้วย Deployment Monitoring ที่อ่านข้อมูลจริงจาก MSSQL `dbo.Internal_ProjectPlanning` เท่านั้น รักษา URL `/deploy-history.html` และ alias `/deploy-history` พร้อมสิทธิ์เดิม ไม่ต้องย้ายหรือแปลง CSV มาเป็น SQL และไม่เขียนกลับฐานข้อมูล

ผู้ใช้อนุมัติให้สร้างหน้า Archive ใหม่ แต่แยกงานเป็นขั้น: discovery → API → UI → integration/security → UAT → release ห้าม deploy production หรือ merge เข้า branch ที่ deploy อัตโนมัติก่อน UAT และอนุมัติ release งานนี้ไม่รวมการอนุมัติ deployment, update Status, CRUD planning, import/export ข้อมูลอ่อนไหว หรือเชื่อม ADO deployment เข้ากับ SQL โดยเดาคีย์

## 2. ข้อเท็จจริงจากโค้ดปัจจุบัน

| จุดตรวจ | สิ่งที่พบ / ผลต่อแผน |
|---|---|
| `public/deploy-history.html`, `.js`, `.css` | หน้า Archive ใช้ core.js; ดึง `/api/deploy-history?year=...`; filter/sort ข้อมูลใน browser; ปุ่ม sync ส่ง POST |
| `api/deploy-history/index.js` | อ่าน CSV ใน SharePoint `deploy-history/stg-deployments[-YEAR].csv` ไม่ใช่ MSSQL |
| `public/report.js:139` | ยัง POST `/api/sync-deployments` จึงห้ามลบหรือเปลี่ยน contract |
| `api/report-summary/index.js`, `api/monthly-summary/helpers.js` | อ่าน CSV ประวัติเดิม; ต้อง regression report และ monthly summary |
| `api/sync-deployments` | ดึง ADO staging build และเขียน CSV SharePoint; ไม่ใช่งานของ Monitoring |
| `public/staticwebapp.config.json` | หน้าและ API history จำกัด `it_support_approve`, `admin`; sync เป็น anonymous ที่ edge และตรวจ principal/token ใน handler; คง behavior เดิมในงานนี้ |
| `public/activity.html` | ลิงก์เข้าหน้า history; คง href และแก้ข้อความได้หลังตรวจบริบท |
| `api/shared/deployment-store.js`, `deployment-model.js` | ระบบ Deployment Report แยกต่างหากใช้ Azure Tables และมี write operations; ห้ามใช้แทน SQL source หรือผูก lifecycle/result โดยอัตโนมัติ |
| `api/shared/auth.js`, `deployment-http.js` | มี `requireAnyRole`; helper fail เดิมส่ง error.message ใน detail จึงห้ามนำมาใช้กับ SQL error โดยตรง |
| API runtime style | CommonJS Azure Functions แบบ `index.js` + `function.json`; ต้องคงรูปแบบนี้ |
| `api/package.json` + lock | dependency: `@azure/arm-appservice ^19.0.0`, `@azure/data-tables ^13.3.1`, `@azure/identity ^4.13.1`, `exceljs 4.4.0`; override uuid 11.1.1; ยังไม่มี mssql |
| `.github/workflows/azure-static-web-apps.yml` | push main/master deploy; PR opened/synchronize/reopened ก็ deploy preview; Node setup 22; build operations-ui ก่อนส่ง public + api |
| packages อื่น | operations-ui ใช้ React 19/Vite 7/TS 5; appservice-api เป็น package แยกและ workflow Node 20; งานนี้ไม่ต้องเพิ่ม dependency ให้สอง package นี้ |
| test script API | `npm test` ยังไม่รวมทุก test เช่น deployment-model/excel/summary; ต้องระบุ suite เพิ่มเอง |

ตรวจ source/package manifest/lock แล้ว ไม่ได้ยืนยันว่า dependency ปลอดช่องโหว่หรือเป็นรุ่นใหม่สุดใน registry ต้องตรวจอีกครั้งก่อนเลือก driver และก่อน merge ไม่มี AGENTS ย่อยจากรายการ tracked ที่ตรวจ; ปฏิบัติตาม AGENTS.md ที่กำหนดให้เก็บ scratch นอก repo และตรวจ git status ก่อนส่งงาน

## 3. ความคลาดเคลื่อน schema: คำขอ 49 แต่ต้นฉบับมี 57 คอลัมน์

แชตอ้างอิง `6ad85fac-6690-83ec-b25f-d3daa45f32b0` ส่งรายชื่อ 57 คอลัมน์จริง คอลัมน์ที่ 49 คือ BackupFile และยังมีอีก 8 คอลัมน์ ห้ามตัด 8 คอลัมน์ทิ้งหรืออ้างว่ายืนยัน schema 49 แล้ว ตารางต่อไปนี้เป็น schema จากข้อความผู้ใช้ ไม่ใช่ผลตรวจ DB; nullability, PK/identity, defaults, collation, indexes และ timezone ยังไม่ทราบ `nvarchar -1` แปลเป็น `nvarchar(max)` และตัวเลขความยาวในตารางนี้เป็นจำนวนตัวอักษร

| # | Column | SQL type |
|---:|---|---|
| 1 | ID | int |
| 2 | ProjectName | nvarchar(100) |
| 3 | Owner | nvarchar(100) |
| 4 | SubmitDate | datetime |
| 5 | TargetDate | datetime |
| 6 | TargetYear | int |
| 7 | TargetWeek | int |
| 8 | TargetDayOfWeek | nvarchar(30) |
| 9 | TargetDay | int |
| 10 | IsPrepared | bit |
| 11 | Remark | nvarchar(200) |
| 12 | AdditionalRequiredJson | nvarchar(max) |
| 13 | Priority | int |
| 14 | Status | int |
| 15 | CompletedDate | datetime |
| 16 | CreatedBy | nvarchar(50) |
| 17 | CreatedDate | datetime |
| 18 | LastModifiedBy | nvarchar(50) |
| 19 | LastModifiedDate | datetime |
| 20 | DeployType | int |
| 21 | Developer | nvarchar(100) |
| 22 | ProjectManager | nvarchar(100) |
| 23 | SourceControlNumber | nvarchar(200) |
| 24 | BackupPath | nvarchar(200) |
| 25 | GetType | int |
| 26 | Description | nvarchar(max) |
| 27 | ReleaseRequestID | nvarchar(200) |
| 28 | VersionNumber | nvarchar(100) |
| 29 | SVNProjectName | nvarchar(100) |
| 30 | Server | nvarchar(100) |
| 31 | BackupCode | nvarchar(500) |
| 32 | ProductionLabel | nvarchar(200) |
| 33 | CheckSize | nvarchar(100) |
| 34 | DeployDocumentLink | nvarchar(200) |
| 35 | StageOneDate | datetime |
| 36 | StageTwoDate | datetime |
| 37 | StageThreeDate | datetime |
| 38 | StageFourDate | datetime |
| 39 | ProductionStagingLink | nvarchar(500) |
| 40 | DocumentSourceCode | nvarchar(200) |
| 41 | DocumentCheckAzureProduction | nvarchar(200) |
| 42 | DocumentGetMerge | nvarchar(200) |
| 43 | DocumentCheckInstance | nvarchar(200) |
| 44 | DocumentModule | nvarchar(200) |
| 45 | DocumentPlugin | nvarchar(200) |
| 46 | DocumentCheckTypeMobile | nvarchar(200) |
| 47 | DocumentOther | nvarchar(1000) |
| 48 | DocumentTableVersion | nvarchar(20) |
| 49 | BackupFile | nvarchar(200) |
| 50 | Tester | nvarchar(100) |
| 51 | StoreFeature | nvarchar(1000) |
| 52 | UserStoryIds | nvarchar(1000) |
| 53 | UserStoryHashtag | nvarchar(30) |
| 54 | DocumentReleaseRequestOnlineID | nvarchar(200) |
| 55 | HasDeployLateReasonLog | bit |
| 56 | HasSwapBackReasonLog | bit |
| 57 | EpicWorkItemId | nvarchar(50) |

ไม่ส่ง 57 fields ทั้งชุดให้ browser โดยปริยาย: list ส่ง ID, ProjectName, Owner, TargetDate, Status, IsPrepared, Priority, DeployType, VersionNumber, CompletedDate, LastModifiedDate เท่าที่เจ้าของข้อมูลอนุมัติ; detail เพิ่ม Developer/ProjectManager/Tester, stage dates, ReleaseRequestID, Description/Remark ตาม field allowlist ที่อนุมัติแยก ข้อมูล Server, backup paths/code/file, JSON, links และเอกสารอาจมีข้อมูลภายใน ต้องประเมินก่อนเปิดให้เห็น; schema inventory ไม่เท่ากับ API permission

## 4. Phase 0: หลักฐานที่ต้องได้ก่อนต่อ MSSQL

1. ตรวจ git status, fetch main และอ่าน diff จาก commit ฐานนี้ก่อนเริ่ม implementation; อย่า reset/overwrite งานผู้ใช้อื่น
2. รัน `docs/sql/deployment-monitoring-discovery.sql` ใน UAT ด้วยบัญชี SELECT-only ที่ได้รับอนุญาต; เก็บผลที่ลบข้อมูลส่วนบุคคลในพื้นที่จำกัดสิทธิ์ ไม่ commit แถวข้อมูลจริง/credential ลง public repo
3. ยืนยัน 49/57 กับ sys.columns และ owner; ตรวจ ID unique/PK, nullable, indexes, จำนวนข้อมูลช่วงงานจริง, SQL Server version/collation และ time semantics ของทุก datetime
4. ยืนยัน endpoint/server/database/network route ของ UAT และ production; ตรวจว่า SWA managed API ปัจจุบันเข้าถึง SQL network ได้หรือไม่ ห้ามสมมติว่าต่อ private SQL ได้ทันที ถ้าต้องใช้ Functions ที่มี network integration ให้ทำ architecture decision แยกและตรวจ trusted auth boundary ก่อน
5. เจ้าของระบบยืนยัน scope: ทุก deployment หรือเฉพาะบาง DeployType/environment; ไม่มี Environment column จึงห้ามอนุมาน production/staging จากชื่อ Server หรือเลข DeployType
6. ขอ signed mapping สำหรับ Status, DeployType, GetType, Priority, stage semantics และ timezone จาก source app/lookup/owner โดยใช้ข้อมูล 30 วันล่าสุดประกอบ
7. ทวน query ของวันนี้และแถว ID 52844 กับเจ้าของข้อมูล; ไม่พบแถวให้รายงานว่าไม่พบ ห้ามสร้างค่าตัวอย่างแทนผลจริง

Exit gate G0: schema และ key/timezone/scope ยืนยันแล้ว, UAT connectivity/SELECT permission ทดสอบแล้ว, ระบุ field allowlist, mapping มี owner หรือยอมรับ unknown อย่างชัดเจน ก่อนเขียน production adapter ขณะนี้ G0 ยังไม่ผ่าน ไม่มี credential หรือผล query ในงานนี้

## 5. Status mapping discovery และกฎธุรกิจ

รวบรวมจำนวนตาม Status และตัวอย่างไม่เกิน 5 รายการต่อรหัสใน 30 วัน โดยดู TargetDate/CompletedDate/IsPrepared/stage dates ร่วมกัน ขอให้ owner เทียบ source UI และรหัสใน application เดิม ห้ามให้ 0/1/2 หมายถึง planned/success/failed ด้วยการเดา และห้ามนำ Succeeded/Failed/InProgress ของ ADO หรือ lifecycle ของ Azure Tables มาครอบ SQL

สร้าง mapping versioned แยกใน `api/shared/deployment-monitoring-status.js`: `{rawCode, labelTh, category, isTerminal, ownerEvidence}`; category ที่เสนอต้องรอยืนยัน เช่น planned/inProgress/completed/cancelled/failed/unknown เก็บ raw Status เสมอ; null เป็น unknown คนละกรณีกับ 0; รหัสไม่รู้จักแสดง “ไม่ทราบสถานะ (รหัส …)” สีเป็นกลาง มี unknown count และ structured warning โดยไม่ใส่ข้อมูลบุคคล

`IsPrepared` เป็น readiness แยกจาก outcome, CompletedDate ไม่ใช่หลักฐานว่าสำเร็จ, HasSwapBackReasonLog ไม่เท่ากับ rolled back, stage timestamp ไม่เท่ากับ percent progress จนยืนยันชื่อ stage แล้ว ไม่คำนวณ success rate หากไม่มีนิยาม outcome/denominator ที่ยืนยัน หากเสนอ overdue ให้ใช้ TargetDate < เวลาอ้างอิงและ non-terminal ที่ mapping ยืนยัน โดย null target แยกเป็น missing target ห้ามใช้เป็น failure

## 6. API architecture และ contract ที่เสนอ

เส้นทาง: browser → SWA auth/roles → monitoring handlers → validation/service → MSSQL read-only repository → dbo.Internal_ProjectPlanning ไม่มี browser ต่อ SQL, ไม่มีเรียก sync, ไม่มีใช้ deployment-store ที่มี write

ไฟล์ใหม่ที่เสนอ:

- `api/deployment-monitoring/{index.js,function.json}`: GET list
- `api/deployment-monitoring-detail/{index.js,function.json}`: GET route `deployment-monitoring/{id}`
- `api/deployment-monitoring-summary/{index.js,function.json}`: GET summary/filter metadata
- `api/shared/deployment-monitoring-{sql,service,status,validation}.js`
- tests ตามรูปแบบ repo; `public/deploy-history.{html,js,css}` เปลี่ยนเมื่อ G0/API contract ผ่าน

List: `GET /api/deployment-monitoring?from=2026-10-22&to=2026-10-22&pageSize=50&cursor=...&status=...&project=...&q=...` วันที่ from/to เป็นวันปฏิทิน Asia/Bangkok รวมวัน to; server แปลงเป็น [from, toExclusive) ของเวลาที่ DB เก็บจริง ใช้ default วันนี้, max 31 วันในระยะแรก, pageSize 1..100 ค่าเริ่มต้น 50, q ≤100 ตัวอักษร, project ≤100, status integer หรือ token unknown ที่นิยามชัดเจน; reject input เกินขอบเขต/unknown parameter ที่เสี่ยง

ตัวอย่าง response เชิงรูปแบบ (ไม่ใช่ผลจริง):

```json
{"ok":true,"items":[],"page":{"pageSize":50,"nextCursor":null},"range":{"from":"2026-10-22","to":"2026-10-22","timezone":"Asia/Bangkok"},"source":"Internal_ProjectPlanning","fetchedAt":"2026-10-22T00:00:00Z","mappingVersion":"unconfirmed"}
```

ลำดับคงที่ `TargetDate DESC, ID DESC` หลังยืนยัน uniqueness; cursor ผูก filter/range/sort/version พร้อม validate ขนาดและชนิด ห้ามนำ cursor ไปเป็น SQL fragment หาก ID ไม่ unique ต้องเลือก stable key ก่อน หลีกเลี่ยง OFFSET หน้าลึก; เปลี่ยน filter ต้อง reset cursor อธิบายว่าหน้าข้อมูลเป็น live และอาจเปลี่ยนระหว่าง refresh ไม่อ้างเป็น snapshot เดียวข้าม requests

Detail รับ positive integer ID ส่งเฉพาะ field allowlist; 404 เมื่อไม่พบ; ไม่ใส่ HTML จาก SQL; ไม่มี full raw row endpoint Summary ใช้ filters เดียวกับ list แต่ aggregate ทั้งช่วง ไม่ใช่เฉพาะหน้า; counts แยก raw/normalized/unknown และ fetchedAt ของตัวเอง UI ไม่อ้างว่าข้อมูลสอง request เป็น atomic snapshot Filter metadata จำกัดจำนวน/ระบุ truncation และค้นหาฝั่ง server เมื่อ project เยอะ

ทุก endpoint: GET เท่านั้น, unsupported method 405, invalid query 400, unauthenticated 401, forbidden 403, DB unavailable/config missing/feature disabled 503, timeout 504 ตาม contract, unexpected 500; error `{ok:false,error:{code,message},requestId}` ไม่ส่ง stack/SQL/server/credential; `Cache-Control: private, no-store` และ JSON content type คงเส้นทาง CSV เดิมทั้งชุด

## 7. Dependency และ connection lifecycle

เลือก `mssql` (Tedious) หลังตรวจ release/engines/Node runtime จริงและ security audit ณ วัน implement; pin รุ่นที่ผ่านการทดสอบและ update `api/package.json` + `api/package-lock.json` ด้วย package manager ห้ามแก้ lock ด้วยมือ ห้าม upgrade package อื่นแบบเหมารวม ค่า Node ใน build workflow ไม่ได้ยืนยัน runtime Functions ต้องตรวจ deployment setting จริง

ทำ connection pool ระดับ module, แชร์ connecting promise, reset promise เมื่อ connect fail เพื่อ recover; limit เริ่มต้น max 5/min 0 ต่อ instance, connect timeout 5s/query timeout 10s เป็นค่าเสนอ ต้อง tune จาก UAT และ scale-out connection budget; ไม่เปิด/ปิด pool ทุก request; event error handler, cancellation เมื่อ client ยกเลิกตาม runtime ที่รองรับ, retry เฉพาะ transient read แบบจำกัด 1 ครั้งภายใน timeout budget ห้าม retry auth/TLS/config error วนซ้ำ

ใช้ server-side settings เช่น MONITORING_SQL_SERVER/DATABASE/USER/PASSWORD หรือ identity configuration ที่ infrastructure รองรับจริง; ไม่ใส่ค่าจริงใน docs, local settings tracked, static frontend หรือ API response Secret เก็บใน platform settings/Key Vault ตาม platform ที่รองรับ ตั้ง encrypt=true, trustServerCertificate=false พร้อมตรวจ certificate/hostname ไม่ bypass TLS เพื่อแก้ connectivity

เอกสาร driver: [node-mssql](https://tediousjs.github.io/node-mssql/) และ [Tedious connection options](https://tediousjs.github.io/tedious/api-connection.html) ใช้ประกอบการตรวจตามรุ่นที่ pin; แผนนี้ยังไม่ได้เพิ่ม driver

## 8. Security ที่ต้องตรวจจริง

- เพิ่ม SWA role routes สำหรับ API ใหม่และคง role หน้าเดิม; handler เรียก `auth.requireAnyRole(...,['it_support_approve','admin'])` ก่อนอ่าน config/connect SQL ทุกครั้ง
- เชื่อ header principal ได้เฉพาะหลัง trusted gateway; ยืนยัน direct Functions URL ไม่รับ header ปลอมจาก internet หากแยก API hosting ต้องมี authentication ที่ตรวจ token/signature/gateway restriction จริง การ decode base64 อย่างเดียวไม่ใช่การพิสูจน์ identity
- DB principal ให้ SELECT เฉพาะ table/approved view เท่าที่จำเป็น ไม่มี db_owner/db_datawriter/DDL/EXEC blanket; application connection read-intent ไม่ได้ใช้แทน permission ตรวจ effective permissions และ role membership โดย DBA; ไม่ลอง write ใน production เพื่อทดสอบ read-only
- ไม่มี SQL input interpolation: bind nvarchar/int/datetime ด้วยชนิดชัดเจน; identifiers/table/order เป็นค่าคงที่หรือ allowlist, escape LIKE `%`, `_`, `[` ด้วย ESCAPE ที่เลือกและทดสอบ
- ใช้ textContent/escapeHtml สำหรับค่าจาก DB; URL ต้อง parse และ allowlist HTTPS + hosts ที่อนุมัติ ปฏิเสธ javascript/data/file/UNC ไม่ auto-fetch ลิงก์หรือ JSON และไม่ proxy remote document; external link rel noopener noreferrer
- ไม่ log row/SQL parameters/connection string; log requestId, duration, row count, error class, mapping version และ principal identifier ตาม retention ที่อนุมัติ ห้ามเอา SQL error.message มาใส่ deployment-http.fail เดิม
- ไม่มี shared public cache และไม่มีเก็บข้อมูล DB ใน localStorage; ระวัง metadata leak ของ summary/filter; scope/row visibility ต้องเหมือน list/detail หากต้องแยกทีมให้ยืนยัน policy ก่อน และพิจารณา DB view/RLS กับ DBA แทนการเชื่อ client filter ดู [Microsoft RLS](https://learn.microsoft.com/en-us/sql/relational-databases/security/row-level-security?view=sql-server-ver17)

## 9. SQL performance และความถูกต้องของเวลา

ใช้ explicit projection และ parameterized query; list ไม่อ่าน nvarchar(max)/เอกสารยาว; range filter `TargetDate >= @from AND TargetDate < @toExclusive` ไม่ใช้ CAST/CONVERT/DATEPART ครอบคอลัมน์ใน WHERE ไม่ใช้ NOLOCK เพราะยอมรับ dirty/missing/duplicate row ไม่ได้ ไม่เปลี่ยน isolation/RCSI ของ database โดยพลการ

เวลาจาก SQL datetime ไม่มี offset: DBA ต้องยืนยันว่าเก็บ UTC หรือ Bangkok local ก่อนแปลง ถ้า local ให้คง wall-clock semantics อย่างชัดเจนและทดสอบ driver useUTC ให้ตรง ไม่เติม Z ให้ local time ห้ามใช้ browser timezone ตัดสิน “วันนี้” ใช้ IANA Asia/Bangkok เสมอ ค่าที่ null/invalid แสดง “ไม่ระบุ” ไม่เป็นปี 1970

หลังตรวจ plan จริง เสนอ index `(TargetDate DESC, ID DESC)` INCLUDE เฉพาะ list fields ที่จำเป็น หรือ `(Status,TargetDate,ID)` เมื่อ workload สนับสนุน ให้ DBA ประเมิน indexes เดิม/ต้นทุน write/storage/stats; แผนนี้ไม่สร้าง index/DDL การค้นหา `%keyword%` อาจ scan แม้มี index; ระยะแรกจำกัดวัน/q/debounce และเริ่มจาก exact/prefix search fields ที่ตกลง ไม่เพิ่ม full-text โดยอัตโนมัติ

วัด actual execution plan, logical reads, elapsed/CPU, pool waits, payload, p50/p95 และ concurrent users ใน UAT โดย DBA เห็นภาระ ไม่มี full-table count ทุก refresh; summary ใช้ conditional GROUP BY ใน range; ไม่ใส่ COUNT OVER ทุก page โดยไม่วัด ค่าเป้าหมายเสนอ: warm API p95 ≤2s ที่ 20 concurrent users ช่วง 31 วัน/page 50 และ query ≤1s; payload list ≤200KB ต้องตกลง baseline/ข้อมูลจริงก่อนอ้างว่าผ่าน หากไม่ผ่านให้ลด projection/ปรับ query/index โดย DBA ก่อนเพิ่ม polling

## 10. UI ที่ต้องทำใหม่

คง public path และ app navigation/core.css/auth initialization; เปลี่ยน title/h1 เป็น Deployment Monitoring และคำอธิบายแหล่งข้อมูล ไม่แสดงข้อมูล staging/ADO เป็น SQL fact ไม่มีปุ่ม Sync ADO History บนหน้าใหม่ ให้ปุ่ม “รีเฟรช” อ่าน API เท่านั้น หน้า Report ยังใช้ sync เดิม

ส่วนหลัก: filter วันนี้/7 วัน/30 วัน (Asia/Bangkok), ช่วงวัน, project, raw status พร้อมชื่อที่ยืนยัน, keyword; cards total/readiness/สถานะที่ยืนยัน/unknown; table ID, Project, Owner, TargetDate, Version, Status, IsPrepared, CompletedDate; detail drawer แสดงข้อมูลที่ได้รับอนุญาตและ stage ตามนิยามที่ยืนยัน ไม่มีปุ่มแก้ไขหรือ deploy

มี loading/empty/error/unauthorized/disabled/stale state แยกกัน; ล้มเหลวห้ามแสดง 0 เหมือนสำเร็จ; refresh fail คงข้อมูลก่อนหน้าพร้อมเวลาที่อ่านได้และคำเตือน stale; แสดง fetchedAt ว่าเวลาที่อ่านข้อมูล ไม่ใช่เวลาที่ SQL ปรับปรุงล่าสุด แสดง LastModifiedDate แยก

เริ่ม manual refresh; optional auto-refresh 60s หลัง load test ผ่าน หยุดเมื่อ tab hidden, request ไม่ซ้อน, backoff เมื่อ fail; AbortController และ request sequence กัน response เก่าทับ filter ใหม่ reset paging เมื่อ filter เปลี่ยน keyboard/focus drawer/Escape/aria-live/table headers/สีพร้อมข้อความ และ mobile horizontal scroll ต้องใช้งานได้

## 11. งานสำหรับ VSCode/Codex ตามลำดับ

| Task | สิ่งที่ต้องส่ง / ขอบเขต | Gate/verification |
|---|---|---|
| T00 สำรวจ | อ่าน AGENTS, status/fetch/diff ล่าสุด, call graph หน้า history/report/monthly summary, manifest/lock/workflows | ทำแล้วที่ commit ฐาน; ทวนใหม่ก่อนลงมือ |
| T01 Schema discovery | ใช้ SQL ที่แนบ + owner ยืนยัน 57/49, PK/nullability/timezone/scope/mapping/field allowlist | G0; ต้อง DB owner/DBA |
| T02 Architecture | ยืนยัน SQL UAT route/identity/host trust, ADR และ timeout/connection budget | ห้ามเปิด firewall กว้าง/ต่อ prod ทดแทน UAT |
| T03 Contract | DTO/filter/range/cursor/errors/mapping version + fixture สังเคราะห์ไม่ใช้ข้อมูลจริง | review contract ก่อน API/UI |
| T04 Adapter | เพิ่ม driver ที่ pin/lock, pool lifecycle, parameterized read repository, safe error wrapper, off switch | tests security/SQL review; ไม่ใช้ deployment-store |
| T05 Endpoints | list/detail/summary + function.json + explicit route roles; feature flag default off | auth ก่อน DB, no writes, methods restricted |
| T06 UI replace | เขียน history html/js/css ใหม่, เปลี่ยน label activity ตามจำเป็น, ใช้ API ใหม่ | URL เดิม; ไม่แก้ report sync |
| T07 Verification | unit/integration/UI/regression/load/security + บันทึกผล | G1 automated; DB tests ต้อง UAT |
| T08 UAT | เทียบ source app/SQL วันจริงและ 52844, owner signoff/mapping signoff, rollback rehearsal | G2 UAT signoff เป็นหลักฐาน |
| T09 Release | change window, backup artifact/config, approver และ release approval, enable flag | G3 อนุมัติ production แล้วเท่านั้น |

ทำ T00 และเตรียม T01 แล้ว งาน T02-T09 ยังไม่เริ่มเนื่องจาก G0 ไม่ผ่าน สามารถสร้าง fixture/contract tests ใน branch แยกได้หลังตกลง contract แต่ไม่อ้างว่าเป็น integration กับข้อมูลจริง ไม่ต้องขออนุมัติทำงาน reversible ซ้ำในขอบเขตเดิม; ขอเฉพาะข้อมูลที่ยังขาดหรือ release approval ตาม gate

### Prompt ส่งต่อให้ VSCode/Codex

> ทำตามเอกสารนี้โดยอ่าน code/AGENTS/dependencies ล่าสุดก่อนเปลี่ยนไฟล์ รักษา /deploy-history.html และ /deploy-history; ห้ามลบหรือเปลี่ยน contract api/sync-deployments, api/deploy-history และ CSV consumers ของ Report/Monthly Summary สร้าง monitoring API แยก ใช้ dbo.Internal_ProjectPlanning แบบ SELECT-only ยืนยัน schema จาก discovery ก่อน (แชตมี 57 columns แม้คำขอระบุ 49) ห้ามเดารหัส Status/DeployType/GetType/timezone ห้ามใช้ deployment-store ซึ่งเป็น Azure Tables write model ใช้ข้อมูลสังเคราะห์ใน tests แยก commit plan/API/UI ตรวจ auth ก่อนต่อ DB และไม่รั่ว SQL error ห้าม push main/master, merge หรือ deploy production ก่อน UAT/release approval ระวัง PR ของ repo นี้ทำ preview deployment อัตโนมัติ รายงาน task ที่เสร็จ/หลักฐาน tests/สิ่งที่ต้องขอจาก DBA ตาม gate

## 12. Test matrix และคำสั่งตรวจ

| ระดับ | กรณีสำคัญ / ผลที่คาด |
|---|---|
| Unit validation | missing dates default Bangkok today, invalid calendar/leap date, reversed/overlong range, pageSize 0/101, huge cursor, q ยาว, ID invalid → 400 โดยไม่ query |
| Unit mapping | 0 ไม่หายจาก falsy, null/negative/new code → unknown, IsPrepared และ completion ไม่บังคับ success, ทุก code ที่ owner ยืนยัน round-trip raw ได้ |
| Unit SQL/pool | typed parameters รวม Thai/quote/LIKE wildcard/injection; no SELECT *, ไม่มี DML; pool shared/recover fail/timeout/retry bounded; cursor sort/filter binding |
| Auth/security | missing/malformed principal 401, wrong role 403, roles ที่อนุญาตผ่าน, reject methods, forged principal ผ่าน direct host ต้องใช้ไม่ได้; responses/log ไม่เผย connection/SQL |
| SQL integration UAT | schema drift/permissions deny, ID 52844 หรือ 404 ตามจริง, null fields/datetime, วันเริ่ม 00:00 และสิ้นวัน, stable pagination ties, counts ทั้ง filter ตรง SQL, unknown code |
| UI | loading/empty/stale/503/401 redirect HTML ที่ safeFetchJson ต้องจับได้, rapid filters/cancel, pagination/reset, Thai long text, XSS/unsafe URL, keyboard/mobile |
| Regression | Report sync invocation/response เท่าเดิม, CSV read history/report-summary/monthly-summary, หน้า deployment/report Azure Tables เดิม, activity link และ role rules เดิม |
| Performance | UAT 20 concurrent ตาม workload, measure cold/warm/pool/SQL/payload, query timeout, DB unavailable/recover, polling ไม่ซ้อน |

ก่อนเปลี่ยน code ให้ติดตั้งด้วย `npm ci --prefix api` และรัน `npm test --prefix api` บันทึก baseline จากนั้นรัน suites เดิมเพิ่ม `node --test api/shared/deployment-model.test.js api/shared/deployment-excel.test.js api/deployment-summary/index.test.js` และ suites ใหม่ชัดเจน (npm test เดิมไม่ครอบคลุมทั้งหมด) Syntax check handlers/modules ที่แก้ด้วย node --check; ตรวจ function.json/staticwebapp JSON และ routes ทั้ง normal/method fallback; build operations-ui ตาม workflow เมื่อทำ integration release validation

SQL tests ต้อง opt-in ผ่าน UAT config ห้าม fallback prod เมื่อไม่มี UAT; unit tests inject fake repository; ใช้ random synthetic fixtures ที่ตรวจพฤติกรรมจริง ไม่ snapshot implementation อย่างเดียว; สำเนาแผนปัจจุบันเป็น docs/SQL เท่านั้นจึงยังไม่รัน runtime tests และไม่อ้างผลผ่าน

## 13. Rollout / rollback

1. เก็บ baseline commit/artifact และ runtime configuration ปัจจุบัน (secrets อยู่ที่ secret store); จัด branch plan และ branch implementation แยกจาก main/master ไม่ push ระหว่างยังไม่มี preview environment ที่อนุมัติ เพราะ workflow PR ก็ deploy
2. เสนอ config `DEPLOYMENT_MONITORING_ENABLED=false` ที่ API ตรวจ ก่อนเปิด UAT; flag=false → controlled 503 ไม่ fallback CSV แล้วติดป้าย MSSQL ส่วน UI fallback ต้องออกแบบชัดเจน การปิด flag เพียงอย่างเดียวไม่ได้คืนหน้า Archive
3. deploy เฉพาะ UAT ที่แยก identity/database; เปิด flag; ตรวจ smoke/auth/real sample/performance; บันทึก owner, เวลา, test evidence และ UAT approval พร้อม mapping version
4. หลัง G2 และ production release approval จึงทำ release ตาม change window ตั้ง least privilege/connectivity/flag และเฝ้าดู 5xx/timeouts/latency/unknown count เทียบ baseline
5. rollback trigger ที่เสนอ: ข้อมูลผิด/สิทธิ์รั่วทันที, 5xx >1% หรือ p95 >2s ต่อเนื่อง 10 นาที (ยืนยันเกณฑ์กับ owner ก่อน release); ปิด flag ลด query load แล้วคืน previous validated artifact หรือ revert เฉพาะ commit UI/API/config ของงานนี้ผ่าน release pipeline; อย่า reset ทั้ง repo/ทับงานอื่น
6. คืน archive html/js/css เดิมและ route config จาก baseline จึงกลับเป็นหน้า CSV ได้; คง sync/report/API history/CSV artifacts ไว้ตลอด; ไม่มี SQL data migration จึงไม่มี data rollback แต่ config/secrets/network change ถ้ามีต้องคืนโดย owner
7. smoke `/deploy-history.html`, alias, roles, Report sync, report-summary และ monthly-summary หลัง rollback; บันทึกสาเหตุและปิด release จนแก้และ UAT ใหม่

## 14. Acceptance criteria

- [ ] AC01 URL html และ alias เดิมใช้ได้พร้อมชื่อ Deployment Monitoring และสิทธิ์เดิม
- [ ] AC02 schema live ที่ owner ยืนยันแนบหลักฐานแบบปลอดข้อมูลจริง แก้ข้อขัดแย้ง 49/57; key/timezone/scope มีข้อสรุป
- [ ] AC03 monitoring อ่าน SQL table/view ที่อนุมัติเท่านั้น ไม่มี DML/การ sync/ADO-trigger จากหน้านี้
- [ ] AC04 list/detail/summary/filters/pagination ตรงผล UAT รวม ID 52844 หรือ not-found และ boundary วัน Bangkok
- [ ] AC05 Status raw คงอยู่ mapping owner-approved/versioned; unknown เป็นกลางและไม่ปน success/failure
- [ ] AC06 field allowlist/roles/direct-host trust/SELECT-only/TLS/parameterization ผ่านการตรวจ ไม่มี secrets/row data ใน repo/log/browser เกินสิทธิ์
- [ ] AC07 error/empty/stale/loading แยกชัดเจน; ไม่มี error detail รั่ว; keyboard/mobile ใช้ได้
- [ ] AC08 report.js → sync และ CSV reporting/monthly summary รวม Azure Tables deployment portal ทำงานเดิม
- [ ] AC09 automated/regression/UAT/load ผ่านตามเกณฑ์ที่ตกลง และไม่มี blocker ค้าง
- [ ] AC10 rollback ซ้อมแล้ว มี baseline/config owner และ release approval ก่อน production

## 15. สิ่งที่ยังต้องได้รับและสถานะส่งมอบ

ต้องได้จาก DBA/owner: schema metadata ผล discovery ที่ปกปิดข้อมูลส่วนบุคคล, mapping/source lookup, DB time convention, source field visibility, UAT connection/network/identity ที่อนุญาต, ID uniqueness และ performance budget ไม่ต้องส่งรหัสผ่านในแชต ให้ตั้งใน secret store ของ environment

ส่งมอบแผนนี้และ SQL อ่านอย่างเดียวไว้ในสำเนา repo แยกสำหรับเปิดใน VSCode; ไม่แตะ workspace เดิมที่มี uncommitted changes และไม่ส่งข้อความให้แชตอื่น ไม่มีการ commit/push/PR/production deployment อัตโนมัติในขั้นนี้ เพราะ PR workflow มี deployment side effect ยังไม่สามารถพัฒนา SQL adapter ที่ตรวจยืนยันกับ DB หรือแทนหน้าจริงโดยปลอดภัยก่อน G0
