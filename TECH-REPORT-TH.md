# 📊 รายงานสรุปเทคโนโลยี — ระบบ ADO Auto-Approve

##โปรเจกต์:** ระบบ Automation Approve Pull Request สำหรับ Staging Branch บน Azure DevOps
**ผู้จัดทำ:** IT Support / Release Engineering Team
**เวอร์ชัน:** Phase 1 + 2 + 3 (Manual Approve with SharePoint Log)
## **ค่าใช้จ่ายรวม:** 0 บาท/เดือน (Free Tier ทั้งหมด) 

---

## 🎯 1. ภาพรวมโครงการ

ระบบเว็บไซต์ภายในองค์กรสำหรับให้ทีม IT Support / Release Engineer อนุมัติ Pull Request ที่ merge เข้า Staging Branch บน Azure DevOps แบบ centralized ด้วยฟีเจอร์:

- เข้าสู่ระบบด้วยบัญชี Microsoft 365 (Single Sign-On)
- แสดงเฉพาะ PR ที่ตนต้องอนุมัติ (filter ตาม reviewer group)
- กดอนุมัติ/ปฏิเสธผ่านเว็บ พร้อม confirm popup ทุกครั้ง (ในเฟสเริ่มต้นช่วงแรก ถ้าระบบสเถียรจะเปลี่ยนไปเป็น Auto)
- ส่งการแจ้งเตือนเข้า Microsoft Teams
- บันทึก audit log ทุก action ลง SharePoint List
- **ไม่แตะ Work Item / Worklist** ตามนโยบายความปลอดภัยหรือเงื่อนไขเพิ่มเติมที่กำหนด

---

## 🏗️ 2. สถาปัตยกรรมระบบ (Architecture)

```
┌─────────────────────────────────────────────────────────────────┐
│                       ผู้ใช้ (User Browser)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS + OAuth2
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│         Azure Static Web Apps (Free Tier)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Frontend (Static Files)                                 │   │
│  │  - HTML5 / CSS3 / Vanilla JavaScript                     │   │
│  │  - index.html (Login page)                               │   │
│  │  - dashboard.html (PR Approval UI)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Built-in Authentication (Microsoft Entra ID)            │   │
│  │  - OAuth 2.0 / OpenID Connect                            │   │
│  │  - Single-Tenant App Registration                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Managed Azure Functions (Node.js 18+)                   │   │
│  │  - /api/list-prs        ดึง PR ที่รออนุมัติ              │   │
│  │  - /api/approve-pr      อนุมัติ + Auto-Complete          │   │
│  │  - /api/reject-pr       ปฏิเสธพร้อมเหตุผล                │   │
│  │  - /api/pr-history/{id} ดู log ของ PR                    │   │
│  │  - /api/test-notification ทดสอบ Teams                    │   │
│  │  - /api/health          Health check                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────┬──────────────────┬─────────────────────┬──────────────────┘
      │                  │                     │
      │ REST API         │ Graph API           │ HTTPS POST
      │ + PAT            │ + Client Creds      │
      ▼                  ▼                     ▼
┌─────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Azure       │  │ Microsoft 365    │  │ Microsoft Teams  │
│ DevOps      │  │ SharePoint List  │  │ (via C-Toss      │
│ (PR + Vote) │  │ (Audit Log)      │  │  Webhook Bot)    │
└─────────────┘  └──────────────────┘  └──────────────────┘

         ┌──────────────────────────────────┐
         │  GitHub (Source + CI/CD)         │
         │  - Auto Deploy on push to main   │
         │  - GitHub Actions runners        │
         └──────────────────────────────────┘
```

---

## 🛠️ 3. รายการเทคโนโลยีที่ใช้

### 3.1 Hosting & Compute

| เทคโนโลยี | เวอร์ชัน | บทบาท | Free Tier Limit |
|---|---|---|---|
| **Azure Static Web Apps** | Free Plan | Host Frontend + API (managed Functions) | 100 GB bandwidth/เดือน, 0.5 GB storage |
| **Azure Functions** (Consumption) | Runtime v4 | Backend logic (Node.js Function App) | 1,000,000 executions/เดือน + 400,000 GB-sec |
| **GitHub** | - | Source code + CI/CD trigger | Unlimited public/private repos (small team) |
| **GitHub Actions** | - | Auto-deploy workflow | 2,000 minutes/เดือน (private repo) |

### 3.2 Runtime & Languages

| เทคโนโลยี | เวอร์ชัน | บทบาท |
|---|---|---|
| **Node.js** | 18.x / 22.x | JavaScript runtime ฝั่ง Backend Functions |
| **HTML5** | - | โครงสร้างหน้าเว็บ |
| **CSS3** | - | สไตล์ (Custom CSS — ไม่ใช้ framework) |
| **Vanilla JavaScript** | ES2017+ | Frontend logic (no React/Vue/jQuery) |
| **Azure Functions Extension Bundle** | `[3.*, 4.0.0)` | Bindings และ extensions ของ Functions |

### 3.3 Authentication & Identity

| เทคโนโลยี | บทบาท |
|---|---|
| **Microsoft Entra ID** (Azure Active Directory) | Identity Provider สำหรับ O365 Login |
| **OAuth 2.0** | Authorization framework |
| **OpenID Connect (OIDC)** | Authentication layer บน OAuth 2.0 |
| **App Registration (Single-Tenant)** | บัญชี application สำหรับ Static Web App ใน Entra ID |
| **Client Credentials Flow** | App-only authentication สำหรับเรียก Graph API |
| **Static Web Apps Built-in Auth** | จัดการ token, session, redirect ให้อัตโนมัติ |

### 3.4 APIs ที่เชื่อมต่อ

| API | Version | บทบาท | Authentication |
|---|---|---|---|
| **Azure DevOps REST API** | 7.0 | ดึง/อนุมัติ/ปฏิเสธ Pull Request | Basic Auth + PAT |
### DevOps Service Hook ใช้แทน REST API ในเฟสต่อไป แล้วให้ Azure Function Process ตามเงื่อนไขที่กำหนด
| **Microsoft Graph API** | v1.0 | อ่าน/เขียน SharePoint List items | Bearer Token (Client Credentials) |
| **C-Toss Webhook Bot** | custom HTTPS endpoint | ส่งข้อความเข้า Teams Channel | URL-based (token ใน URL) |

### 3.5 Data Storage

| เทคโนโลยี | บทบาท | Free Tier |
|---|---|---|
| **SharePoint Online List** | Audit log database (10 columns) | รวมใน M365 license |
| **Azure Static Web Apps Configuration** | Environment variables + secrets | Free |

### 3.6 Security

| เทคโนโลยี/มาตรการ | บทบาท |
|---|---|
| **HTTPS / TLS 1.2+** | เข้ารหัสการสื่อสารทุก endpoint |
| **HMAC Signature Verification** | (สำหรับ webhook receiver) ตรวจ payload |
| **HTTP Basic Auth** | สำหรับ ADO Service Hook (webhook receiver) |
| **Personal Access Token (PAT)** | ใช้กับ ADO REST API (scope: Code Read & Write) |
| **Client Secret** | ใช้กับ Graph API (Client Credentials Flow) |
| **Constant-time string comparison** | กัน timing attack ใน auth verification |
| **CORS / Same-Origin Policy** | จำกัด origin ของ frontend |
| **Strict-Transport-Security** header | บังคับ HTTPS |
| **X-Content-Type-Options: nosniff** | กัน MIME sniffing |
| **X-Frame-Options: DENY** | กัน clickjacking |

### 3.7 Tools / Development

| เครื่องมือ | บทบาท |
|---|---|
| **github.dev** (web-based VS Code) | แก้ไขโค้ดผ่านเบราว์เซอร์ |
| **Azure Portal** | จัดการ Cloud resources + Configuration |
| **Azure DevOps Web** | สร้าง PAT, ดู PR |
| **npm** (Node Package Manager) | Package management (Functions runtime) |

---

## 🗂️ 4. โครงสร้างไฟล์โปรเจกต์

```
ado-auto-approve/
│
├── .github/workflows/
│   └── azure-static-web-apps.yml    Auto-deploy workflow (GitHub Actions)
│
├── public/                          ← Frontend (Static Files)
│   ├── index.html                   หน้า Login
│   ├── dashboard.html               หน้าหลังจาก Login
│   ├── 403.html                     หน้าไม่มีสิทธิ์
│   ├── styles.css                   CSS (Custom, ~750 บรรทัด)
│   └── app.js                       JavaScript (Vanilla, ~390 บรรทัด)
│
├── api/                             ← Backend (Azure Functions)
│   ├── host.json                    Functions runtime config
│   ├── package.json                 Node.js dependencies
│   │
│   ├── shared/                      ← Shared modules
│   │   ├── ado-client.js            ADO REST API helpers
│   │   ├── sharepoint-client.js     Graph API client
│   │   └── teams-notifier.js        Teams webhook sender
│   │
│   ├── userinfo/                    GET /api/userinfo
│   ├── health/                      GET /api/health
│   ├── list-prs/                    GET /api/list-prs
│   ├── approve-pr/                  POST /api/approve-pr
│   ├── reject-pr/                   POST /api/reject-pr
│   ├── pr-history/                  GET /api/pr-history/{prId}
│   ├── test-notification/           POST /api/test-notification
│   └── webhook/                     POST /api/webhook (Phase 2 legacy)
│
├── staticwebapp.config.json         Routes + Auth + Security headers
├── DEPLOY-GUIDE-TH.md               คู่มือ Phase 1 (Login)
├── PHASE2-POLLING-TH.md             คู่มือ Phase 2 (Polling)
├── PHASE3-GUIDE-TH.md               คู่มือ Phase 3 (Approve/Reject)
└── TECH-REPORT-TH.md                ← ไฟล์นี้
```

---

## 🔄 5. การไหลข้อมูล (Data Flow)

### Flow 1: ผู้ใช้ Login

```
User Browser
    │ 1. เข้าเว็บ → ขอ /dashboard.html
    ▼
Static Web App (เห็นว่าต้อง auth)
    │ 2. Redirect → Microsoft login
    ▼
Microsoft Entra ID
    │ 3. ผู้ใช้ใส่บัญชี O365 → ตรวจสิทธิ์
    ▼
Static Web App (รับ ID Token)
    │ 4. ตั้ง cookie + redirect กลับ /dashboard
    ▼
Browser แสดง Dashboard
```

### Flow 2: User กด Approve PR

```
Browser
    │ POST /api/approve-pr + cookie auth
    ▼
Static Web App (verify session)
    │ inject header x-ms-client-principal (user email)
    ▼
Azure Function: approve-pr/index.js
    │
    ├──► ADO REST API: GET /pullrequests/{id}
    │    │ ตรวจ target = staging
    │    │ ดึงข้อมูล PR
    │    └─►
    │
    ├──► ADO REST API: PUT /reviewers/{botId} {vote: 10}
    │    │ ส่ง vote = 10 (Approved)
    │    └─►
    │
    ├──► ADO REST API: PATCH /pullrequests/{id}
    │    │ Set Auto-Complete (transitionWorkItems: false)
    │    └─►
    │
    ├──► ADO REST API: POST /threads
    │    │ Add comment "Approved by user@..."
    │    └─►
    │
    └──► Microsoft Graph API: POST /sites/{id}/lists/{id}/items
         │ บันทึก log entry
         └─►
    
    ▼ Return JSON { ok: true, ... }
Browser แสดง popup "Approve สำเร็จ!"
```

### Flow 3: Auto-Deploy เมื่อ Push Code

```
Developer → git push (หรือ upload via GitHub web)
    │
    ▼
GitHub repository
    │ trigger: push to main
    ▼
GitHub Actions Runner
    │
    ├─► Checkout code
    ├─► Build (Static Web App build action)
    ├─► Use AZURE_STATIC_WEB_APPS_API_TOKEN_xxx
    └─► Deploy to Azure Static Web Apps
    
    ▼
Azure Static Web Apps
    │
    ├─► Update static files (public/)
    └─► Update managed Functions (api/)
```

---

## 💰 6. การวิเคราะห์ค่าใช้จ่าย (Cost Analysis)

| Service | ใช้จริง (ประมาณ) | Free Tier Limit | ค่าใช้จ่าย |
|---|---|---|---|
| Azure Static Web Apps | < 1 GB bandwidth/เดือน | 100 GB/เดือน | 0 บาท |
| Azure Functions | < 30,000 executions/เดือน | 1M/เดือน | 0 บาท |
| Azure Functions GB-sec | < 1,000/เดือน | 400,000/เดือน | 0 บาท |
| Microsoft Entra ID | (รวมใน M365 license) | - | 0 บาท |
| Microsoft Graph API | < 10,000 calls/เดือน | 100,000/แอป/10s | 0 บาท |
| SharePoint Online | < 1 MB log/เดือน | 1 TB tenant + 10 GB/user | 0 บาท |
| GitHub Actions | < 100 minutes/เดือน | 2,000 minutes/เดือน | 0 บาท |
| Azure DevOps REST API | < 5,000 calls/เดือน | ไม่มี hard limit | 0 บาท |
| **รวม** | | | **0 บาท/เดือน** |

> หมายเหตุ: ค่าใช้จ่ายอาจเปลี่ยนแปลงถ้า workload เพิ่มขึ้นมากเกิน free tier (เช่น traffic ทะลุ 100GB/เดือน) แต่สำหรับ scale ระดับ internal tool ที่มีผู้ใช้ < 100 คน workload ระดับนี้ไม่ทะลุแน่นอน

---

## 🔒 7. มาตรการความปลอดภัยที่นำมาใช้

### 7.1 Authentication & Authorization
- **Single Sign-On ด้วย M365** — ใช้บัญชีองค์กรเท่านั้น
- **Single-Tenant App Registration** — จำกัดเฉพาะ tenant ของบริษัท
- **Route-level Protection** — `/dashboard.html` และ `/api/*` ส่วนใหญ่บังคับ `authenticated`
- **Role-based filter** — ดึง PR เฉพาะที่ group "IT Support Approve" เป็น reviewer

### 7.2 Secret Management
- **Environment Variables ผ่าน Azure Configuration** — secret ไม่เคยอยู่ในโค้ด/git
- **PAT scope แคบที่สุด** — Code: Read & Write (ไม่มีสิทธิ์ Work Item)
- **Client Secret + Tenant ID** — ใน Azure Configuration เท่านั้น
- **PAT expiry 90 วัน** — บังคับ rotate

### 7.3 Code-level Safety Nets
- **`transitionWorkItems: false`** — hardcoded ในโค้ดไม่ให้ override (ไม่แตะ Worklist)
- **Branch lock** — ปฏิเสธ approve PR ที่ target ≠ staging (HTTP 403)
- **Reject ต้องมี reason** — บังคับใส่เหตุผลอย่างน้อย 3 ตัวอักษร
- **Lazy require** — ถ้า shared module โหลดไม่ได้ ตอบ JSON ชัด ไม่ crash
- **Constant-time compare** — ป้องกัน timing attack ใน Basic Auth
- **Always JSON response** — ทุก endpoint ส่ง Content-Type ชัด

### 7.4 Transport Security
- HTTPS-only (TLS 1.2+)
- HSTS header (Strict-Transport-Security: max-age=31536000)
- X-Frame-Options: DENY (กัน clickjacking)
- X-Content-Type-Options: nosniff

### 7.5 Audit & Compliance
- ทุก action approve/reject บันทึกลง SharePoint List
- 8 fields ครบ: PR_ID, Action, User, Repository, PR_Title, Target_Branch, Timestamp, Result, Reason
- ดูใน SharePoint web ได้ตลอด — export Excel ได้, filter ได้, share กับ compliance team ได้

---

## 🎓 8. หลักการออกแบบที่ใช้

### 8.1 Architectural Patterns
- **Serverless Architecture** — ไม่ต้องจัดการ server ลด maintenance overhead
- **Static + API Pattern** — Static frontend + API backend แยกชัด
- **Stateless API** — Functions ไม่ถือ state, ข้อมูลอยู่ที่ SharePoint/ADO

### 8.2 Code Practices
- **Lazy Loading** — `require()` shared module ใน try-catch ป้องกัน crash
- **Defensive Programming** — try-catch ทุก external call, validate input
- **Single Responsibility** — แยก shared modules (ado-client, sharepoint-client, teams-notifier)
- **Configuration over Code** — branch name, group name, hostname ผ่าน env vars
- **Explicit Error Response** — ทุก error path ส่ง JSON พร้อม hint

### 8.3 Security Principles
- **Least Privilege** — PAT มีสิทธิ์เฉพาะ Code, ไม่มี Work Item
- **Defense in Depth** — ตรวจ target branch ทั้งใน list และ approve (สองชั้น)
- **Fail Closed** — ถ้า authentication fail → ปฏิเสธ ไม่ใช่ปล่อยผ่าน
- **Audit Everything** — ทุก action บันทึก log ไม่ว่าจะสำเร็จหรือ fail

---

## 📚 9. References & Documentation

### Microsoft Docs
- Azure Static Web Apps: https://docs.microsoft.com/azure/static-web-apps
- Azure Functions Node.js: https://docs.microsoft.com/azure/azure-functions/functions-reference-node
- Microsoft Graph API: https://docs.microsoft.com/graph
- SharePoint Lists via Graph: https://docs.microsoft.com/graph/api/resources/list
- Microsoft Entra ID OAuth: https://docs.microsoft.com/azure/active-directory/develop/v2-oauth2-client-creds-grant-flow

### Azure DevOps Docs
- REST API Reference: https://docs.microsoft.com/rest/api/azure/devops
- Pull Requests API: https://docs.microsoft.com/rest/api/azure/devops/git/pull-requests
- PAT Tokens: https://docs.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate

### Standards
- OAuth 2.0: https://oauth.net/2/
- OpenID Connect: https://openid.net/connect/
- HTTP Strict Transport Security: RFC 6797

---

## 📈 10. สถานะปัจจุบัน & แผนถัดไป

### ✅ ที่ทำเสร็จแล้ว
- Phase 1: Static Web App + O365 Login
- Phase 2: Polling PR จาก ADO + แสดงบน Dashboard
- Phase 3: Manual Approve / Reject + SharePoint Log + Comment ระบุ user

### 🔜 ที่อาจขยายในอนาคต
- **Daily Summary Report** ส่งเข้า Teams ทุกเย็น
- **Statistics Dashboard** — กราฟ trend, top approver
- **Kill Switch** — feature flag ปิดระบบฉุกเฉิน
- **Notification on New PR** — ส่ง Teams เมื่อมี PR ใหม่รอ approve
- **Multi-Reviewer Support** — รองรับ reviewer group หลายกลุ่ม
- **Webhook-based real-time** (ทดแทน polling เมื่อ IT อนุญาต)

---

## 📝 11. สรุปจุดเด่นของระบบ

| มิติ | จุดเด่น |
|---|---|
| **ค่าใช้จ่าย** | 0 บาท/เดือน ใช้ Microsoft Free Tier 100% |
| **ความปลอดภัย** | M365 SSO + Token in Vault + Branch lock + Worklist isolation |
| **Audit** | ทุก action ลง SharePoint Log แบบ persistent |
| **Maintenance** | Serverless — ไม่ต้องดูแล server, OS, patching |
| **Scale** | Auto-scale ตาม load ผ่าน Azure Functions Consumption Plan |
| **24/7** | Static Web Apps + Functions มี SLA ~99.95% |
| **Compliance** | ไม่แตะ Work Item, ทำตามนโยบายเดิมขององค์กร |
| **UX** | Single-page web app + popup confirm กัน mistake |
| **Deploy** | Push to GitHub → Auto-deploy ภายใน 2 นาที |

---

สรุปโครงสร้างรายงาน 11 หัวข้อ

ภาพรวมโครงการ — Vision และฟีเจอร์ทั้งหมด
สถาปัตยกรรมระบบ — Architecture diagram แบบ ASCII (copy ไป word/ppt ได้)
รายการเทคโนโลยี — 7 หมวด (Hosting, Runtime, Auth, APIs, Storage, Security, Tools) พร้อม version + free tier limit
โครงสร้างไฟล์ — File tree พร้อมคำอธิบายแต่ละไฟล์
Data Flow — 3 flows: Login, Approve, Auto-Deploy
Cost Analysis — ตารางค่าใช้จ่ายแต่ละ service vs free tier
Security Measures — 5 ด้าน: AuthN/AuthZ, Secret Management, Code Safety, Transport, Audit
Design Patterns — Architectural patterns, Code practices, Security principles
References — ลิงก์ Microsoft Docs + Standards (OAuth, OIDC, HSTS)
สถานะปัจจุบัน + Roadmap
สรุปจุดเด่น — Highlight 9 มิติ

เทคโนโลยีที่ครอบคลุมในรายงาน
Cloud & Hosting: Azure Static Web Apps, Azure Functions (Consumption), GitHub, GitHub Actions
Runtime: Node.js 18/22, HTML5, CSS3, Vanilla JavaScript, Azure Functions Extension Bundle 3.x
Identity: Microsoft Entra ID, OAuth 2.0, OpenID Connect, App Registration, Client Credentials Flow
APIs: Azure DevOps REST API v7.0, Microsoft Graph API v1.0, C-Toss Webhook Bot
Data: SharePoint Online Lists, Azure SWA Configuration
Security: HTTPS/TLS 1.2+, HMAC, HTTP Basic Auth, PAT, Client Secret, HSTS, X-Frame-Options, Constant-time compare
Tools: github.dev, Azure Portal, npm

**จัดทำเอกสารโดย:** ADO Auto-Approve Project Team
**วันที่:** 26 พฤษภาคม 2026
**Repository:** https://github.com/birdzee4-cmd/ado-auto-approve
