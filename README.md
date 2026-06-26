# ADO Auto-Approve

ระบบ Dashboard สำหรับตรวจสอบและอนุมัติ Pull Request บน Azure DevOps โดยออกแบบให้ผู้ใช้งานกลุ่ม `IT Support Approve` สามารถเห็นงาน PR ที่รออนุมัติบน branch `staging` ได้จากหน้าเว็บเดียว พร้อมบันทึกผลการดำเนินการลง SharePoint Log, ตรวจสถานะ Build / Policy, แจ้งเตือน Teams เฉพาะเหตุการณ์สำคัญ, ส่ง Daily Summary รายวัน และมีหน้า Merge Lookup สำหรับช่วยตรวจสอบ CI/CD ของงานประเภท Merge

Production URL:

- Dashboard: https://mango-wave-09cff3700.7.azurestaticapps.net/dashboard.html
- Activity: https://mango-wave-09cff3700.7.azurestaticapps.net/activity.html
- Merge Lookup: https://mango-wave-09cff3700.7.azurestaticapps.net/merge.html
- Audit Logs: https://mango-wave-09cff3700.7.azurestaticapps.net/logs.html
- System Health: https://mango-wave-09cff3700.7.azurestaticapps.net/health.html
- Report (Staging Deployments Summary): https://mango-wave-09cff3700.7.azurestaticapps.net/report.html

## Current Status

สถานะระบบล่าสุด:

- ระบบ deploy บน Azure Static Web Apps
- Azure Functions runtime ใช้ Node.js 22
- Authentication ใช้ Microsoft Entra ID ผ่าน Static Web Apps Auth
- Authorization ของ action สำคัญใช้ role `it_support_approve`
- Azure DevOps action สำคัญใช้ delegated user identity หลังผู้ใช้กด Connect Azure DevOps
- การอ่านคิว PR / Build / Policy / Release lookup ยังใช้ `ADO_PAT` แบบ service credential เพื่อให้ Dashboard เห็นคิวกลางอย่างสม่ำเสมอ
- Dashboard หลักเป็น read/action page สำหรับ Active PR Queue และ Release approval ที่รอ action
- MergeCode / MergeCodeProduction ถูกแยกเป็น manual workflow บน Azure DevOps
- Activity เป็นหน้าดู approval log ล่าสุด 24 ชั่วโมง พร้อม filter และ paging
- Audit Logs อ่านจาก SharePoint และเรียงล่าสุดก่อน
- Daily Summary ส่งผ่าน Azure Logic Apps Consumption เวลา 18:00 Asia/Bangkok
- SharePoint Log Retention รองรับ archive/export ก่อน cleanup โดย default เก็บ 365 วัน
- Branch backup ล่าสุดใช้ `staging` ตัวพิมพ์เล็กเท่านั้น

## วัตถุประสงค์

- ลดเวลาการไล่เปิด Azure DevOps หลายหน้าเพื่อตรวจ PR ที่รออนุมัติ
- รวมรายการ PR ที่เกี่ยวข้องกับ `IT Support Approve` ไว้บน Dashboard เดียว
- แสดงสถานะ Approval, Build, Policy และ Attention ให้เห็นเร็ว
- ทำ Approve / Reject PR ปกติผ่านหน้าเว็บได้อย่างปลอดภัย
- ตรวจ Release approval ที่ผูกกับ build run และกด Approve Release ได้เมื่อ Azure DevOps มี pending approval จริง
- ซ่อน action เมื่อผู้ใช้ไม่มีสิทธิ์หรือ vote ไปแล้ว
- บังคับงาน MergeCode / MergeCodeProduction ให้ทำ manual บน Azure DevOps
- บันทึก audit trail ลง SharePoint Log
- ตรวจสอบ log ย้อนหลังจากหน้า Audit Logs
- แจ้ง Teams เฉพาะเคสที่ควรสนใจ เช่น build/policy exception และ Daily Summary
- ช่วยค้นหา CI/CD ที่ต้องใช้สำหรับ PR ประเภท Merge ผ่านหน้า Merge Lookup

## High-Level Architecture

```mermaid
flowchart LR
  User["User / IT Support"] --> SWA["Azure Static Web Apps"]
  SWA --> Frontend["Static Frontend<br/>dashboard / activity / logs / health / merge"]
  Frontend --> API["Azure Functions API<br/>Node.js 22"]
  API --> ADO["Azure DevOps REST API"]
  API --> Release["Azure DevOps Release API"]
  API --> TokenStore["Azure Table<br/>Encrypted ADO user tokens"]
  API --> LockStore["Azure Table<br/>Approval action locks"]
  API --> SP["SharePoint List<br/>ADO AutoApprove Log"]
  API --> Teams["Teams Webhook"]
  Logic["Azure Logic Apps<br/>18:00 Asia/Bangkok"] --> API
```

## Documentation

| Document | Purpose |
|---|---|
| `docs/approve-release-workflow.md` | แผนภาพและ guardrails ของ workflow Approve Release |
| `docs/TECH-REPORT-TH.md` | รายงานสรุปเทคโนโลยี สถาปัตยกรรม และภาพรวมค่าใช้จ่าย |
| `docs/skills/SKILL.md` | ศูนย์รวมคู่มือกฎเกณฑ์และทักษะการพัฒนาของโปรเจกต์ |

## Main Pages

| Page | Path | Purpose |
|---|---|---|
| Login | `/` | Login ผ่าน Microsoft Entra ID |
| Dashboard | `/dashboard.html` | ตรวจ Active PR Queue, Approve/Reject PR, ดู Build/Policy/Release และกด Approve Release เมื่อมี pending approval |
| Activity | `/activity.html` | ดู PR ที่ user approve หรือระบบ detect external approval ใน 24 ชั่วโมงล่าสุด พร้อม filter Build Failed / Policy Pending / source และ paging |
| Merge Lookup | `/merge.html` | กรอก PR ID เพื่อหา CI/CD ของงาน Merge |
| Deploy History | `/deploy-history.html` | ค้นหา คัดกรอง และดูประวัติการรัน Build & Deploy ย้อนหลังบนระบบ Staging |
| Build Diagnostics | `/build-diagnostics.html` | หน้าวิเคราะห์และแปลความหมายข้อผิดพลาดของ Build Log พร้อมเสนอแนวทางแก้ไขภาษาไทย |
| Audit Logs | `/logs.html` | ค้นหา SharePoint Log ตาม PR, action, source, keyword |
| System Health | `/health.html` | ตรวจ Backend, ADO, SharePoint, Teams, Daily Summary, Last Sync/Notification |
| Forbidden | `/403.html` | แสดงเมื่อผู้ใช้ไม่มีสิทธิ์ |
| Report | `/report.html` | ดูรายงานสรุปสถิติผลการดำเนินงานและสถิติ (รายวัน/รายเดือน) พร้อมตัวกรอง All/My actions, scope ของ Staging builds, รายการ failed build ล่าสุด และระบบซิงก์ข้อมูลบิลด์อัตโนมัติเบื้องหลัง |

## Dashboard Behavior

หน้า Dashboard แสดงเฉพาะ PR ที่เกี่ยวข้องกับ:

- target branch เริ่มจาก `refs/heads/staging` หรือเป็น MergeCode target branch ที่ระบบรองรับ
- reviewer group มี `IT Support Approve`
- สถานะ active สำหรับ Active PR Queue
- ซ่อน PR ที่ approval complete + policy/build ไม่มีปัญหา + ไม่มี release approval pending เพื่อไม่ให้ค้างใน Active Queue โดยไม่จำเป็น

ข้อมูลที่แสดง:

- Pull Request: PR ID, title, repository, author, created time
- Branch: From / Into
- Approvals: จำนวนที่ approve เทียบ required approval
- Build / Policy: Build Success, Build Failed, Policy Pending, Policy Approved ฯลฯ
- Release: Release expected, Release approval pending, Release approved, Deploying, Deploy succeeded, Deploy failed, No release yet
- Attention: New, Waiting, Warning, Critical, Stale, Manual
- My Approval: สถานะ vote ของผู้ใช้ปัจจุบัน
- Actions: Approve, Reject, Approve Release, History, Open ADO / Open Release ตามสิทธิ์และสถานะ

### Azure DevOps Connection / Identity Policy

หน้า Dashboard มีสถานะ `Azure DevOps` พร้อมปุ่ม Connect / Disconnect สำหรับผูกบัญชี Azure DevOps ของผู้ใช้ที่ login อยู่

นโยบายปัจจุบัน:

- Read path ใช้ `ADO_PAT` เป็น service credential สำหรับดึงรายการ PR, reviewers, build status, policy status, release lookup, background sync และ health check
- Write/action path ใช้ delegated user token หลัง Connect Azure DevOps ได้แก่ Approve PR, Reject PR และ Approve Release
- SharePoint Log บันทึกผู้ดำเนินการจาก Static Web Apps identity และ action ใน Azure DevOps จะเกิดด้วย Azure DevOps identity ของผู้ใช้ที่ connect
- ถ้า token หมดอายุหรือ refresh ไม่สำเร็จ backend จะตอบ `428` พร้อม `connectUrl` และหน้า Dashboard จะพาผู้ใช้กลับไป Connect ใหม่
- Disconnect จะลบ token reference cookie และ token record ใน server-side token store ถ้าเปิดใช้งาน

เหตุผลที่ read path ยังใช้ PAT:

- Dashboard ต้องแสดงคิวกลางให้ทีมเห็นเหมือนกัน แม้ผู้ใช้แต่ละคนมีสิทธิ์ Azure DevOps ไม่เท่ากัน
- Background jobs เช่น Daily Summary, Exception Scan, Hourly Sync และ Build Failure Scan ไม่มี interactive user token
- ลดความเสี่ยงช่วง migration หลังเปิด delegated action แล้ว โดยแยก read consistency ออกจาก write audit identity

เป้าหมายระยะถัดไปถ้าจะย้ายไป user identity มากขึ้น:

1. เพิ่ม feature flag เช่น `ADO_READ_IDENTITY_MODE=service|delegated|hybrid`
2. เริ่มจาก endpoint interactive ที่มีผู้ใช้แน่นอน เช่น `/api/list-prs`, `/api/merge-lookup`, `/api/build-diagnostics`
3. ทำ fallback แบบ hybrid: ลอง delegated token ก่อน ถ้าไม่มี token หรือสิทธิ์อ่านไม่พอ ให้ fallback เป็น PAT พร้อม log source ชัดเจน
4. คง background jobs ไว้กับ service credential หรือทำ service principal แยก เพราะไม่มี browser session
5. เก็บ telemetry/log ว่า endpoint ไหนอ่านด้วย user token หรือ PAT เพื่อดูผลกระทบก่อนปิด fallback

### Active PR Queue

ใช้สำหรับงานที่ยังรอ approval อยู่ ผู้ใช้ที่มี role `it_support_approve` จะเห็นปุ่ม action เฉพาะเมื่อยัง vote ได้

เงื่อนไข action:

- ถ้าผู้ใช้ไม่มี role `it_support_approve` จะไม่แสดง Approve / Reject
- ถ้าผู้ใช้ approve/reject ไปแล้ว จะแสดง `Vote submitted`
- ถ้าเป็น MergeCode / MergeCodeProduction จะแสดง `Manual in Azure DevOps`
- ถ้างานไม่ใช่ reviewer ของผู้ใช้ จะแสดงสถานะที่เหมาะสมและไม่เปิด action ที่ไม่ควรทำ
- ถ้า PR approval complete แล้ว แต่มี `Release approval pending` จะยังอยู่ใน Active Queue เพื่อให้กด `Approve Release`
- ถ้า PR approval/policy ครบแล้วและไม่มี release approval pending ระบบจะซ่อนออกจาก Active Queue

### Guarded Auto Approve Mode

แผงควบคุมโหมดการทำงานสำหรับกลุ่ม `IT Support Approve` บนหน้า Dashboard ซึ่งรองรับการตั้งค่า 3 โหมดหลัก:
- `OFF` (Normal): ดำเนินการอนุมัติแบบ Manual ทีละรายการผ่านหน้าเว็บ
- `ACTIVE (Manual)` (Dry-run): บอทช่วยจำลองการตรวจ PR คิว แต่จะไม่ส่งคำสั่ง Approve ไปยัง Azure DevOps จริง (มีไว้สำหรับทดสอบ)
- `ACTIVE (Auto-Approve)` (Active): บอทตรวจคิว PR และ Release อัตโนมัติ หากผ่าน Guardrail และเงื่อนไขระบบ จะอนุมัติ (Approve) ให้อัตโนมัติทันที
- พฤติกรรมปัจจุบันของหน้าเว็บจะ Reset โหมดกลับเป็น `OFF` ทุกครั้งที่โหลดหรือ refresh หน้า Dashboard เพื่อป้องกันการค้างสถานะจาก session ก่อนหน้า
- เมื่อเปิด `ACTIVE (Manual)` หรือ `ACTIVE (Auto-Approve)` ระบบจะบันทึก expiry เป็น `end_of_day` และแสดง Countdown ถึงเวลา 23:59:59 Asia/Bangkok ของวันนั้น จากนั้นจะกลับเป็น `OFF` อัตโนมัติ
- ขณะเปิดโหมด Active/Dry-run หน้าเว็บจะสแกนคิวซ้ำทุก 60 วินาที และแสดงผลใน Auto Approve Status Console
- หากกด `Refresh PR` ระหว่างที่เปิดโหมด Active/Dry-run ระบบจะถามยืนยันก่อนปิดโหมดกลับเป็น `OFF` แล้วจึงดึงข้อมูล PR ใหม่

### Approval Hold

ระบบรองรับการระงับการทำงานอนุมัติชั่วคราว (Hold) สำหรับ PR บางรายการ เพื่อป้องกันการอนุมัติโดยไม่ตั้งใจ:
- ผู้ใช้ที่มีสิทธิ์สามารถกดปุ่ม **Hold** และระบุเหตุผล (จำเป็น) ได้จากหน้า Dashboard
- ข้อมูลการ Hold จะบันทึกลง SharePoint Log
- ตราบใดที่ PR ยังอยู่ในสถานะ **Hold** ปุ่ม Action ทั้งหมดบนหน้า Dashboard สำหรับ PR นั้น (Approve, Reject, Approve Release) จะถูกปิดใช้งานชั่วคราว
- เมื่อต้องการให้ดำเนินการต่อได้ ให้กดปุ่ม **Unlock** เพื่อปลดล็อกสถานะ Hold

### Release Approval

ระบบตรวจ Classic Release ที่เกี่ยวข้องกับ Build ID ของ PR และแสดงสถานะในคอลัมน์ Release

สถานะ Release ที่รองรับ:

- `Release approval pending`: พบ pending approval จริงใน Azure DevOps และแสดงปุ่ม `Approve Release`
- `Release expected`: คาดว่ามี CD จาก CI/CD mapping แต่ยังไม่พบ pending approval จริง จึงไม่เปิดปุ่ม approve
- `Release approved`: release approval ถูก approve แล้ว
- `Deploying`: release environment กำลัง run / queued / scheduled
- `Deploy succeeded`: release environment deploy สำเร็จ
- `Deploy failed`: release environment failed / canceled / rejected
- `Waiting release`: release พบแล้วแต่ environment ยังไม่เริ่ม
- `No release yet`: ยังไม่พบ release ที่ผูกกับ build
- `Release lookup failed`: ระบบเช็ค release ไม่สำเร็จ

Guardrail:

- ปุ่ม `Approve Release` จะแสดงเฉพาะเมื่อ Azure DevOps แจ้งว่า release approval ยังเป็น `pending`
- ก่อน approve ระบบ re-check release approval ล่าสุดอีกครั้ง
- ระบบไม่ approve จาก mapping อย่างเดียว
- เมื่อ approve สำเร็จ ระบบบันทึก SharePoint Log เป็น action `Release Approved`
- เอกสาร workflow อยู่ที่ `docs/approve-release-workflow.md`

### Activity

หน้า `/activity.html` แสดง PR ที่ผู้ใช้ approve หรือระบบ detect external approval ในช่วงล่าสุด โดย default:

- Lookback: 24 hours
- Page size: 10 items
- มี Previous / Next เพื่อดูรายการทั้งหมดในช่วง lookback

ข้อมูลใน Activity:

- Latest Status: Completed, Build Failed, Policy Pending, Active / Pending
- Approval Source: Dashboard approved หรือ External approved
- Actions: History และ Open ADO

Activity ใช้ SharePoint approval log เป็นจุดตั้งต้น แล้ว enrich สถานะล่าสุดจาก Azure DevOps เพื่อให้เห็นผลจริงหลัง approve เช่น build fail, policy pending หรือ completed

## MergeCode / MergeCodeProduction Workflow

ระบบไม่ approve งาน MergeCode ผ่าน Dashboard เพราะ risk สูงและต้องเลือกขั้นตอนบน Azure DevOps อย่างระมัดระวัง

งานกลุ่มนี้จะถูก highlight และแสดงเป็น manual:

- ไม่มีปุ่ม Approve / Reject ผ่านเว็บ
- มีปุ่ม Open ADO
- แสดงสถานะ Build / Policy และ Attention
- สามารถดู history ได้

แนวทาง manual บน Azure DevOps:

1. เปิด PR จากปุ่ม Open ADO
2. ตรวจ source/target branch
3. ตั้ง Auto-complete ตาม process ของทีม
4. ใช้ merge strategy ที่ถูกต้อง เช่น Merge no fast-forward เมื่อ process กำหนด
5. ตรวจ optional checks ที่เกี่ยวข้อง
6. Approve หรือจัดการต่อบน Azure DevOps โดยตรง

## Merge Lookup

หน้า `/merge.html` ใช้สำหรับค้นหา CI/CD ของ PR ประเภท Merge โดยกรอก PR ID

Logic เป็นแบบ Hybrid:

1. ดึง PR จริงจาก Azure DevOps
2. อ่าน repository, source branch, target branch
3. ตรวจ build run ของ target branch
4. ถ้า match branch rule เฉพาะ ให้ใช้ rule นั้น
5. ถ้าไม่ match hardcoded rule แต่พบ CI run ให้ lookup จาก Staging CI/CD mapping
6. แสดง Recommended CI/CD และ Detected Build

ข้อมูลที่แสดง:

- PR ID, title, repo, author, status, created time
- Source branch / target branch
- Recommended CI name
- Recommended CD name
- CI ID / CI folder
- CD ID / CD path
- Mapping source เช่น `branch-rule` หรือ `staging-csv`
- Detected build run, status, result, branch, build link

### Staging CI/CD Mapping

ไฟล์ mapping ที่ระบบใช้งานจริง:

```text
api/shared/stg-ci-cd-map.json
```

ไฟล์นี้ generate จาก CSV ต้นทาง:

| CSV | ความหมาย |
|---|---|
| `pipelines.csv` | รายชื่อ CI |
| `release-pipelines.csv` | รายชื่อ CD |
| `ci_cd_mapping.csv` | Mapping CI -> CD |

ปัจจุบัน import เฉพาะ Staging (`stg`) เข้า repo จำนวนประมาณ 2,891 mappings

เมื่อมี CI/CD ใหม่:

1. อัปเดต CSV ต้นทางก่อน
2. regenerate `api/shared/stg-ci-cd-map.json`
3. ทดสอบด้วย PR ตัวอย่าง
4. commit / push / deploy

ไม่ควรแก้ `stg-ci-cd-map.json` ด้วยมือถ้าไม่จำเป็น เพราะเสี่ยงข้อมูลไม่ตรง CSV ต้นทาง

## Audit Logs

หน้า `/logs.html` ใช้ตรวจสอบ SharePoint Log

Filter ที่รองรับ:

- PR ID เช่น `342997` หรือ `#342997`
- Action เช่น Approved, Dashboard approved, External approved, Rejected, Notification, Build Failed, Policy Pending, Failed / Error
- Source เช่น Dashboard, Azure DevOps Sync, Teams
- Keyword เช่น user, repo, title, result, reason
- Limit: 50 หรือ 100

ลำดับการแสดง:

- API ดึง log จาก SharePoint ด้วย `lastModifiedDateTime desc`
- Backend sort ซ้ำด้วย `createdAt desc`
- ถ้าเวลาซ้ำ ใช้ `lastModifiedAt` และ `id` เป็น tie-breaker
- ผลลัพธ์บนหน้าเว็บจึงแสดงล่าสุดก่อน

Log source สำคัญ:

- `Dashboard`: action ที่เกิดจากเว็บหรือ sync จาก Azure DevOps
- `Azure DevOps Sync`: external vote ที่ตรวจพบจาก dashboard refresh
- `Teams`: notification หรือ summary
- `Dashboard Test Daily Summary`: การทดสอบ Daily Summary จากหน้า Health

## SharePoint Log

ระบบเขียน log ลง SharePoint List ผ่าน Microsoft Graph

Column สำคัญที่ใช้:

| Column | Purpose |
|---|---|
| `Title` | ชื่อ log item |
| `PR_ID` | PR number |
| `Action` | Approved, Rejected, External Approved, Notification Sent ฯลฯ |
| `User` | ผู้ดำเนินการ |
| `Repository` | repo |
| `PR_Title` | title ของ PR |
| `Target_Branch` | target branch |
| `Result` | ผลลัพธ์ |
| `Reason` | เหตุผลหรือรายละเอียด |
| `Source` | Dashboard, Teams, Azure DevOps Sync |
| `Event_Key` | key กัน duplicate |
| `Build_Status` | build status |
| `Build_Result` | build result |
| `Policy_Status` | policy status |
| `Merge_Status` | merge status |
| `AutoComplete_Status` | auto-complete status |
| `Last_Checked_At` | เวลาตรวจล่าสุด |
| `ADO_Build_URL` | link build |
| `ADO_PR_URL` | link PR |

หมายเหตุ:

- `SHAREPOINT_AUTO_CREATE_LOG_COLUMNS=false` จะปิด auto-create optional columns
- หาก Azure DevOps action สำเร็จแต่ SharePoint log ล้มเหลว ระบบจะแจ้ง error เพื่อให้ตรวจย้อนหลังได้

### SharePoint Log Retention / Cleanup

ระบบรองรับ retention policy สำหรับ SharePoint Log โดยแนวทางหลักคือเก็บข้อมูลใน List 365 วัน และ archive เป็น CSV ก่อน delete

Endpoint:

```text
POST /api/log-retention-cleanup
```

Header:

```text
x-log-retention-token: <LOG_RETENTION_TOKEN หรือ DAILY_SUMMARY_TOKEN>
```

Body สำหรับ dry run:

```json
{
  "dryRun": true,
  "retentionDays": 365,
  "maxItems": 500
}
```

Body สำหรับ cleanup จริง:

```json
{
  "dryRun": false,
  "retentionDays": 365,
  "maxItems": 500,
  "deleteAfterArchive": true
}
```

หลักการทำงาน:

- Query SharePoint List เฉพาะ items ที่ `createdDateTime` เก่ากว่า cutoff
- Export เป็น CSV พร้อม UTF-8 BOM เพื่อเปิดใน Excel ได้ง่าย
- Upload เข้า SharePoint Document Library path ตามรูปแบบ `ADO AutoApprove Archive/YYYY/MM/...csv`
- Delete list items เฉพาะเมื่อ upload archive สำเร็จ
- บันทึก summary log กลับเข้า SharePoint ด้วย action `Log Retention Cleanup`
- Default ของ endpoint คือ `dryRun=true` เพื่อป้องกันการลบโดยไม่ตั้งใจ

แนะนำให้ Azure Logic Apps Consumption เรียก endpoint นี้เดือนละครั้ง เช่น วันที่ 1 เวลา 01:00 Asia/Bangkok

### Azure Table Retention / Cleanup

ระบบรองรับ cleanup สำหรับ Azure Table ที่ระบบสร้างเองเท่านั้น เพื่อลดข้อมูลค้างและลดการเก็บ token/lock เกินจำเป็น:

- `ApprovalLocks`: ลบ record ที่ `expiresAt` เก่าเกิน retention window, default 7 วัน
- `AdoUserTokens`: ลบ encrypted token record ที่ `expiresAt` เก่าเกิน retention window, default 90 วัน
- ไม่แตะ Azure Functions host/system tables

Endpoint:

```text
POST /api/table-retention-cleanup
```

Header:

```text
x-table-retention-token: <TABLE_RETENTION_TOKEN หรือ LOG_RETENTION_TOKEN หรือ DAILY_SUMMARY_TOKEN>
```

Body สำหรับ dry run:

```json
{
  "dryRun": true,
  "lockRetentionDays": 7,
  "tokenRetentionDays": 90,
  "maxItems": 500
}
```

Body สำหรับ cleanup จริง:

```json
{
  "dryRun": false,
  "lockRetentionDays": 7,
  "tokenRetentionDays": 90,
  "maxItems": 500
}
```

หลักการทำงาน:

- Scan เฉพาะ table `ApprovalLocks` และ `AdoUserTokens`
- Delete เฉพาะ entity ที่หมดอายุเกิน cutoff ตาม retention ที่กำหนด
- Default ของ endpoint คือ `dryRun=true` เพื่อป้องกันการลบโดยไม่ตั้งใจ
- บันทึก summary log กลับเข้า SharePoint ด้วย action `Table Retention Cleanup`

แนะนำให้ Azure Logic Apps Consumption เรียกวันละครั้งหรือสัปดาห์ละครั้ง โดยส่ง `dryRun=false` เมื่อยืนยันผล dry run แล้ว

## System Health

หน้า `/health.html` แสดงรายละเอียดสถานะระบบ

Checks หลัก:

- Auth: ผู้ใช้ login ได้
- Backend: API runtime, uptime, Node version
- Azure DevOps: service PAT/config สำหรับ read path เชื่อมต่อได้
- SharePoint Log: site/list/read recent logs ได้
- Teams Webhook: webhook URL ถูก config
- Daily Summary: token และ scheduler พร้อม
- Last Sync: เวลา refresh PR ล่าสุดจาก dashboard
- Last Notification: notification ล่าสุดจาก SharePoint log
- Last Exception Scan: exception scan ล่าสุดจาก SharePoint log
- Last Retention Cleanup: retention cleanup ล่าสุดจาก SharePoint log
- Next Summary: รอบส่งสรุปรายวันถัดไป

Diagnostic Tools:

- Test Teams Notification
- Test Daily Summary
- Scan Build/Policy Alerts
- Test Backend Health

## Teams Notification

ระบบมี notification 2 กลุ่มหลัก:

### Build / Policy Exception Notification

ใช้แจ้งเฉพาะเหตุการณ์ที่ควรสนใจ เพื่อลด noise เช่น:

- build failed
- policy failed
- rejected active PR
- stale/critical attention ตาม logic ที่ระบบกำหนด

ระบบมี endpoint แยกสำหรับ scan exception จาก SharePoint approval log โดยไม่ต้องพึ่งการโหลดหน้า Dashboard:

```text
POST /api/exception-scan
```

Header:

```text
x-exception-scan-token: <EXCEPTION_SCAN_TOKEN หรือ DAILY_SUMMARY_TOKEN>
```

หลักการทำงาน:

- อ่าน approval logs ล่าสุดตามช่วงเวลาที่กำหนด
- ดึง PR / Build / Policy ล่าสุดจาก Azure DevOps
- ส่ง Teams เฉพาะ Build Failed หรือ Policy Failed
- กันส่งซ้ำด้วย `Event_Key` ที่รวม PR, issue type และ build run id เมื่อมีข้อมูล

สามารถปิดด้วย:

```text
TEAMS_EXCEPTION_NOTIFICATIONS=false
```

### Build Failure REST Polling

ถ้า Azure DevOps Service Hook ใช้งานไม่เสถียร ให้ใช้ Azure Logic Apps Consumption เรียก endpoint นี้แทน:

```text
POST /api/build-failure-scan
```

Header:

```text
x-build-failure-scan-token: <BUILD_FAILURE_SCAN_TOKEN หรือ DAILY_SUMMARY_TOKEN>
```

Body ตัวอย่าง:

```json
{
  "lookbackMinutes": 30,
  "maxBuilds": 100
}
```

หลักการทำงาน:

- Query Azure DevOps REST API หา build ที่ `completed` และ `failed` ในช่วงเวลาล่าสุด
- Default lookback คือ 30 นาที และดึงสูงสุด 100 builds
- กรองเฉพาะ pipeline ที่มีคำว่า `stg` และ branch ที่ขึ้นต้นด้วย `refs/heads/staging`
- สำหรับ build ที่ยังไม่เคยแจ้งเตือน ระบบจะดึง timeline/log แล้ววิเคราะห์ root cause ด้วย diagnostics catalog เดียวกับหน้า `/build-diagnostics.html?buildId=...`
- Teams message จะแสดง root cause summary, error key, failed command, file/line/column, impact chain, warnings และแนวทางแก้ไขถ้าวิเคราะห์ได้
- ส่ง Teams หนึ่งครั้งต่อ build ด้วย `Event_Key` รูปแบบ `teams:build-failed:<buildId>`
- บันทึก SharePoint Log ด้วย source `ADO REST Build Failure Scan`

แนะนำให้ตั้ง Logic Apps เรียกทุก 30 นาที โดยใช้ workflow แบบประหยัด cost เพียง 2 steps: Recurrence + HTTP POST และใช้ `lookbackMinutes` 30 นาที เพื่อให้อยู่ใต้ free tier ประมาณ 2,880 executions/เดือน จาก free tier 4,000 actions/เดือน พร้อมให้ duplicate guard กันการส่งซ้ำ

สำหรับทดสอบโดยไม่ส่ง Teams ให้ใส่:

```json
{
  "dryRun": true,
  "lookbackMinutes": 30
}
```

### Hourly Background Log Sync

ระบบรองรับ background reconciliation job เพื่อเติม audit log ที่อาจตกหล่น โดยไม่ต้องเปิดหน้า `/logs.html` หรือ Dashboard ค้างไว้

Endpoint:

```text
POST /api/hourly-log-sync
```

Header:

```text
x-hourly-sync-token: <HOURLY_SYNC_TOKEN หรือ DAILY_SUMMARY_TOKEN>
```

Body ตัวอย่างสำหรับ Azure Logic Apps Consumption:

```json
{
  "lookbackHours": 48,
  "maxPrs": 100
}
```

หลักการทำงาน:

- Logic Apps Consumption เรียกทุก 1 ชั่วโมง ด้วย HTTP action
- ดึง Active PR และ Completed PR ย้อนหลังตาม `lookbackHours` ที่ target branch ขึ้นต้นด้วย `ADO_TARGET_BRANCH`
- ตรวจ external reviewer vote จาก Azure DevOps แล้วเขียน SharePoint log เฉพาะรายการที่ยังไม่มี
- กันข้อมูลซ้ำด้วย `Event_Key = ado-sync:vote:<prId>:<identity>:<vote>`
- เขียน summary log ต่อชั่วโมงด้วย action `Hourly Log Sync`
- ไม่ต้องเปิด Application Insights / Azure Monitor เพิ่ม; ตรวจสถานะจาก SharePoint summary log และ Logic Apps run history

Free-tier guard:

- Workflow ควรมีเพียง Recurrence + HTTP เป็นหลัก
- รอบทุก 1 ชั่วโมงจะประมาณ 1,440 Logic Apps actions ต่อเดือน ซึ่งต่ำกว่า free grant 4,000 actions/month
- Managed API execution ประมาณ 720 ครั้งต่อเดือน ซึ่งต่ำกว่า Azure Functions free grant มาก

### Daily PR Summary

ระบบรองรับการส่งสรุปภาพรวมรายวัน (Daily Summary) ไปยัง 2 ช่องทางหลักตามรอบเวลาที่กำหนด:

1. **MS Teams Daily Summary (รอบ 18:00 น. Asia/Bangkok):**
   * ส่งแจ้งเตือนสรุปรายวันเข้ากลุ่ม MS Teams ผ่าน endpoint:
     ```text
     POST /api/daily-summary
     ```
   * ข้อมูลเป็นสถานะสด ณ เวลา 18:00 น.
   * ใช้ Header: `x-daily-summary-token: <DAILY_SUMMARY_TOKEN>`
2. **LINE OA Daily Summary (รอบ 23:59 น. Asia/Bangkok):**
   * ส่งแจ้งเตือนสรุปรายวันเข้าแชท/กลุ่ม LINE OA ผ่าน endpoint:
     ```text
     POST /api/line-daily-summary
     ```
   * **การคำนวณข้อมูล:** ดึงและรวบรวมข้อมูลสดแบบเรียลไทม์ครบถ้วนตลอดทั้งวัน (00:00 - 23:59 น.) ซึ่งทำให้รายงานของ LINE จะครอบคลุมกิจกรรมทั้งหมด รวมถึง PR ที่มีการอนุมัติหรือสร้างใหม่ในช่วงเวลาหลังรอบส่งของ Teams (18:00 - 23:59 น.) และจะสแกนสถานะคิวรออนุมัติล่าสุด (Active now) ณ เวลาเที่ยงคืนก่อนเริ่มวันถัดไป
   * ใช้ Header: `x-line-daily-summary-token: <LINE_DAILY_SUMMARY_TOKEN>`

ระบบมี duplicate guard ด้วย `Event_Key` ใน SharePoint (`teams:daily-summary:<dateKey>` และ `line:daily-summary:<dateKey>`) เพื่อไม่ให้ส่งซ้ำในวันเดียวกันในแต่ละช่องทางโดยเฉพาะ *(หมายเหตุ: ระบบ Duplicate Guard จะทำการกรองและมองข้าม Log ที่เกิดจากคำสั่งทดสอบ (Test Mode) เสมอ เพื่อไม่ให้ประวัติการกดทดสอบไปขัดขวางการส่งสรุปจริงตอนสิ้นวัน)*

## Authentication และ Authorization

ระบบใช้ Azure Static Web Apps Auth + Microsoft Entra ID

Routes สำคัญ:

| Route | Allowed roles |
|---|---|
| `/dashboard.html` | `authenticated` |
| `/merge.html` | `authenticated` |
| `/logs.html` | `authenticated` |
| `/health.html` | `authenticated` |
| `/report.html` | `authenticated` |
| `/api/list-prs` | `authenticated` |
| `/api/merge-lookup` | `authenticated` |
| `/api/logs` | `authenticated` |
| `/api/report-summary` | `authenticated` |
| `/api/pr-history/*` | `authenticated` |
| `/api/health` | `authenticated` |
| `/api/approve-pr` | `it_support_approve` |
| `/api/reject-pr` | `it_support_approve` |
| `/api/approve-release` | `it_support_approve` |
| `/api/daily-summary` | `anonymous` + header token |
| `/api/line-daily-summary` | `anonymous` + header token |
| `/api/sync-deployments` | `anonymous` + header/query token |
| `/api/exception-scan` | `anonymous` + header token |
| `/api/build-failure-scan` | `anonymous` + header token |
| `/api/hourly-log-sync` | `anonymous` + header token |
| `/api/log-retention-cleanup` | `anonymous` + header token |
| `/api/table-retention-cleanup` | `anonymous` + header token |
| `/api/webhook` | `anonymous` + basic auth |

Role display:

- System roles เช่น `anonymous`, `authenticated` ถูกซ่อนจาก UI
- `it_support_approve` แสดงเป็น `IT Support Approve`
- ถ้าไม่มี approval role จะแสดงเป็น authenticated user แต่ไม่เปิดปุ่ม action

## User Profile / Display Name

ค่า user เริ่มต้นมาจาก Static Web Apps client principal ซึ่งมักเป็น email

มี optional Graph lookup:

```text
GRAPH_USER_PROFILE_LOOKUP=true
```

เมื่อตั้งค่านี้ ระบบจะพยายามดึง display name จาก Microsoft Graph ผ่าน app credential

ต้องมี Graph application permission ที่เหมาะสม เช่น `User.Read.All` พร้อม admin consent

ถ้าไม่ได้เปิด feature นี้ ระบบ fallback เป็น email ตามเดิม

## Backend API

| API | Method | Purpose |
|---|---|---|
| `/api/userinfo` | GET | คืน user, roles, permissions |
| `/api/ado-auth-start` | GET | เริ่ม Azure DevOps delegated OAuth flow สำหรับ user ที่ login |
| `/api/ado-auth-callback` | GET | OAuth callback สำหรับแลก code เป็น token และบันทึก token cache |
| `/api/ado-auth-status` | GET | ตรวจสถานะ Azure DevOps connection ของ browser/user ปัจจุบัน |
| `/api/ado-auth-disconnect` | POST | ลบ token reference cookie และ token record ใน server-side store |
| `/api/list-prs` | GET | ดึง Active PR Queue และ Activity lookup เมื่อส่ง `includeActivity=true` |
| `/api/approve-pr` | POST | Approve PR ปกติด้วย Azure DevOps identity ของผู้ใช้ที่ Connect แล้ว, set auto-complete, log SharePoint |
| `/api/reject-pr` | POST | Reject PR ปกติด้วย Azure DevOps identity ของผู้ใช้ที่ Connect แล้ว, log SharePoint |
| `/api/approve-release` | POST | Approve Azure DevOps Classic Release pre-deploy approval ที่ยัง pending ด้วย Azure DevOps identity ของผู้ใช้ที่ Connect แล้ว และ log SharePoint |
| `/api/approval-hold` | POST | ตั้งค่า Hold หรือ Release สถานะระงับการอนุมัติของ PR บน Dashboard |
| `/api/auto-approve-settings` | GET/POST | ดึงหรืออัปเดตการตั้งค่าโหมด Guarded Auto Approve |
| `/api/build-diagnostics` | GET/POST | วิเคราะห์ Timeline และเนื้อหา Log ความล้มเหลวของ Build พร้อมบันทึก/ส่งแจ้งเตือน Teams |
| `/api/deploy-history` | GET | ดึงข้อมูลประวัติการ Deploy จากไฟล์ CSV บน SharePoint |
| `/api/sync-deployments` | GET/POST | ดึงและประสานประวัติการรัน Build & Deploy จาก Azure DevOps บันทึกเก็บเป็นไฟล์ CSV ตามปีบน SharePoint (โดยคัดกรองยกเว้นพวก Scheduled/Infrastructure system tasks ที่มีชื่อ Pipeline มีคำว่า `schedule` หรือ `scripts` ออกโดยอัตโนมัติ) |
| `/api/report-summary` | GET | ดึงข้อมูลรายงานสรุปสถิติผลการดำเนินงาน (การอนุมัติ, อัตรา Auto-Approve, อัตราความสำเร็จของบิลด์) |
| `/api/pr-history/{prId}` | GET | อ่าน history ของ PR จาก SharePoint |
| `/api/logs` | GET | อ่าน audit logs จาก SharePoint |
| `/api/health` | GET | ตรวจ authenticated system health หลัง login |
| `/api/merge-lookup` | GET | ค้นหา CI/CD ของ Merge PR |
| `/api/test-notification` | POST | ทดสอบ Teams notification |
| `/api/test-daily-summary` | POST | ทดสอบ Daily Summary |
| `/api/test-exception-scan` | POST | ทดสอบ Build/Policy exception scan จากหน้า Health |
| `/api/daily-summary` | POST | endpoint สำหรับ Logic Apps scheduler |
| `/api/line-daily-summary` | POST | endpoint สำหรับ Logic Apps LINE Daily Summary scheduler (ส่ง 23:59 น.) |
| `/api/exception-scan` | POST | endpoint สำหรับสแกน Build/Policy failed จาก approval logs |
| `/api/build-failure-scan` | POST | endpoint สำหรับ Logic Apps polling หา Build failed จาก Azure DevOps REST API โดยตรง |
| `/api/hourly-log-sync` | POST | endpoint สำหรับ Logic Apps hourly background reconciliation เติม external vote log ที่ตกหล่น |
| `/api/log-retention-cleanup` | POST | endpoint สำหรับ archive/export/delete SharePoint logs เก่ากว่า retention window |
| `/api/table-retention-cleanup` | POST | endpoint สำหรับลบ Azure Table records เก่าของ `ApprovalLocks` และ `AdoUserTokens` |
| `/api/webhook` | POST | legacy/webhook notification endpoint |

## Important Shared Modules

| File | Purpose |
|---|---|
| `api/shared/ado-client.js` | Azure DevOps REST API client |
| `api/shared/ado-user-token.js` | Azure DevOps delegated OAuth/token lifecycle helper |
| `api/shared/ado-token-store.js` | Azure Table encrypted server-side token store |
| `api/shared/approval-lock-store.js` | Azure Table distributed lock / idempotency store for approve actions |
| `api/shared/sharepoint-client.js` | Microsoft Graph / SharePoint List client |
| `api/shared/auth.js` | role / principal helper |
| `api/shared/attention.js` | PR aging / stuck / attention logic |
| `api/shared/approval-hold.js` | ดึงสถานะและบันทึก Log การระงับการอนุมัติ (Hold State) |
| `api/shared/build-diagnostics-catalog.js` | ฐานข้อมูลรูปแบบ Error และกฎการวิเคราะห์ปัญหาของ Build Log |
| `api/shared/notification-service.js` | exception notification orchestration |
| `api/shared/teams-notifier.js` | Teams webhook client |
| `api/shared/line-notifier.js` | LINE Messaging API client |
| `api/shared/merge-pipeline-map.js` | Merge branch rule + Staging CSV lookup |
| `api/shared/stg-ci-cd-map.json` | generated Staging CI/CD mapping |
| `api/shared/user-profile.js` | optional Graph display name lookup |

## Attention / PR Aging Logic

ระบบแสดง Attention เพื่อช่วยให้เห็น PR ที่ควรรีบตรวจ

ตัวอย่างสถานะ:

| Status | Meaning |
|---|---|
| New | PR ยังใหม่ อยู่ในช่วงเวลาปกติ |
| Waiting | รอ approval เกินช่วงสั้น ๆ |
| Warning | เริ่มรอนาน |
| Critical | รอนานมากหรือมีสัญญาณเสี่ยง |
| Stale | ค้างนานจนควรตรวจ |
| Manual | เป็น MergeCode/MergeCodeProduction ต้องทำใน ADO |
| Ready | approval / policy พร้อมตามเงื่อนไข |

Logic อยู่ใน:

```text
api/shared/attention.js
```

ใช้ร่วมกันใน Dashboard และ Daily Summary เพื่อลดความคลาดเคลื่อน

## Environment Variables

ค่าจริงต้องเก็บใน Azure Static Web Apps Configuration หรือ GitHub Secrets ห้าม commit ลง repo

### Azure DevOps

| Variable | Required | Description |
|---|---:|---|
| `ADO_ORGANIZATION` | Yes | organization จาก `dev.azure.com/<org>` |
| `ADO_PROJECT` | Yes | Azure DevOps project |
| `ADO_PAT` | Yes | Service credential สำหรับ read path: อ่าน PR, reviewers, policy, build, release lookup, health check และ background jobs; action Approve / Reject / Approve Release ใช้ delegated user token หลัง Connect Azure DevOps |
| `ADO_TARGET_BRANCH` | No | default `refs/heads/staging` |
| `ADO_REVIEWER_GROUP` | No | default `IT Support Approve` |
| `ADO_EXTERNAL_LOG_SYNC` | No | set `false` เพื่อปิด external vote sync log |

### Azure DevOps Delegated User Tokens

ใช้สำหรับให้ปุ่ม Approve / Reject / Approve Release ดำเนินการด้วย Azure DevOps identity ของผู้ที่ login จริง แทน PAT/service account

| Variable | Required | Description |
|---|---:|---|
| `ADO_AUTH_REDIRECT_URI` | Yes | OAuth callback เช่น `https://mango-wave-09cff3700.7.azurestaticapps.net/api/ado-auth-callback` |
| `ADO_TOKEN_STORAGE_CONNECTION_STRING` | Recommended | Azure Storage connection string สำหรับเก็บ encrypted access/refresh token แบบ server-side; ถ้าไม่ตั้งจะ fallback ไป `AzureWebJobsStorage` / `AZURE_STORAGE_CONNECTION_STRING` |
| `ADO_TOKEN_TABLE_NAME` | No | Azure Table name สำหรับ token cache, default `AdoUserTokens` |
| `ADO_TOKEN_STORE_SECRET` | Recommended | secret สำหรับเข้ารหัส token record ใน Azure Table; ถ้าไม่ตั้งจะ fallback ไป `ADO_TOKEN_COOKIE_SECRET` / `AAD_CLIENT_SECRET` |
| `ADO_TOKEN_COOKIE_SECRET` | Recommended | secret สำหรับเข้ารหัส HttpOnly cookie ที่เก็บ token reference และ OAuth state |
| `ADO_AUTH_SCOPE` | No | default `499b84ac-1321-427f-aa17-267ca6975798/.default offline_access openid profile email` |

หมายเหตุ:

- Cookie ฝั่ง browser เก็บเฉพาะ encrypted token reference เมื่อมี server-side token store
- Access token / refresh token ถูกเก็บใน Azure Table แบบ encrypted record
- หากไม่มี Storage connection string ระบบจะ fallback เป็น encrypted HttpOnly cookie เพื่อไม่ให้ flow ใช้งานไม่ได้ แต่ production ระยะยาวควรตั้ง Storage ให้ครบ
- App Registration ต้องมี Web Redirect URI ตรงกับ `ADO_AUTH_REDIRECT_URI` และมี Azure DevOps delegated permissions ที่ admin consent แล้ว
- หลัง callback สำเร็จ Dashboard จะแสดงข้อความ Connected และ clean query `adoConnected=1` ออกจาก URL อัตโนมัติ

### Approval Action Locks

ใช้ Azure Table Storage เป็น distributed lock เพื่อกันผู้ใช้หลายคนหรือหลาย Azure Function instance อนุมัติ PR / Release เดียวกันพร้อมกัน

| Variable | Required | Description |
|---|---:|---|
| `APPROVAL_LOCK_STORAGE_CONNECTION_STRING` | Recommended | Azure Storage connection string สำหรับ lock store; ถ้าไม่ตั้งจะ fallback ไป `AzureWebJobsStorage` / `AZURE_STORAGE_CONNECTION_STRING` |
| `APPROVAL_LOCK_TABLE` | No | Azure Table name สำหรับ lock store, default `ApprovalLocks` |
| `APPROVAL_LOCK_TTL_SECONDS` | No | อายุ lock ระหว่าง processing, default `120` วินาที |
| `APPROVAL_LOCK_COMPLETED_TTL_SECONDS` | No | อายุ idempotency record หลัง approve สำเร็จ, default `600` วินาที |
| `APPROVAL_LOCK_FAILED_TTL_SECONDS` | No | อายุ failed record ก่อน retry ได้, default `15` วินาที |

หมายเหตุ:

- `/api/approve-pr` lock ด้วย `PartitionKey=approve-pr`, `RowKey=<prId>` ก่อนยิง `setAutoComplete` และ `approvePR`
- `/api/approve-release` lock ด้วย `PartitionKey=approve-release`, `RowKey=<approvalId>` ก่อนยิง Release approval
- ถ้า lock store ใช้งานไม่ได้ API จะตอบ `503` และไม่ส่ง approval ไป Azure DevOps เพื่อหลีกเลี่ยงการ approve แบบไม่มีกันชน

### Auth / Role

| Variable | Required | Description |
|---|---:|---|
| `AUTH_REQUIRED_ROLE` | No | default `it_support_approve` |
| `GRAPH_USER_PROFILE_LOOKUP` | No | set `true` เพื่อเปิด Graph display name lookup |

### SharePoint / Graph

| Variable | Required | Description |
|---|---:|---|
| `AAD_TENANT_ID` | Yes | Entra tenant id |
| `AAD_CLIENT_ID` | Yes | app registration client id |
| `AAD_CLIENT_SECRET` | Yes | app registration secret |
| `SHAREPOINT_HOSTNAME` | Yes | เช่น `buzzebees.sharepoint.com` |
| `SHAREPOINT_SITE_PATH` | Yes | เช่น `/sites/ADOAuto-Approve` |
| `SHAREPOINT_LIST_NAME` | No | default `ADO Auto-Approve Log` |
| `SHAREPOINT_AUTO_CREATE_LOG_COLUMNS` | No | set `false` เพื่อปิด auto-create optional columns |

### Teams / Notification

| Variable | Required | Description |
|---|---:|---|
| `TEAMS_WEBHOOK_URL` | For notification | Teams webhook endpoint |
| `TEAMS_EXCEPTION_NOTIFICATIONS` | No | set `false` เพื่อปิด exception alerts |
| `DAILY_SUMMARY_TOKEN` | For daily summary | token ที่ Logic Apps ส่งมาใน header |
| `EXCEPTION_SCAN_TOKEN` | No | token สำหรับ `/api/exception-scan`; ถ้าไม่ตั้งจะ fallback ไปใช้ `DAILY_SUMMARY_TOKEN` |
| `BUILD_FAILURE_SCAN_TOKEN` | No | token สำหรับ `/api/build-failure-scan`; ถ้าไม่ตั้งจะ fallback ไปใช้ `DAILY_SUMMARY_TOKEN` |
| `HOURLY_SYNC_TOKEN` | No | token สำหรับ `/api/hourly-log-sync`; ถ้าไม่ตั้งจะ fallback ไปใช้ `DAILY_SUMMARY_TOKEN` |
| `LOG_RETENTION_TOKEN` | No | token สำหรับ `/api/log-retention-cleanup`; ถ้าไม่ตั้งจะ fallback ไปใช้ `DAILY_SUMMARY_TOKEN` |
| `LOG_RETENTION_DAYS` | No | default `365` |
| `LOG_RETENTION_BATCH_LIMIT` | No | default `500`, max `1000` |
| `LOG_ARCHIVE_FOLDER` | No | default `ADO AutoApprove Archive` |
| `TABLE_RETENTION_TOKEN` | No | token สำหรับ `/api/table-retention-cleanup`; ถ้าไม่ตั้งจะ fallback ไปใช้ `LOG_RETENTION_TOKEN` / `DAILY_SUMMARY_TOKEN` |
| `TABLE_RETENTION_LOCK_DAYS` | No | default `7`, ลบ `ApprovalLocks` ที่หมดอายุเกินจำนวนวันนี้ |
| `TABLE_RETENTION_TOKEN_DAYS` | No | default `90`, ลบ `AdoUserTokens` ที่หมดอายุเกินจำนวนวันนี้ |
| `TABLE_RETENTION_BATCH_LIMIT` | No | default `500`, max `1000` |

### LINE / Notification

| Variable | Required | Description |
|---|---:|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | For LINE notification | Channel Access Token (Long-lived) ของ LINE OA |
| `LINE_TARGET_ID` | For LINE notification | ID ปลายทางที่ต้องการส่งข้อความ (Group ID `C...` หรือ User ID `U...`) |
| `LINE_DAILY_SUMMARY_TOKEN` | For LINE summary | Token ที่ตั้งไว้เพื่อใช้ตรวจสอบสิทธิ์ใน header สำหรับ `/api/line-daily-summary` |

### Webhook

| Variable | Required | Description |
|---|---:|---|
| `WEBHOOK_USERNAME` | For webhook | basic auth username |
| `WEBHOOK_PASSWORD` | For webhook | basic auth password |
| `STAGING_BRANCH_REF` | No | default `refs/heads/staging` |

### Dashboard Options

| Variable | Required | Description |
|---|---:|---|
| `COMPLETED_PR_LOOKBACK_HOURS` | No | default `24` |
| `COMPLETED_PR_DISPLAY_LIMIT` | No | default `10` |

## Deployment

ระบบ deploy ผ่าน GitHub Actions:

```text
.github/workflows/azure-static-web-apps.yml
```

Workflow deploy เมื่อ push เข้า:

- `main`
- `master` (รองรับไว้ แต่ปัจจุบันใช้ `main`)

Azure Static Web Apps config:

```text
public/staticwebapp.config.json
```

Runtime:

```json
{
  "platform": {
    "apiRuntime": "node:22"
  }
}
```

## Branch Policy / Backup

Branch ที่ใช้ปัจจุบัน:

| Branch | Purpose |
|---|---|
| `main` | production/current stable version |
| `staging` | backup branch ล่าสุด ชี้ commit เดียวกับ `main` |

หมายเหตุ:

- ไม่มี `Staging` ตัวพิมพ์ใหญ่แล้ว
- ไม่มี `backup/pre-node22-20260602` แล้ว
- หากต้อง backup สถานะล่าสุด ให้ push `main` ไป `staging`

ตัวอย่าง:

```powershell
git push origin main:staging
```

## Local Validation

ก่อน push ควรตรวจ:

```powershell
git status --short --branch
node --check public\core.js
node --check public\dashboard.js
node --check public\activity.js
node --check public\logs.js
node --check public\health.js
node --check public\merge.js
node --check public\build-diagnostics.js
node --check public\deploy-history.js
node --check api\userinfo\index.js
node --check api\health\index.js
node --check api\list-prs\index.js
node --check api\approve-pr\index.js
node --check api\reject-pr\index.js
node --check api\approve-release\index.js
node --check api\pr-history\index.js
node --check api\logs\index.js
node --check api\merge-lookup\index.js
node --check api\approval-hold\index.js
node --check api\auto-approve-settings\index.js
node --check api\ado-auth-start\index.js
node --check api\ado-auth-callback\index.js
node --check api\ado-auth-status\index.js
node --check api\ado-auth-disconnect\index.js
node --check api\shared\ado-user-token.js
node --check api\shared\ado-token-store.js
node --check api\build-diagnostics\index.js
node --check api\deploy-history\index.js
node --check api\sync-deployments\index.js
node --check api\report-summary\index.js
node --check api\shared\line-notifier.js
node --check api\daily-summary\index.js
node --check api\line-daily-summary\index.js
node --check api\exception-scan\index.js
node --check api\build-failure-scan\index.js
node --check api\hourly-log-sync\index.js
node --check api\log-retention-cleanup\index.js
node --check api\table-retention-cleanup\index.js
node --check api\webhook\index.js
node -e "JSON.parse(require('fs').readFileSync('public/staticwebapp.config.json','utf8')); console.log('SWA public config JSON: OK')"
```

หลัง push ควรตรวจ:

- GitHub Actions conclusion = success
- หน้า Dashboard โหลดได้
- `/api/health` หลัง login ได้ผล healthy หรือ warning ตาม config จริง
- Audit Logs เรียงล่าสุดก่อน
- Merge Lookup ค้น PR ตัวอย่างได้

## Acceptance Criteria

ระบบควรผ่านเงื่อนไขต่อไปนี้:

| Area | Expected |
|---|---|
| Login | ผู้ใช้ login ผ่าน Entra ID ได้ |
| ADO Connect | ผู้ใช้ Connect Azure DevOps ได้, กลับมา Dashboard พร้อม success notice, และสถานะแสดง Connected |
| Role | ผู้ใช้ `IT Support Approve` เห็น action ที่ควรเห็น |
| No role | ผู้ใช้ไม่มี role ไม่เห็น Approve / Reject |
| Load PR | Dashboard โหลด PR ได้และปุ่มกลับเป็น `Refresh PR` |
| Active PR Queue | แสดง PR ที่รอ approval ถูกต้อง |
| My Approval | แสดง `You approved`, `Vote submitted`, หรือสถานะรออนุมัติถูกต้อง |
| MergeCode | ไม่เปิด automation action และแสดง manual workflow |
| Activity | แสดง approval log ล่าสุด 24 ชั่วโมง, filter ได้, paging ได้ และปุ่ม History ใช้งานได้ |
| Build / Policy | แสดง Build Failed / Policy Failed ได้เมื่อมีข้อมูล |
| Release | แสดง Release expected / pending / approved / deploy status ได้ถูกต้อง และปุ่ม Approve Release แสดงเฉพาะ pending approval |
| Guarded Auto Approve | สามารถตั้งค่าโหมด OFF / ACTIVE (Manual) / ACTIVE (Auto-Approve) พร้อมแสดง Console Log และ Countdown |
| Approval Hold | ปรับเปลี่ยนสถานะ Hold / Unlock และจำกัด Action การควบคุมของ PR ได้ถูกต้อง |
| Deploy History | แสดงและค้นหาประวัติการ Deploy Staging ย้อนหลัง คัดกรองตาม Repository, Branch และดึงไฟล์ CSV จาก SharePoint |
| Build Diagnostics | ตรวจสอบ Timeline วิเคราะห์หา Failed Task และแปลรายละเอียดออกมาได้อย่างถูกต้องพร้อมส่ง Teams |
| Report | แสดงผลสถิติการอนุมัติ, อัตรา Auto-Approve, อัตราสำเร็จของบิลด์ (รายวัน/รายเดือน), filter scope ของผู้ใช้/บิลด์ และรายการ Staging build failed ล่าสุด โดยคัดกรองข้ามพวก scheduled task ของระบบและซิงก์ข้อมูลเบื้องหลังสำเร็จ |
| SharePoint Log | action ผ่านเว็บมี log |
| User Identity Action | Approve / Reject / Approve Release ใน Azure DevOps แสดง identity ของผู้ใช้ที่ Connect ไม่ใช่ service PAT |
| Audit Logs | ค้นหาได้และเรียงล่าสุดก่อน |
| Daily Summary | ส่ง Teams เวลา 18:00 ผ่าน Logic Apps และไม่ duplicate |
| Health | ตรวจ Backend, ADO, SharePoint, Teams, Daily Summary ได้ |
| Merge Lookup | กรอก PR แล้วได้ CI/CD เมื่อมี mapping |

## Troubleshooting

### Dashboard ไม่โหลด PR

ตรวจ:

- `ADO_ORGANIZATION`
- `ADO_PROJECT`
- `ADO_PAT`
- PAT หมดอายุหรือ scope อ่านข้อมูลไม่พอ
- target branch / reviewer group ถูกต้องหรือไม่

หมายเหตุ: การโหลดคิว PR ปัจจุบันยังใช้ `ADO_PAT` เป็น read/service credential แม้ action จะใช้ delegated user token แล้ว

### Approve / Reject ไม่ขึ้น

ตรวจ:

- ผู้ใช้มี role `it_support_approve` หรือไม่
- ผู้ใช้ Connect Azure DevOps แล้วหรือยัง
- PR เป็น MergeCode หรือไม่
- ผู้ใช้ vote ไปแล้วหรือยัง
- Static Web Apps role invitation / role assignment ถูกต้องหรือไม่

### Connect Azure DevOps ไม่สำเร็จ

ตรวจ:

- `AAD_TENANT_ID`, `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`
- `ADO_AUTH_REDIRECT_URI` ตรงกับ Web Redirect URI ใน App Registration ทุกตัวอักษร
- App Registration มี Azure DevOps delegated permissions และ admin consent แล้ว
- browser ไม่บล็อก cookie ของ domain Static Web Apps
- `ADO_TOKEN_COOKIE_SECRET` และ `ADO_TOKEN_STORE_SECRET` ไม่เปลี่ยนไปมาระหว่าง deploy โดยไม่ตั้งใจ
- ถ้าใช้ server-side token store ให้ตรวจ `ADO_TOKEN_STORAGE_CONNECTION_STRING` หรือ `AzureWebJobsStorage` และ Azure Table `AdoUserTokens`

### Approve / Reject แจ้งว่า Azure DevOps connection required

สาเหตุหลักคือ delegated token ไม่มี, หมดอายุ, refresh ไม่ผ่าน หรือ token record ถูกลบ

แนวทางแก้:

1. กด Connect Azure DevOps ใหม่จาก Dashboard
2. ถ้ายังไม่หาย ให้ Disconnect แล้ว Connect ใหม่
3. ตรวจ token store และ App Registration permissions
4. ตรวจว่า Azure DevOps account ของผู้ใช้มีสิทธิ์ใน project/repository/release approval จริง

### SharePoint Log ไม่ขึ้น

ตรวจ:

- `AAD_TENANT_ID`, `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`
- Graph permission เช่น Sites.ReadWrite.All
- `SHAREPOINT_HOSTNAME`, `SHAREPOINT_SITE_PATH`, `SHAREPOINT_LIST_NAME`
- optional columns มีครบหรือ auto-create ถูกปิดอยู่หรือไม่

### Audit Logs ไม่เรียงล่าสุดก่อน

ระบบแก้ให้ใช้ `lastModifiedDateTime desc` แล้ว หากพบผิดปกติให้ตรวจ:

- SharePoint list item modified time
- API `/api/logs`
- filter บนหน้าเว็บ
- browser cache

### Merge Lookup หาไม่ครบ

แยกสาเหตุ:

- ไม่มี build run บน target branch
- detected CI ไม่มีใน `stg-ci-cd-map.json`
- CSV mapping ยังไม่ได้เพิ่ม CI -> CD
- เป็น branch pattern ใหม่ที่ต้องเพิ่ม rule เฉพาะ

### Daily Summary ไม่ส่ง

ตรวจ:

- Logic Apps enabled หรือไม่
- Schedule 18:00 Asia/Bangkok
- `DAILY_SUMMARY_TOKEN`
- `TEAMS_WEBHOOK_URL`
- SharePoint duplicate `Event_Key`

## Maintenance Workflow

### เพิ่ม CI/CD mapping ใหม่

1. เพิ่มข้อมูลใน CSV ต้นทาง
2. regenerate `api/shared/stg-ci-cd-map.json`
3. ทดสอบ PR ตัวอย่างบน `/merge.html`
4. commit / push
5. monitor production

### เพิ่ม rule Merge เฉพาะ pattern

แก้:

```text
api/shared/merge-pipeline-map.js
```

ใช้เมื่อ CSV mapping อย่างเดียวไม่พอ เช่น target branch pattern ไม่สามารถหา CI จาก build run ได้

### ปรับ Attention Logic

แก้:

```text
api/shared/attention.js
```

เพราะใช้ร่วมกันทั้ง Dashboard และ Daily Summary

### Backup ล่าสุดไป staging

```powershell
git push origin main:staging
git ls-remote --heads origin main staging
```

## ข้อจำกัดและความเสี่ยง

- MergeCode / MergeCodeProduction ต้องทำ manual บน Azure DevOps เพื่อความปลอดภัย
- ถ้า `ADO_PAT` หมดอายุ ระบบจะอ่าน PR / Build / Policy / Release lookup และ background jobs ไม่ได้
- ถ้า delegated user token หมดอายุหรือ refresh ไม่ผ่าน ผู้ใช้ต้อง Connect Azure DevOps ใหม่ก่อนทำ Approve / Reject / Approve Release
- ถ้าย้าย read path ไป delegated user identity เต็มรูปแบบ ต้องระวังว่าผู้ใช้แต่ละคนอาจเห็น PR/Release ไม่เท่ากันตามสิทธิ์ Azure DevOps
- ถ้า Graph permission หรือ SharePoint config มีปัญหา action อาจสำเร็จแต่ log ไม่ครบ
- Staging CI/CD mapping เป็น snapshot จาก CSV ต้อง regenerate เมื่อข้อมูลต้นทางเปลี่ยน
- Daily Summary มี duplicate guard แต่ถ้ามีการเปลี่ยน `Event_Key` logic อาจทำให้ส่งซ้ำได้
- Azure DevOps policy บางแบบอาจไม่สะท้อนใน PR statuses โดยตรง จึงมี fallback branch build สำหรับ MergeCode

## Summary

ADO Auto-Approve เป็นระบบช่วยรวมงานอนุมัติ PR บน staging ให้ทีมเห็นในหน้าเดียว พร้อม action ที่ควบคุมสิทธิ์, audit trail บน SharePoint, notification เฉพาะเรื่องสำคัญ, daily summary และเครื่องมือค้นหา CI/CD สำหรับ PR ประเภท Merge

หลักการสำคัญของระบบคือ:

- PR ปกติทำผ่าน Dashboard ได้
- action สำคัญใน Azure DevOps ทำด้วย delegated user identity หลัง Connect Azure DevOps
- read path และ background jobs ยังใช้ service credential เพื่อให้คิวกลางมีความสม่ำเสมอ
- PR MergeCode / MergeCodeProduction ต้องทำ manual บน Azure DevOps
- ข้อมูล log และ health ต้องตรวจสอบย้อนหลังได้
- notification ต้องลด noise และเน้นเหตุการณ์ที่ต้องสนใจ
- backup ล่าสุดใช้ branch `staging` เพียง branch เดียว
