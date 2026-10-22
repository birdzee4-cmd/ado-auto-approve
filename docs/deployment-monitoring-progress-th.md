# Deployment Monitoring: ผลตรวจและงานเตรียม implementation

วันที่ 22 ตุลาคม 2026 (Asia/Bangkok)

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
