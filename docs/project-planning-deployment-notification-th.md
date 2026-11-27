# Project Planning → Teams และ LINE Deployment Notification

สถานะเอกสาร: คู่มือตั้งค่า; เตรียมหน้าบันทึกและ API อ่าน SharePoint แล้ว แต่ยังไม่เชื่อมต่อฐานข้อมูลหรือส่งข้อความจริง
วันที่: 26 พฤศจิกายน 2026 (Asia/Bangkok)

## 1. ผลตรวจ repository และขอบเขต

พบว่า repository นี้มี source และแพ็กเกจของ Operations Hub/Power Automate อยู่แล้ว โดยมี flow เดิมสำหรับ incident, approval และการแจ้ง Teams รวมถึงโค้ด LINE Messaging API ใน `api/shared/line-notifier.js` แต่ไม่พบ source ของระบบ Project Planning และไม่พบ flow ที่อ้างถึง `dbo.Internal_ProjectPlanning` หรือ Microsoft Forms สำหรับกรณี deployment นี้โดยตรง

ดังนั้นเอกสารนี้เลือกแนวทาง **สร้าง Scheduled Cloud Flow ใหม่แยกจาก production flow เดิม** หลังจากผู้ดูแลยืนยัน connection และ environment แล้ว ไม่แก้/ปิด/ลบ flow เดิม และไม่สร้าง Power Automate ZIP เพราะยังไม่มี exported definition ของ flow ใหม่นี้และยังไม่มีข้อมูล connection references ที่ปลอดภัยสำหรับ package import

ข้อสังเกตจาก source เดิม: LINE client ใช้ secret จาก environment (`LINE_CHANNEL_ACCESS_TOKEN`) และ target จาก `LINE_TARGET_ID` จึงไม่ควรนำค่าไปใส่ในเอกสารหรือ hard-code ใน flow; สำหรับงานนี้ให้ใช้ชื่อ configuration ที่ชัดเจนกว่า เช่น `LINE_GROUP_ID` ใน secure setting หรือ Azure Key Vault และให้ผู้ดูแล map เข้ากับ action เท่านั้น

## 2. สถาปัตยกรรมที่เสนอ

```text
Recurrence (2–5 นาที, concurrency = 1)
        |
SQL Server: SELECT เฉพาะ ID, ProjectName, Status, DeployType, LastModifiedDate
        |
Filter Status = 410
        |
SharePoint: อ่าน NotificationKey / สถานะช่องทาง
        |
Teams สำเร็จแล้วหรือยัง? ---- ใช่ ---> ข้าม Teams
        |
Post message to Teams group chat
        |
LINE สำเร็จแล้วหรือยัง?  ---- ใช่ ---> ข้าม LINE
        |
HTTP LINE Messaging API push ไปยัง group
        |
SharePoint: อัปเดต TeamsStatus/LineStatus, timestamps และ error แบบไม่ลับ
```

การอ่าน SQL เป็น read-only เท่านั้น ห้ามใช้ trigger, `INSERT`, `UPDATE`, `DELETE`, stored procedure ที่มี side effect หรือแก้ schema ตารางต้นทาง

ข้อความที่สร้างจาก `ProjectName` คือ:

```text
I'm going to deploy {ProjectName}
```

ต้องส่ง Teams ก่อน แล้วจึงส่ง LINE โดยบันทึกผลแยกกัน เพื่อให้กรณี Teams สำเร็จแต่ LINE ล้มเหลวสามารถ retry LINE ได้โดยไม่ส่ง Teams ซ้ำ

## 3. SharePoint notification log

สร้าง SharePoint List ชื่อ เช่น `Project Planning Deployment Notifications` ใน site ของ environment ที่ใช้ทดสอบ/ใช้งานจริง แนะนำ internal name แบบไม่มีช่องว่าง:

| Display name | Internal name | Type | คำแนะนำ |
|---|---|---|---|
| Notification Key | `NotificationKey` | Single line text | Required; ตั้ง Enforce unique values = Yes ถ้า tenant อนุญาต |
| Task Planning ID | `TaskPlanningID` | Number | Required |
| Project Name | `ProjectName` | Single line text | Required |
| Source Status | `SourceStatus` | Number | Required; ค่าปกติ 410 |
| Deploy Type | `DeployType` | Number | Optional |
| Source Last Modified | `SourceLastModified` | Date and time | เก็บค่า source เพื่อ audit |
| Teams Status | `TeamsStatus` | Choice | `Pending`, `Sent`, `Failed`, `Skipped` |
| Teams Sent At | `TeamsSentAt` | Date and time | ว่างจนกว่าจะสำเร็จ |
| LINE Status | `LineStatus` | Choice | `Pending`, `Sent`, `Failed`, `Skipped` |
| LINE Sent At | `LineSentAt` | Date and time | ว่างจนกว่าจะสำเร็จ |
| Error Message | `ErrorMessage` | Multiple lines text | ห้ามใส่ token, header, password หรือ connection string |
| Last Attempt At | `LastAttemptAt` | Date and time | ใช้ตรวจ retry |
| Flow Run ID | `FlowRunId` | Single line text | Optional; ใช้ trace |

ให้สร้าง index ที่ `NotificationKey` และ `TaskPlanningID` หาก SharePoint รองรับตามนโยบาย site

ค่า key เริ่มต้น:

```text
{ID}-DeployCompleted
```

หากเจ้าของระบบยืนยันว่า ID เดิมกลับมาเป็น 410 ได้หลาย deployment รอบ ให้หยุดก่อนเปิดใช้และกำหนด key ที่มี deployment identity เช่น `{ID}-{DeploymentRunID}-DeployCompleted` หรือ `{ID}-{LastModifiedDate}-DeployCompleted` ตาม field ที่เจ้าของระบบรับรอง ห้ามใช้ timestamp เป็นตัวแยกรอบโดยการเดาเอง

## 4. ขั้นตอนสร้าง Power Automate Flow

สร้าง flow ใหม่ชื่อชั่วคราว `Project Planning Deployment Notification - STG` และตั้ง Concurrency control ของ trigger เป็น On, Degree of Parallelism = `1` ระหว่าง pilot

### Trigger และ query

1. **Recurrence** (Built-in): ตั้งช่วง 2–5 นาทีตาม load และ SLA; ใช้ timezone ของ environment ที่ทีมกำหนดให้ชัดเจน
2. **SQL Server – Execute a SQL query (V2)** หรือ action แบบ read-only ที่องค์กรอนุมัติ: เลือก connection ของ STG เท่านั้น ใช้ query แบบ parameterized/allowlist ตาม connector เช่น

   ```sql
   SELECT ID, ProjectName, Status, DeployType, LastModifiedDate
   FROM dbo.Internal_ProjectPlanning
   WHERE Status = 410
   ```

   หาก query action ไม่อนุญาตใน tenant ให้ใช้ **Get rows (V2)** พร้อม table/schema และ Filter Query ที่เทียบเท่า โดยต้องยืนยัน syntax กับ connector ก่อน

3. **Filter array** (Data Operations): กรอง `Status` เป็น integer `410` อีกชั้นหนึ่ง และตัดแถวที่ `ID` หรือ `ProjectName` ว่าง
4. **Apply to each**: ใช้ผลจาก Filter array; ใน pilot ให้ปิด concurrency ของ loop ด้วย หรือคง sequential execution เพื่อไม่ให้รายการเดียวกันชนกัน

### Dedup และ Teams

5. **Compose – NotificationKey**: `concat(string(item()?['ID']), '-DeployCompleted')`
6. **SharePoint – Get items**: เลือก list log และ OData Filter Query เป็น `NotificationKey eq '<ค่า key ที่ encode แล้ว>'`; จำกัด Top Count = 1
7. **Condition – Existing log**: ถ้าพบรายการ ให้ใช้รายการนั้น; ถ้าไม่พบให้ **SharePoint – Create item** ด้วย `TeamsStatus=Pending`, `LineStatus=Pending`, `SourceStatus=410` และข้อมูล source
8. **Condition – Teams not Sent**: ทำต่อเมื่อ `TeamsStatus` ไม่เท่ากับ `Sent`
9. **Microsoft Teams – Post a message in a chat or channel**: เลือก group chat ที่เจ้าของระบบระบุ และใช้ข้อความ `I'm going to deploy {ProjectName}`
10. ถ้าสำเร็จ ใช้ **SharePoint – Update item** ตั้ง `TeamsStatus=Sent`, `TeamsSentAt=utcNow()`, ล้าง/คง error ที่ไม่เกี่ยวกับ Teamsตามนโยบาย; ถ้าล้มเหลว ให้ตั้ง `TeamsStatus=Failed` และ error แบบ sanitize แล้วจบรายการนั้น ไม่ส่ง LINE ต่อในรอบเดียวกัน

### LINE และ retry

11. **Condition – LINE not Sent**: ทำต่อเมื่อ `LineStatus` ไม่เท่ากับ `Sent`; ถ้า Teams ยังไม่ `Sent` ให้ข้าม LINE
12. **HTTP**: `POST https://api.line.me/v2/bot/message/push`

   Headers:

   ```text
   Content-Type: application/json
   Authorization: Bearer <ค่า secret จาก secure configuration เท่านั้น>
   ```

   Body:

   ```json
   {
     "to": "<LINE_GROUP_ID จาก secure configuration>",
     "messages": [{
       "type": "text",
       "text": "I'm going to deploy @{items('Apply_to_each')?['ProjectName']}"
     }]
   }
   ```

13. ตรวจ status code 2xx; ถ้าสำเร็จให้ Update item เป็น `LineStatus=Sent`, `LineSentAt=utcNow()`; ถ้าล้มเหลวให้ `LineStatus=Failed` และเก็บเฉพาะรหัส/ข้อความที่ sanitize แล้ว เช่น `LINE push failed: HTTP 401` ไม่เก็บ Authorization header หรือ response ที่อาจมีข้อมูลลับ
14. ตั้ง retry policy ของ HTTP ตามนโยบาย เช่น exponential retry สำหรับ timeout/429/5xx และไม่ retry อัตโนมัติสำหรับ 4xx ที่เป็น configuration/authentication error; การรันครั้งถัดไปจะอ่าน log แล้ว retry เฉพาะช่องทางที่ไม่ใช่ `Sent`

## 5. First run / dry-run โดยไม่แจ้งย้อนหลัง

ก่อนเปิด action ส่งข้อความจริง ให้ใช้วิธีใดวิธีหนึ่งและบันทึกใน runbook ของ environment:

- **Dry-run flag**: เพิ่ม environment variable/ตัวแปร `NOTIFICATION_DRY_RUN=true`; flow ยังอ่าน SQL และเขียน log ได้ แต่ตั้ง Teams/LINE เป็น `Skipped` พร้อม `ErrorMessage=Dry-run` โดยไม่เรียก connector ส่งข้อความ
- **Cutoff**: เพิ่มเงื่อนไข `LastModifiedDate >= <UTC cutoff ที่ทีมอนุมัติ>` และเริ่มจากเวลาเปิด pilot
- **รายการทดสอบ**: จำกัด `ID` เป็น test record ที่ DBA/owner ระบุ และเปลี่ยนกลับเป็น allowlist/เงื่อนไขปกติหลังยืนยันผล

ห้ามเปิด flow ครั้งแรกด้วยเงื่อนไข `Status=410` อย่างเดียว เพราะจะส่งย้อนหลังให้รายการเก่าทั้งหมดได้

## 6. Configuration และ secrets ที่ผู้ดูแลต้องตั้งเอง

- SQL Server host, database, schema/table และ STG environment ที่ Flow ใช้
- SQL connection/credential หรือ on-premises gateway ที่มี SELECT-only permission ต่อ `dbo.Internal_ProjectPlanning`
- SharePoint site URL, list name และสิทธิ์ของ connection
- Teams group chat/team/channel ปลายทาง และสิทธิ์ของ Teams connection
- `LINE_CHANNEL_ACCESS_TOKEN` ใน Azure Key Vault/secure input/secret store ที่องค์กรอนุมัติ
- `LINE_GROUP_ID` ใน secure configuration; ต้องเป็น group ที่ bot เข้าร่วมแล้ว
- `NOTIFICATION_DRY_RUN`, polling interval, cutoff และ retention ของ log ตามนโยบาย

ห้ามใส่ค่าเหล่านี้ลง source code, ZIP, Git, Compose ที่แสดงค่า, run history หรือเอกสาร หากพบ token/password ใน log ให้ rotate ทันทีและลบการแสดงผลตามกระบวนการ incident ขององค์กร

## 7. Prerequisite และคำถามที่ต้องยืนยัน

1. SQL Server/database ของ STG ที่ Flow จะเชื่อมต่อได้คืออะไร และ gateway/network route พร้อมหรือไม่
2. Identity ของ Flow ได้ SELECT-only จริงหรือไม่ และ query นี้ผ่าน performance review หรือไม่
3. `ID` เป็น key ที่ไม่ซ้ำหรือไม่ และรายการเดิมสามารถกลับเข้า Status 410 หลาย deployment รอบหรือไม่
4. `LastModifiedDate` เป็น timezone ใด และค่าเปลี่ยนเมื่อใด
5. Teams group chat ปลายทางและสิทธิ์ของ connection คืออะไร
6. LINE Official Account เปิด Messaging API แล้วหรือยัง, bot ถูกเชิญเข้า group แล้วหรือยัง และมี `LINE_GROUP_ID` ที่ตรวจสอบแล้วหรือไม่
7. มี Forms-triggered flow เดิมส่ง Teams สำหรับ deployment หรือไม่ ชื่อ/owner/environment/run history คืออะไร

หากยังไม่มี LINE prerequisites ให้ทำ flow ใน dry-run และทดสอบ Teams/log ได้ โดยไม่ส่ง LINE จริง

## 8. แผนป้องกันระบบเดิมส่งซ้ำและการย้ายจาก Forms

ค้น repository แล้วไม่พบหลักฐานของ Forms-triggered deployment flow นี้ จึงยังสรุปไม่ได้ว่าใน Power Automate tenant มี flow ดังกล่าวหรือไม่ ให้เจ้าของ tenant ตรวจจาก Power Automate inventory และ run history ก่อนเปิด flowใหม่

แผนย้ายที่ปลอดภัย:

1. Export/inventory ชื่อ flow เดิม, owner, environment, trigger และ action ส่ง Teams โดยไม่แก้ไข
2. สร้าง flow ใหม่เป็น STG/pilot ด้วย dry-run และ notification log แยก list หรือแยก environment
3. เปรียบเทียบรายการที่ flow ใหม่จะส่งกับ run history ของ Forms flow เพื่อหาช่วงซ้ำ
4. กำหนด owner ให้ flow เดียวเป็นผู้ส่ง deployment notification และทำ change window ที่อนุมัติแล้ว
5. หลัง cutover ให้ปิด trigger/แก้ flow เดิมโดยผู้มีอำนาจเท่านั้น พร้อมเก็บ export เป็น historical artifact; ห้าม agent ปิดหรือลบ production flow อัตโนมัติ

## 9. ข้อจำกัดและความเสี่ยง

- ยังไม่มีการทดสอบ connector จริง, SQL connectivity, Teams, LINE หรือ Power Automate run
- ไม่ยืนยันว่า Filter Query ของ SQL connector ใน tenant รองรับรูปแบบเดียวกับตัวอย่าง ต้อง validate ใน STG
- การตั้ง concurrency = 1 ลด race ได้แต่ลด throughput; หาก polling ใช้เวลานานต้องทบทวน batch size/partition โดยไม่ลดความถูกต้องของ dedup
- หาก SharePoint ไม่มี unique constraint หรือมี parallel run จาก flow อื่น อาจเกิด duplicate ได้ ต้องใช้ concurrency และ/หรือกลไก claim ที่เจ้าของระบบอนุมัติ
- การส่ง Teams สำเร็จแต่การบันทึก log ล้มเหลวมีความเสี่ยงส่งซ้ำในรอบถัดไป จึงต้อง monitor SharePoint connector และพิจารณา idempotency/lock ที่เหมาะสมก่อน production
- ห้ามใช้ source table เป็น notification log และห้ามเปลี่ยน schema เพื่อแก้ปัญหา dedup

## 10. สิ่งที่ยังไม่ได้ทำในงานนี้

ไม่ได้เชื่อมต่อ production/STG, ไม่ได้อ่านแถวข้อมูล, ไม่ได้ส่งข้อความ, ไม่ได้แก้ Power Automate flow เดิม, ไม่ได้สร้างหรือแก้ ZIP package และไม่ได้รัน tests ตามข้อจำกัดของคำขอ

## 11. หน้าตรวจสอบ Notification Log ใน Deployment Report

เพิ่มเมนู **Notification Log** แยกจาก Deployment Report เดิม เพื่อให้ตรวจรายการใน SharePoint โดยไม่ปะปนกับ deployment event จาก Azure DevOps:

- หน้า: `/deployment-notification-log.html` (เมนูใน Deployment Report)
- API อ่านอย่างเดียว: `GET /api/project-planning-notification-log?top=500`
- จำกัดสิทธิ์ API และหน้าเว็บด้วย role `it_support_approve` หรือ `admin`
- ตัวกรองหน้าเว็บ: Project, Task Planning ID, Teams status และ LINE status
- API ส่งกลับเฉพาะคอลัมน์ที่จำเป็น และไม่เปิดเผยรายละเอียดข้อผิดพลาดจาก upstream ให้ browser

API ใช้ app settings เฉพาะของ Notification Log หากมี และ fallback ไปยัง Graph/SharePoint settings ที่ระบบใช้อยู่แล้ว (`AAD_TENANT_ID`, `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`, `SHAREPOINT_HOSTNAME`, `SHAREPOINT_SITE_PATH`) ได้ โดย list name ยังคงเป็น `Project Planning Deployment Notifications` หากไม่ได้กำหนดค่าเฉพาะ วิธีนี้ช่วย reuse credential เดิมโดยไม่ต้องคัดลอก secret ลง setting ซ้ำ

หากยังไม่มี settings เดิมหรือจำเป็นต้องใช้ app registration แยก ผู้ดูแลตั้งค่า App Settings ต่อไปนี้ใน Azure Static Web Apps/Functions ของ **environment ที่อนุมัติ** (แนะนำใช้ Key Vault reference สำหรับ secret):

| App Setting | ค่า |
|---|---|
| `PROJECT_PLANNING_NOTIFICATION_SP_TENANT_ID` | Tenant ID |
| `PROJECT_PLANNING_NOTIFICATION_SP_CLIENT_ID` | App registration สำหรับอ่าน notification log |
| `PROJECT_PLANNING_NOTIFICATION_SP_CLIENT_SECRET` | Secret ใน secure configuration เท่านั้น |
| `PROJECT_PLANNING_NOTIFICATION_SP_HOSTNAME` | SharePoint hostname เช่น `contoso.sharepoint.com` |
| `PROJECT_PLANNING_NOTIFICATION_SP_SITE_PATH` | Site path เช่น `/sites/ADOAuto-Approve` |
| `PROJECT_PLANNING_NOTIFICATION_SP_LIST_NAME` | `Project Planning Deployment Notifications` |

ให้ app registration ได้สิทธิ์ Microsoft Graph แบบ least privilege สำหรับอ่าน list นี้เท่านั้น (เช่น `Sites.Selected` พร้อม site grant แบบ Read ตามกระบวนการอนุมัติของ tenant) ห้ามนำค่า secret ไปใส่ใน `local.settings.json`, source control, browser หรือ log. หากยังไม่ตั้งค่า API จะตอบ `NOT_CONFIGURED` และหน้าเว็บจะแสดงสถานะรอเชื่อมต่อแทนข้อมูลจำลอง.
