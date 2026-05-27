# ADO Auto-Approve

ระบบ Dashboard สำหรับตรวจสอบและอนุมัติ Pull Request บน Azure DevOps โดยออกแบบให้ผู้ใช้งานกลุ่ม IT Support Approve สามารถเห็นงาน PR ที่รออนุมัติบน branch staging ได้จากหน้าเว็บเดียว พร้อมบันทึกผลการดำเนินการลง SharePoint Log และแยกงานประเภท MergeCode ให้เป็นงาน Manual ที่ต้องไปดำเนินการบน Azure DevOps เอง

เอกสารนี้สรุปภาพรวมโครงการ ส่วนประกอบที่เกี่ยวข้อง ขั้นตอนการทำงาน เงื่อนไขสำคัญ และแนวทางดูแลระบบ

## วัตถุประสงค์

- ลดเวลาการตรวจสอบ PR ที่รออนุมัติบน Azure DevOps
- รวมรายการ PR ที่เกี่ยวข้องกับผู้ใช้งานไว้ใน Dashboard เดียว
- แสดงสถานะ Approval ให้เห็นชัดเจน เช่น อนุมัติแล้ว รอผู้อื่นอนุมัติ หรือมี reviewer reject
- รองรับการ Approve และ Reject งาน PR ปกติผ่านหน้าเว็บ
- บันทึก Log การดำเนินการไปที่ SharePoint เพื่อใช้ตรวจสอบย้อนหลัง
- แยกงาน MergeCode ออกจาก automation เพื่อบังคับให้ผู้ใช้งานไปดำเนินการบน Azure DevOps แบบ Manual

## ขอบเขตระบบ

ระบบนี้ใช้สำหรับ Pull Request ที่เกี่ยวข้องกับ branch staging และ reviewer group ที่กำหนดไว้ เช่น `IT Support Approve`

ระบบรองรับ 2 ลักษณะงานหลัก:

| ประเภทงาน | พฤติกรรมบน Dashboard | การดำเนินการ |
|---|---|---|
| PR ปกติ | แสดงปุ่ม Approve และ Reject | ผู้ใช้สามารถดำเนินการผ่าน Dashboard ได้ |
| PR MergeCode | แสดง Highlight และสถานะ Manual | ผู้ใช้ต้องเปิด Azure DevOps แล้วดำเนินการเอง |

สำหรับงาน MergeCode ระบบมีหน้าที่แสดงให้เห็นว่ามีงานรออนุมัติเท่านั้น และจะไม่กด Approve, Reject, Set auto-complete หรือเลือก Merge type แทนผู้ใช้

## ภาพรวมสถาปัตยกรรม

ระบบประกอบด้วย 4 ส่วนหลัก:

| ส่วน | รายละเอียด |
|---|---|
| Frontend | Static Web App แสดงหน้า Login, Dashboard, ตาราง PR, Modal reviewer และปุ่ม action |
| Backend API | Azure Functions สำหรับเรียก Azure DevOps, ทำ approve/reject, เขียน SharePoint Log และตรวจ health |
| Azure DevOps | แหล่งข้อมูล Pull Request, reviewer, approval vote, branch และ policy |
| SharePoint | เก็บ Log action ของผู้ใช้งาน เช่น Approve, Reject หรือ Failed |

Flow โดยรวม:

1. ผู้ใช้เข้าสู่ระบบผ่าน Microsoft Entra ID
2. Dashboard เรียกข้อมูลผู้ใช้จาก Static Web Apps auth
3. Frontend เรียก API เพื่อดึงรายการ PR จาก Azure DevOps
4. Backend ตรวจ reviewer, approval, branch และสถานะ PR
5. Frontend แสดงรายการ PR พร้อมสถานะ
6. หากเป็น PR ปกติ ผู้ใช้สามารถ Approve หรือ Reject ได้
7. Backend ส่ง action ไป Azure DevOps และบันทึก Log ลง SharePoint
8. หากเป็น MergeCode Dashboard จะแสดงเป็น Manual-only และให้เปิด Azure DevOps เอง

## โครงสร้างไฟล์สำคัญ

```text
ado-auto-approve/
├── public/
│   ├── dashboard.html
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── api/
│   ├── list-prs/
│   ├── approve-pr/
│   ├── reject-pr/
│   ├── pr-history/
│   ├── test-notification/
│   ├── userinfo/
│   ├── health/
│   └── shared/
│       ├── ado-client.js
│       └── sharepoint-client.js
├── .github/workflows/
├── staticwebapp.config.json
└── README.md
```

## Frontend

Frontend อยู่ภายใต้โฟลเดอร์ `public/`

### `public/dashboard.html`

เป็นหน้าหลักหลัง Login ใช้สำหรับ:

- แสดงข้อมูลผู้ใช้ที่ login
- แสดงรายการ PR ที่รออนุมัติ
- แสดงจำนวน PR ที่พบ
- แสดงสถานะ Approval
- แสดงสถานะ My Approval ของผู้ใช้ปัจจุบัน
- แสดงปุ่ม Approve, Reject, Open ADO และ Reviewer detail
- แสดงงาน MergeCode แบบ Manual-only

### `public/app.js`

เป็น logic หลักของหน้า Dashboard เช่น:

- โหลดข้อมูลผู้ใช้
- เรียก API ดึงรายการ PR
- render ตาราง PR
- จัดการปุ่ม Approve และ Reject
- เปิด Modal แสดง reviewer
- คำนวณข้อความสถานะบน UI
- แยกงาน MergeCode ออกจากงาน PR ปกติ
- reset ปุ่มโหลดข้อมูลหลังเรียกข้อมูลสำเร็จหรือเกิด error

### `public/styles.css`

ดูแล layout และ responsive behavior ของ Dashboard เช่น:

- ความกว้าง container หลัก
- ตาราง PR แบบ horizontal scroll
- การจัด column ของ PR ID, Title, Branch, Approval, Repo, Created และ Actions
- การแสดง Branch แบบ From/Into
- Modal reviewer ที่แยก style จากตารางหลัก
- ป้องกันข้อความทับซ้อนเมื่อหน้าจอเล็ก

## Backend API

Backend ใช้ Azure Functions ภายใต้โฟลเดอร์ `api/`

### `api/list-prs/index.js`

ใช้ดึงรายการ PR จาก Azure DevOps และส่งข้อมูลกลับให้ Dashboard

หน้าที่หลัก:

- ดึง active Pull Request
- กรอง branch และ reviewer group ที่เกี่ยวข้อง
- ตรวจสถานะ reviewer และ vote
- คำนวณ approval summary
- ตรวจว่า PR เป็นงาน MergeCode หรือไม่
- ส่งข้อมูลสำหรับแสดงในตาราง Dashboard

ข้อมูลที่ Dashboard ใช้จาก API นี้ เช่น:

- PR ID
- Title
- Author
- Source branch
- Target branch
- Repository
- Created date
- Approval count
- My Approval
- Reviewer list
- MergeCode manual flag
- Azure DevOps URL

### `api/approve-pr/index.js`

ใช้สำหรับ Approve PR ปกติผ่าน Dashboard

ขั้นตอนโดยย่อ:

1. รับ PR ID และข้อมูลผู้ใช้จาก request
2. ตรวจข้อมูล PR จาก Azure DevOps
3. ตรวจว่าเป็น PR ที่ระบบอนุญาตให้ approve ผ่านเว็บหรือไม่
4. ส่ง vote approve ไป Azure DevOps
5. บันทึก action ลง SharePoint Log
6. ส่งผลลัพธ์กลับ Frontend

ข้อสำคัญ: งาน MergeCode ต้องไม่ถูก approve ผ่าน endpoint นี้แบบ automation

### `api/reject-pr/index.js`

ใช้สำหรับ Reject PR ปกติผ่าน Dashboard

ขั้นตอนโดยย่อ:

1. รับ PR ID, ผู้ใช้งาน และเหตุผลถ้ามี
2. ส่ง vote reject ไป Azure DevOps
3. บันทึก action ลง SharePoint Log
4. ส่งผลลัพธ์กลับ Dashboard

### `api/pr-history/index.js`

ใช้สำหรับอ่านข้อมูลประวัติหรือรายละเอียด PR เพิ่มเติมตามที่ Dashboard ต้องใช้

### `api/test-notification/index.js`

ใช้สำหรับทดสอบการแจ้งเตือนหรือการเชื่อมต่อ notification ที่เกี่ยวข้องกับระบบ

### `api/health/index.js`

ใช้ตรวจสอบสถานะ backend ว่ายังทำงานได้หรือไม่

### `api/userinfo/index.js`

ใช้คืนข้อมูลผู้ใช้จาก authentication context เพื่อแสดงใน Dashboard

## Shared Backend Clients

### `api/shared/ado-client.js`

รวม logic ที่ใช้ติดต่อ Azure DevOps เช่น:

- เรียก Pull Request API
- อ่าน reviewer
- ส่ง approve/reject vote
- ตรวจ repository และ branch
- สร้าง URL สำหรับเปิด Azure DevOps

### `api/shared/sharepoint-client.js`

รวม logic สำหรับเขียน SharePoint Log ผ่าน Microsoft Graph API เช่น:

- ขอ access token
- สร้าง item ใน SharePoint List
- ส่งข้อมูล action log
- จัดการ error จาก Graph API

## Workflow การใช้งาน

### การโหลดข้อมูล PR

1. ผู้ใช้เปิด Dashboard
2. ระบบโหลดข้อมูลผู้ใช้
3. ผู้ใช้กดปุ่ม `เรียกดูข้อมูล`
4. ปุ่มเปลี่ยนเป็นสถานะ `กำลังโหลด...`
5. Frontend เรียก backend เพื่อดึงรายการ PR
6. Backend ตอบข้อมูล PR กลับมา
7. Dashboard แสดงรายการ PR
8. ปุ่มกลับเป็น `เรียกดูข้อมูล` เพื่อให้กด refresh ใหม่ได้

### การ Approve PR ปกติ

1. ผู้ใช้ตรวจรายการ PR บน Dashboard
2. กดปุ่ม `Approve`
3. Frontend ส่งคำขอไป `api/approve-pr`
4. Backend ส่ง vote approve ไป Azure DevOps
5. Backend บันทึก Log ลง SharePoint
6. Dashboard แสดงผลลัพธ์และ refresh สถานะ

### การ Reject PR ปกติ

1. ผู้ใช้กดปุ่ม `Reject`
2. ระบบส่ง request ไป backend
3. Backend ส่ง vote reject ไป Azure DevOps
4. Backend บันทึก SharePoint Log
5. Dashboard refresh รายการ PR

### งาน MergeCode

งาน MergeCode จะถูกแสดงบน Dashboard เพื่อแจ้งให้ผู้ใช้ทราบว่ามีงานรออนุมัติ แต่ระบบจะไม่ดำเนินการแทนผู้ใช้

แนวทางที่ผู้ใช้ต้องทำเองบน Azure DevOps:

1. เปิด PR ใน Azure DevOps
2. ตรวจ target branch ว่าเป็น `MergeCodeProduction/...`
3. กด `Set auto-complete`
4. เลือก Merge type เป็น `Merge (no fast forward)`
5. หากมี option `Require additional checks` ถูกติ๊กมา ให้เอาติ๊กออกตามเงื่อนไขงาน
6. กด Approve ตามขั้นตอนบน Azure DevOps

Dashboard จึงมีปุ่มหรือสถานะ `Manual in ADO` เพื่อสื่อสารว่ารายการนี้ไม่ใช่งานที่ระบบจะ approve ให้

## Approval Logic

ระบบแสดงข้อมูล Approval เพื่อช่วยให้ผู้ใช้เข้าใจสถานะ PR ได้เร็วขึ้น

สถานะสำคัญ:

| สถานะ | ความหมาย |
|---|---|
| Approved | reviewer ที่ required อนุมัติครบแล้ว |
| Pending | ยังมี required reviewer ที่ยังไม่อนุมัติ |
| Rejected | มี reviewer reject |
| You approved | ผู้ใช้ปัจจุบันอนุมัติแล้ว |
| Waiting others | ผู้ใช้ปัจจุบันอนุมัติแล้ว แต่ยังรอ reviewer คนอื่นหรือ group อื่น |
| Not assigned to you | PR ไม่ได้ assign ให้ผู้ใช้ปัจจุบันโดยตรง |
| Manual in ADO | เป็นงาน MergeCode ต้องทำเองบน Azure DevOps |

ระบบคำนวณ approval จาก required reviewer หรือ required group โดยตรง เพื่อป้องกันการเข้าใจผิดจากจำนวน approval รวมที่ไม่ตรงกับ policy จริง

## Reviewer Modal

Reviewer Modal ใช้สำหรับดูรายละเอียด reviewer ของแต่ละ PR

ข้อมูลที่แสดง:

- Overall status
- จำนวน approval
- Branch policy minimum
- Required reviewers in PR
- Required reviewers ที่ reject
- รายชื่อ reviewer
- ประเภท reviewer เช่น Person หรือ Group
- Required หรือ Optional
- Vote status

Modal นี้ใช้ตารางและ style แยกจากตารางหลัก เพื่อไม่ให้ layout ของ Dashboard ได้รับผลกระทบ

## SharePoint Log

หลังจากผู้ใช้กด Approve หรือ Reject ผ่าน Dashboard ระบบจะบันทึก Log ลง SharePoint List

ตัวอย่างข้อมูลที่ควรเก็บ:

- PR ID
- PR title
- Repository
- Source branch
- Target branch
- Action เช่น Approve หรือ Reject
- Result เช่น Success หรือ Failed
- User email
- User role
- Timestamp
- Error message ถ้ามี
- Azure DevOps URL

SharePoint Log ใช้สำหรับ:

- ตรวจสอบย้อนหลังว่าใครทำ action ใด
- ตรวจสอบกรณี approve/reject ไม่สำเร็จ
- ใช้เป็น audit trail ภายในทีม
- ช่วยวิเคราะห์ปัญหาเมื่อตัวเลขบน Dashboard ไม่ตรงกับ Azure DevOps

## Authentication และ Authorization

ระบบใช้ Microsoft Entra ID ผ่าน Azure Static Web Apps authentication

แนวคิดหลัก:

- ผู้ใช้ต้อง login ด้วยบัญชีองค์กร
- Dashboard อ่านข้อมูลผู้ใช้จาก auth context
- Role ของผู้ใช้ถูกใช้เพื่อกำหนดสิทธิ์และแสดงข้อมูล
- Backend ใช้ token หรือ credential ที่กำหนดใน environment variables เพื่อเรียก Azure DevOps และ Microsoft Graph

## Environment Variables

ตัวแปรแวดล้อมที่เกี่ยวข้องโดยทั่วไป:

| Variable | ใช้สำหรับ |
|---|---|
| `ADO_ORG` | ชื่อ organization บน Azure DevOps |
| `ADO_PROJECT` | ชื่อ project |
| `ADO_REPO` | repository เป้าหมาย |
| `ADO_PAT` | token สำหรับเรียก Azure DevOps API |
| `TENANT_ID` | Microsoft tenant |
| `CLIENT_ID` | application client id |
| `CLIENT_SECRET` | secret สำหรับ Graph API |
| `SHAREPOINT_SITE_ID` | site id ของ SharePoint |
| `SHAREPOINT_LIST_ID` | list id สำหรับเก็บ log |
| `TEAMS_WEBHOOK_URL` | webhook สำหรับ notification ถ้ามีใช้งาน |

ค่าจริงควรเก็บใน Azure Static Web Apps configuration หรือ GitHub secrets ไม่ควร commit ลง repo

## CI/CD และ Deployment

ระบบ deploy ผ่าน GitHub Actions ไปยัง Azure Static Web Apps

ไฟล์ที่เกี่ยวข้อง:

- `.github/workflows/*.yml`
- `staticwebapp.config.json`
- `api/package.json`

Branch ที่ใช้งาน:

| Branch | ใช้สำหรับ |
|---|---|
| `main` | production/current stable version |
| `Staging` | backup หรือ staging copy สำหรับทดสอบ/สำรอง |

ก่อน push ควรตรวจสอบ:

1. `git status`
2. รายการไฟล์ที่แก้ไข
3. diff ของไฟล์สำคัญ
4. commit message
5. GitHub Actions หลัง push
6. หน้าเว็บหลัง deploy สำเร็จ

## Acceptance Criteria

ระบบควรผ่านเงื่อนไขต่อไปนี้:

| หัวข้อ | เกณฑ์ผ่าน |
|---|---|
| Login | ผู้ใช้เข้าระบบด้วยบัญชีองค์กรได้ |
| Load PR | Dashboard โหลดรายการ PR ได้และปุ่มกลับเป็น `เรียกดูข้อมูล` หลังโหลดเสร็จ |
| PR ปกติ | มีปุ่ม Approve และ Reject |
| MergeCode | แสดงเป็น Manual-only และไม่ approve ผ่านเว็บ |
| Approval count | แสดงจำนวน required approval ถูกต้อง |
| My Approval | แสดงว่าผู้ใช้ปัจจุบัน approve แล้วหรือยัง |
| Waiting others | หากผู้ใช้ approve แล้วแต่ยังรอ required reviewer อื่น ต้องแสดงสถานะรอผู้อื่น |
| SharePoint Log | เมื่อ approve/reject ผ่านเว็บ ต้องมี log |
| Responsive layout | ตารางไม่ทับซ้อนเมื่อหน้าจอเล็ก และสามารถ scroll แนวนอนได้ |
| Reviewer Modal | แสดงรายละเอียด reviewer โดยไม่กระทบตารางหลัก |

## ข้อจำกัดและความเสี่ยง

- Azure DevOps policy บางอย่างอาจซับซ้อนกว่าข้อมูล reviewer ที่ API ส่งกลับมา ต้องตรวจสอบเพิ่มเติมเมื่อมี policy ใหม่
- งาน MergeCode ต้องทำ Manual เท่านั้น เพื่อลดความเสี่ยงจากการ merge ผิดขั้นตอน
- หาก SharePoint Graph API ล้มเหลว action บน Azure DevOps อาจสำเร็จแต่ log ไม่ถูกบันทึก ต้องมี error handling ที่ชัดเจน
- หาก Azure DevOps API เปลี่ยน response structure อาจต้องปรับ logic การอ่าน reviewer และ vote
- PAT หรือ secret หมดอายุจะทำให้ backend เรียก Azure DevOps หรือ SharePoint ไม่ได้

## แนวทางทดสอบ

ควรทดสอบอย่างน้อยตามรายการนี้:

1. เปิด Dashboard หลัง login
2. กด `เรียกดูข้อมูล`
3. ตรวจว่าปุ่มเปลี่ยนเป็น `กำลังโหลด...` ระหว่างโหลด
4. ตรวจว่าหลังโหลดเสร็จปุ่มกลับเป็น `เรียกดูข้อมูล`
5. ตรวจ PR ปกติว่ามี Approve/Reject
6. ตรวจ PR MergeCode ว่าไม่มี automation approve และแสดง Manual in ADO
7. ตรวจ PR ที่ผู้ใช้ approve แล้วแต่ยังรอ reviewer อื่น
8. ตรวจ PR ที่มี reviewer reject
9. เปิด Reviewer Modal
10. กด Approve PR ทดสอบ
11. ตรวจ SharePoint Log
12. ตรวจ Azure DevOps ว่า vote เปลี่ยนถูกต้อง
13. ลดขนาดหน้าจอและตรวจว่า layout ไม่ทับซ้อน

## แนวทางดูแลต่อ

- เพิ่ม unit test สำหรับ logic การคำนวณ approval
- เพิ่ม integration test สำหรับ SharePoint Log
- เพิ่มหน้ารายงาน history จาก SharePoint
- เพิ่ม filter ตาม repo, status หรือประเภท PR
- เพิ่มระบบแจ้งเตือนเมื่อมี MergeCode PR รอ manual action
- เพิ่ม monitoring สำหรับ backend error และ Graph API failure

## สรุป

ADO Auto-Approve เป็นระบบที่ช่วยให้ทีมเห็นภาพรวม PR ที่รออนุมัติบน staging ได้ชัดเจนขึ้น ลดงานซ้ำจากการเปิด Azure DevOps หลายหน้า และเพิ่ม audit trail ผ่าน SharePoint Log

หลักการสำคัญของระบบคือ PR ปกติสามารถทำงานผ่าน Dashboard ได้ แต่ PR ที่เป็น MergeCode ต้องแสดงให้เห็นบน Dashboard เท่านั้น และต้องให้ผู้ใช้ไปดำเนินการบน Azure DevOps เองเพื่อความถูกต้องและปลอดภัยของกระบวนการ merge
