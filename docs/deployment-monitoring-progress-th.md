# Deployment Monitoring: ผลตรวจและงานเตรียม implementation

วันที่ 22 ตุลาคม 2026 (Asia/Bangkok)

## สถานะล่าสุดหลังตรวจ UAT และ source แบบอ่านอย่างเดียว

ส่วนนี้แทนสถานะ G0 ในบันทึกรอบก่อนด้านล่าง ซึ่งเก็บไว้เป็นประวัติ **G0 ยัง pending** แต่เชื่อม UAT และตรวจ metadata ได้แล้วตามการอนุมัติแยกของผู้ใช้ ไม่ได้อ่านแถวข้อมูลจาก source table และไม่ใช่ผล API integration/UAT signoff

- ผู้ใช้ยืนยันปลายทาง UAT; เชื่อมด้วย Microsoft Entra interactive/MFA และ TLS ที่ตรวจ certificate โดยไม่เก็บ token/password ในเอกสารหรือ repository
- ผล permission probe ของ identity ที่ใช้: SELECT=1; INSERT/UPDATE/DELETE/ALTER และ CONTROL ของ source=0, CONTROL database=0 และ flags db_owner/db_datawriter/sysadmin=0 เป็นผล ณ เวลาตรวจ ไม่ใช่การรับรองสิทธิ์ทุก object หรือ identity ของ API ในอนาคต
- Live metadata มี **57 คอลัมน์**; column_id มีช่องว่างจึงห้ามใช้ค่าสูงสุดเป็นจำนวนคอลัมน์ ID เป็น int NOT NULL IDENTITY และอยู่ใน unique clustered primary key ที่ active/unfiltered ยืนยัน uniqueness ผ่าน constraint โดยไม่ได้ scan หา duplicate
- พบ indexes บน Status และ TargetDate; ยังไม่ได้ตรวจ execution plan/performance ของ monitoring queries
- Extended properties และ foreign keys ไม่คืนรายการที่มองเห็น; database/target VIEW DEFINITION=0 และ module discovery ไม่คืน reference ที่มองเห็น จึงยังสรุปไม่ได้ว่าไม่มี lookup/mapping หรือ source modules
- พบชื่อตาราง/คอลัมน์ที่อาจเป็น lookup หลายรายการ แต่ยังไม่มีหลักฐาน mapping ที่ยืนยันว่าเป็นของ source นี้ และไม่ได้อ่าน lookup data
- หน้า Monitor Deployment Status ที่ผู้ใช้เปิดอยู่แสดง pipeline และส่ง item.Status มาแสดงโดยตรง ไม่พบ Internal_ProjectPlanning/DeployType/GetType/Priority ใน inline scripts ที่ตรวจ มีทั้ง UTC และการบวก 7 ชั่วโมง จึงยืนยัน timezone ของ SQL table จากหน้านี้ไม่ได้ ไม่ refresh/กด action/เรียก API เพิ่มในการตรวจนี้
- ค้น source ใน workspace ไม่พบโค้ดที่บันทึก Internal_ProjectPlanning; deployType ในระบบ Excel/Report เดิมเป็นข้อมูลอีกแหล่ง ใช้แทน SQL mapping ไม่ได้

ยังต้องมีหลักฐานจาก source app หรือ DBA/owner: mapping ของ Status/DeployType/GetType/Priority พร้อม version/evidence, timezone แต่ละ datetime และ stage semantics, scope/role visibility/field allowlist และ SQL connectivity/authentication จาก API hosting จริง จึงยังไม่ลงทะเบียน endpoint/สร้าง production SQL adapter/เปลี่ยน public UI หรืออ้าง integration ผ่าน

ขอเพียง path/repository ของระบบที่สร้าง Project Planning หรือเอกสารยืนยันจากเจ้าของระบบ ไม่ต้องส่ง password/token/ข้อมูลบุคคล ไม่มี push/PR/deploy

## Phase 0 / T00

- อ่าน AGENTS.md ใน workspace แล้ว; ข้อกำหนดปัจจุบันมีผลเหนือข้อความอ้างอิง AGENTS ในแผน
- ตรวจ git status ก่อนแก้ไข พบงานผู้ใช้เดิมทั้ง tracked/untracked; ไม่ reset, stash, stage หรือแก้ไฟล์เหล่านั้น
- fetch origin/main สำเร็จ: HEAD และ origin/main ตรงกันที่ d1b6f19; สร้าง branch `feature/deployment-monitoring-foundation-20261022`
- คัดลอกแผนและ discovery SQL จาก path ที่ผู้ใช้ระบุ โดยตรวจว่าปลายทางยังไม่มีไฟล์ก่อนคัดลอก
- ทวน call graph, manifests/locks และ workflows: รายละเอียดแหล่งข้อมูลและ consumers ในแผนยังตรงกับโค้ด
- `/deploy-history.html` และ alias `/deploy-history` ยังมี role restriction เดิม; ไม่มีการแก้ route/UI
- `report.js` ยัง POST sync-deployments; history, report-summary, monthly-summary ยังใช้ SharePoint CSV เดิม
- dependencies API ยังไม่มี mssql/tedious; ไม่เพิ่ม driver ก่อน G0 ไม่เปลี่ยน package manifests/locks และไม่ reinstall node_modules ในรอบนี้ ใช้ dependencies ที่ติดตั้งอยู่ทดสอบ จึงยังไม่มีผล clean npm ci validation
- PR opened/synchronize/reopened ทำ preview deployment; push main/master ทำ deployment จึงยังไม่มี push/PR/merge/deploy

## G0 ยังไม่ผ่าน

ไม่มีหลักฐาน UAT endpoint/identity/network/SELECT authorization ในงานนี้ ไม่พบชื่อ environment settings MSSQL/SQLSERVER/SQL_CONNECTION/DEPLOYMENT_MONITOR จาก process ที่ตรวจ (ไม่ได้อ่านหรือแสดงค่า secrets) จึงไม่ได้เปิด connection หรือรัน discovery SQL

SQL ที่คัดลอกมี STOP ก่อน queries ข้อมูล: ต้องยืนยัน timezone/metadata ก่อน ไม่ควรรันทั้งไฟล์รวดเดียว ตัวอย่าง boundaries ใน SQL สมมติ Bangkok local จึงยังใช้เป็นผลจริงไม่ได้

57 columns เป็น inventory จากข้อความในแผนเท่านั้น ยังไม่ใช่ schema live ที่ยืนยันแล้ว ไม่เดา ID uniqueness, timezone, Status, DeployType, GetType, Priority, stage หรือ environment จากข้อมูลนี้

ข้อมูลที่ต้องขอจาก DBA/owner:

1. UAT server/database/network route และ identity ที่อนุญาต พร้อมหลักฐาน effective SELECT-only permissions/role membership; ตั้ง secrets ใน environment/secret store ไม่ส่ง password ในแชต
2. ผล metadata discovery ที่ปกปิดข้อมูลส่วนบุคคล: 49/57 columns, type/nullability, PK/unique key, indexes, SQL version/collation และวิธีตรวจ duplicate/null ตามภาระที่ DBA อนุมัติ
3. timezone ของ datetime แต่ละ field และความหมาย stage; scope ที่อนุญาต/row visibility/field allowlist ของ list/detail
4. mapping พร้อม owner/evidence/version ของ Status, DeployType, GetType, Priority; ผลช่วง 30 วันและการเทียบ source app/วันนี้/ID 52844 (หรือยืนยันว่าไม่พบ)
5. connectivity ของ managed SWA API หรือ architecture ที่รองรับ SQL network พร้อม trusted gateway/direct-host restrictions และ performance/connection budget ที่ยอมรับ

## งานที่ทำต่อโดยไม่พึ่ง DB

- เพิ่ม pure validation สำหรับวันปฏิทิน Bangkok, SQL datetime minimum, ช่วงไม่เกิน 31 วันรวมวันปลายทาง, pageSize 1–100, text length, raw integer status/unknown และ positive SQL int ID
- `toExclusiveDay` เป็นวันปฏิทินเท่านั้น ยังไม่ใช่ SQL parameter และยังไม่ตัดสิน DB timezone
- เพิ่ม mapping version `unconfirmed`: ทุก code รวม 0/negative/new/null แสดง unknown; terminal เป็น null ไม่อนุมาน success/overdue/readiness จาก timestamps
- เพิ่ม synthetic tests และทดสอบ legacy handler จริงผ่าน fake SharePoint download เพื่อป้องกัน annual/default CSV contract และ quoted multiline parser
- เป็น T03 บางส่วนเพื่อ review เท่านั้น ยังไม่มี HTTP endpoints, SQL adapter/service, cursor, summary หรือ driver; cursor ถูก reject ใน helper นี้จนกว่าจะยืนยัน unique ordering key และเพิ่ม contract ที่ผูก filters ก่อนใช้งานจริง
- ไม่แทน HTML/JS/CSS เพราะแผนข้อ 6 และ T06 กำหนดให้ G0/API contract ผ่านก่อน; ยังไม่มี UI commit เพื่อไม่อ้างว่าหน้าจริงเสร็จ

## ผลตรวจ

- `npm test` เริ่มต้นรันไม่ได้เพราะ Node test runner spawn EPERM ภายใต้ sandbox ไม่ใช่ผล assertion ของ suite
- รันแต่ละไฟล์แยกด้วย `node --test --test-isolation=none <file>` เพื่อลดข้อจำกัด spawn และป้องกัน module mock ข้ามไฟล์: รวม 20 ไฟล์ 142 tests, ผ่าน 138 ล้มเหลว 4 (รวม deployment-model/excel/summary เพิ่มเติมแล้ว)
- tests ใหม่ผ่าน 9/9: legacy CSV compatibility 3 และ monitoring contract 6; เป็น synthetic/unit เท่านั้น
- suites Report Summary, Monthly Summary, LINE Monthly Summary, Deployment Model/Excel/Summary ผ่านทั้งหมด
- baseline failures เดิมก่อนเพิ่ม monitoring modules: Portal inferred PRD (appservice-logs), Operations capabilities (operations-api), related work item description และ related preview description (operations-service); ไม่แก้งาน Operations/Portal ในรอบนี้
- node --check ของ monitoring modules และ git diff --check ผ่าน
- runtime ที่ทดสอบในเครื่องคือ Node v24.15.0; workflow/SWA ระบุ Node 22 ยังไม่ได้ทดสอบ runtime 22 จริง
- ไม่มี MSSQL integration, UI/browser, load, permission หรือ UAT signoff ผ่าน; ไม่อ้าง AC02–AC10 ว่าผ่านจาก unit tests

แยก commit เอกสารแผนออกจาก API preparation/tests และเก็บงานค้างผู้ใช้ไว้; ไม่มี task-generated extraction/build/temp artifacts ที่ต้องลบ

## งานต่อรอบที่สอง: security boundary และ UI state prototype

เมื่อผู้ใช้สั่งให้ดำเนินการต่อ ยังไม่มีหลักฐาน DBA/G0 เพิ่ม จึงเตรียมเฉพาะส่วนที่ไม่เรียก DB และไม่เปลี่ยนหน้าจริง:

- `api/shared/deployment-monitoring-http.js` เป็น handler factory ที่ยังไม่ลงทะเบียน function.json/route ใด รับ service ผ่าน dependency injection เท่านั้น ไม่มี SQL driver/adapter และไม่มี network call โดยตัว factory
- list/detail/summary ตรวจ role ผ่าน auth helper เดิมก่อนอ่าน enabled setting หรือเข้าถึง service; enabled callback ต้องคืน boolean true เท่านั้นและค่าเริ่มต้นปิด รองรับ GET เท่านั้น ตรวจ input ก่อน service, detail ไม่พบส่ง 404 และ service ไม่มีส่ง 503
- error response ใช้ `{ok:false,error:{code,message},requestId}` และข้อความคงที่ ไม่ส่ง exception/stack/query/config; known service classifications MONITORING_TIMEOUT/UNAVAILABLE แปลงเป็น 504/503 ส่วนข้อผิดพลาดอื่นเป็น 500 ไม่ใช้ deployment-http.fail เดิม
- JSON responses ทุกกรณีมี private/no-store และ requestId ที่ server สร้างเอง ไม่รับค่าจาก header ผู้เรียก
- factory ยังไม่ได้ทำ DTO projection: future service ต้องส่งเฉพาะ approved DTO ห้ามส่ง SQL row ตรง ๆ; field allowlist ยังรอ owner จึงยังไม่ใช่ API ที่พร้อมเผยแพร่
- principal header ใช้ได้เฉพาะ trusted SWA gateway; unit tests ไม่ได้พิสูจน์ direct-host trust จึงยังไม่ลงทะเบียน endpoint หรืออ้างว่าทดสอบป้องกัน header ปลอมจาก internet ผ่าน
- `docs/prototypes/deployment-monitoring-controller.mjs` เป็น headless UI state prototype อยู่นอก public ไม่ถูกเสิร์ฟผ่าน production workflow และไม่เรียก fetch เอง; loader/render ต้อง inject
- prototype แยก loading/ready/empty/error/disabled/unauthorized/forbidden/stale, ยกเลิกคำขอก่อนหน้าและใช้ sequence กัน response เก่าแม้ loader ไม่สนใจ abort, เก็บข้อมูลเดิมเฉพาะ refresh filter เดิม, ล้างข้อมูลเมื่อสิทธิ์หาย และเก็บ fetchedAt จาก response จริง ไม่สร้างเวลา SQL update เอง
- แยก MONITORING_DISABLED จาก service unavailable; ไม่แสดงความล้มเหลวเป็นจำนวน 0 และไม่เก็บข้อมูลใน localStorage
- ยังไม่มี visual prototype/DOM rendering, drawer/keyboard/mobile/browser verification, summary UI, cursor หรือ pagination เนื่องจากยังรอ contract/G0 และ field visibility; ไม่อ้างว่าทำ T06 หรือ AC01 เสร็จ

ผลตรวจรอบนี้: tests ใหม่ HTTP security 8/8 และ UI state 5/5 ผ่าน รวมกับ contract/legacy tests รอบก่อนเป็น 22/22 ผ่าน รัน Report Summary, Monthly Summary, LINE Monthly Summary, Deployment Model/Excel/Summary ซ้ำรวม 25/25 ผ่าน; syntax checks ผ่าน ไม่มีการรัน full baseline ใหม่หลังผล 138/142 ด้านบน เพราะไฟล์ที่เพิ่มไม่เปลี่ยน Operations/Portal เดิม

G0, SQL integration, parameterization/driver, trusted-host deployment checks, UAT/load และ release ยังไม่ผ่านและไม่ได้ดำเนินการเชื่อมต่อ ไม่มี push/PR/merge/deploy ตรวจ status ก่อนส่งงานและไม่สร้าง temporary build artifacts

## งานต่อรอบที่สาม: หน้าต้นแบบที่เปิดตรวจได้

- เพิ่ม HTML/CSS/browser entry/fixtures นอก public ใน `docs/prototypes/` พร้อม server `scripts/preview-deployment-monitoring.cjs` ที่ bind 127.0.0.1 และเสิร์ฟเฉพาะ allowlist ปิด network fetch ผ่าน CSP
- UI ใช้ state controller เดิม: วันที่ Bangkok, project/raw status/keyword filters, readiness/unknown cards, table และ dialog แบบอ่านอย่างเดียว แสดง banner ว่า synthetic ตลอด ไม่เดา code outcome หรือ timezone จริง
- เพิ่ม scenario controls สำหรับ success/empty/stale/error/503/401/403 และ HTML/XSS text เพื่อทบทวนพฤติกรรมโดยไม่ต้อง DB
- ตรวจจริงใน Chrome: filter 0, dialog/Escape/focus, stale คง timestamp/rows, auth ล้างข้อมูล, empty/disabled/unavailable/forbidden, hostile text ไม่สร้าง image/link หรือ alert; desktop และ mobile viewport 390×844 ผ่านการตรวจภาพ/DOM ไม่มี page overflow แนวนอน ตารางเลื่อนในพื้นที่ตัวเองได้ คืน viewport override แล้ว
- เพิ่ม tests 2 กรณีสำหรับ synthetic filters/Bangkok boundaries และ preview server allowlist/traversal/API/credential-path rejection พร้อม CSP/method checks
- รวม Monitoring/History/preview unit tests ผ่าน 24/24; syntax checks ของไฟล์ใหม่ผ่าน; ไม่รัน baseline เดิมซ้ำโดยไม่มีการแก้ไฟล์ระบบเดิม
- วิธีเปิดและข้อจำกัดอยู่ใน `docs/prototypes/README.md`; server local เป็นเครื่องมือทบทวน ไม่ใช่ UAT deployment หรือ public hosting
- ยังไม่แทนหน้า production, ไม่เพิ่ม endpoint/SQL adapter/cursor/summary integration และไม่มี push/PR/merge/deploy; G0 ยังรอข้อมูล DBA/owner รายการเดิม ไม่สร้าง artifact ZIP/build/temp และรักษางานค้างผู้ใช้

## งานต่อรอบที่สี่: ตรวจข้อผิดพลาดก่อน integration

- แก้ handler factory ไม่ให้ service envelope ที่มี ok:false หรือ error ถูกเปลี่ยนเป็น HTTP 200 และไม่ส่ง error payload กลับผู้ใช้
- แก้ UI state controller ปฏิเสธ fetchedAt ที่ parse ไม่ได้หรือไม่มี offset ก่อนแทนข้อมูลเดิม; คง stale dataset และ timestamp ที่เคยอ่านสำเร็จ
- เพิ่ม regression tests สองกรณี ชุด Monitoring/History/preview ผ่าน 26/26; ยังเป็น synthetic/unit และ loopback preview tests ไม่ใช่ MSSQL integration
- เตรียม `docs/deployment-monitoring-dba-handoff-th.md` เป็นแบบฟอร์มที่กรอกส่งกลับได้สำหรับ UAT authorization/config reference, schema/key/timezone, mapping/scope/field visibility และหลักฐาน G0 ไม่มี credential/ข้อมูลจริง และยังไม่ได้ส่งข้อความให้ DBA หรือบุคคลอื่น
- ขอเฉพาะข้อมูลที่ยังขาดจากผู้ใช้แล้ว ยังไม่มีหลักฐาน G0 เพิ่ม จึงยังไม่ต่อ DB/ลงทะเบียน API/เปลี่ยน public UI หรืออ้าง UAT ผ่าน; ไม่เพิ่ม placeholder endpoint หรือ SQL ที่เดา schema เพื่อเดินข้าม gate

## สรุปตามคำสั่งผู้ใช้: หยุดรอข้อมูล DBA

ผู้ใช้ยืนยันว่าไม่มี UAT/discovery และให้คง G0 pending ไม่เชื่อม production ทดแทน จึงขยายแบบฟอร์ม DBA ให้มี UAT server/database และรูปแบบผล CSV/สรุปรายชุดโดยไม่ใส่ password ทวน diff และทดสอบแยกไฟล์รอบสุดท้าย 23 ไฟล์ 159 tests ผ่าน 155 ล้มเหลวเดิม 4; Monitoring/History/preview ผ่าน 26/26 และ reporting regression ผ่าน 25/25 รายละเอียดไฟล์/commits/หลักฐานและข้อจำกัดอยู่ใน `docs/deployment-monitoring-review-th.md`

งานเตรียมที่ไม่ต้องใช้ DB ในรอบนี้ครบและหยุดรอข้อมูล ไม่มี push/PR/deploy; ปิด preview server ของงานนี้แล้ว เก็บงานค้างเดิมผู้ใช้ทั้งหมด ตรวจ status ก่อนส่งมอบ และไม่มี temporary artifacts ที่ต้องลบ
