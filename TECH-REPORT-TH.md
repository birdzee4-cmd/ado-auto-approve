# 📊 รายงานสรุปเทคโนโลยี — ระบบ ADO Auto-Approve

**โปรเจกต์:** ระบบ Dashboard และ Automation Approve สำหรับ Pull Request และ Release บน Azure DevOps
**ผู้จัดทำ:** IT Support / Release Engineering Team
**เวอร์ชัน:** Phase 1 + 2 + 3 และฟีเจอร์ส่วนต่อขยาย (Release Approval, Activity, System Health, Merge Lookup, Daily Summary, Log Retention Cleanup)

## **ค่าใช้จ่ายรวม:** ~0 บาท/เดือน (ใช้ Free Tier และ Consumption Plan ทั้งหมด)

---

## 🎯 1. ภาพรวมโครงการ

ระบบเว็บไซต์ภายในองค์กรสำหรับให้ทีม IT Support / Release Engineer อนุมัติ Pull Request และ Release ที่เกี่ยวข้องกับ Staging Branch บน Azure DevOps แบบ Centralized ด้วยฟีเจอร์ต่าง ๆ ดังนี้:

- **Single Sign-On (SSO):** เข้าสู่ระบบด้วยบัญชี Microsoft 365 องค์กร
- **Active PR Queue:** แสดงรายการ PR ทั้งหมดที่กลุ่มผู้ใช้ (เช่นกลุ่ม `it_support_approve`) ต้องดำเนินการอนุมัติ/ปฏิเสธ โดยซ่อนงานที่เสร็จสิ้นแล้วเพื่อลดความซับซ้อน
- **PR & Release Approval UI:** กดอนุมัติ/ปฏิเสธ Pull Request ผ่านหน้า Dashboard พร้อม Confirm popup ป้องกันความผิดพลาด และรองรับการอนุมัติ Classic Release pre-deploy approval ที่ผูกกับ Build ของ PR นั้นได้ทันทีจากแดชบอร์ด
- **Attention & PR Aging Logic:** แสดงระดับความเร่งด่วนของ PR (New, Watching, Warning, Critical, Stale, Ready, Manual) ช่วยให้วิเคราะห์งานค้างได้รวดเร็วขึ้น
- **Activity History:** หน้าประวัติการอนุมัติย้อนหลัง 24 ชั่วโมง ดึงข้อมูลทั้ง Dashboard approval และการอนุมัติภายนอก (External approved) เพื่ออัปเดตสถานะการ Build/Policy ของ PR ล่าสุด
- **Merge Lookup:** หน้าค้นหารายละเอียด CI/CD pipeline สำหรับ PR ประเภท Merge โดยระบุ PR ID ระบบจะวิเคราะห์เงื่อนไขจาก CSV Mapping หรือ Hardcoded Rule ของทีม
- **Audit Logs Search:** หน้าค้นหาและตรวจสอบประวัติการทำรายการ (Audit Log) ค้นหาตาม PR ID, Action, Source และคำค้นหาต่างๆ ย้อนหลังจาก SharePoint List
- **System Health:** หน้าแสดงสถานะระบบ (Connectivity, Token, API Runtime) พร้อมปุ่มคำสั่งทดสอบการส่ง Teams Notification, Daily Summary และ Exception Scan
- **Teams Notifications & Daily Summary:** ส่งการแจ้งเตือนเมื่อเกิดความเสียหายหรือขัดข้อง (Build/Policy Failed) ไปยัง Microsoft Teams และส่งสรุปผลการทำงานรายวันตอน 18:00 (Daily PR Summary)
- **SharePoint Log Retention:** ระบบสแกนล้าง log เก่าเกิน 365 วันอัตโนมัติ โดยทำการบีบอัดเป็น CSV อัปโหลดไปยัง Document Library ของ SharePoint ก่อนลบข้อมูลใน List
- **ความปลอดภัยด้านนโยบาย:** **ไม่แตะต้อง Work Item / Worklist** หรือกระบวนการนอกขอบเขต ตามเงื่อนไขความปลอดภัยและสิทธิ์ PAT ที่จำกัด

---

## 🏗️ 2. สถาปัตยกรรมระบบ (Architecture)

```text
┌─────────────────────────────────────────────────────────────────┐
│                       ผู้ใช้ (User Browser)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS + OAuth2
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│         Azure Static Web Apps (Free Tier)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Frontend (Static Files - public/)                       │   │
│  │  - index.html (Login page)                               │   │
│  │  - dashboard.html (PR & Release Approval UI)             │   │
│  │  - activity.html (Activity History UI)                   │   │
│  │  - merge.html (Merge Lookup UI)                          │   │
│  │  - logs.html (Audit Logs Search UI)                      │   │
│  │  - health.html (System Health UI)                        │   │
│  │  - 403.html (Forbidden page)                             │   │
│  │  - core.css / core.js (Basic styles & shared utilities)    │   │
│  │  - dashboard.css / dashboard.js (Dashboard module)          │   │
│  │  - activity.css / activity.js (Activity History module)      │   │
│  │  - merge.css / merge.js (Merge Lookup module)              │   │
│  │  - logs.css / logs.js (Audit Logs module)                  │   │
│  │  - health.css / health.js (System Health module)            │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Built-in Authentication (Microsoft Entra ID)            │   │
│  │  - OAuth 2.0 / OpenID Connect                            │   │
│  │  - Single-Tenant App Registration                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Managed Azure Functions (Node.js 22)                    │   │
│  │  - /api/userinfo        สิทธิ์และข้อมูลผู้ใช้              │   │
│  │  - /api/health          Authenticated system health       │   │
│  │  - /api/list-prs        ดึง PR ที่รออนุมัติ / ประวัติ      │   │
│  │  - /api/approve-pr      อนุมัติ PR + Auto-Complete        │   │
│  │  - /api/reject-pr       ปฏิเสธ PR พร้อมเหตุผล             │   │
│  │  - /api/approve-release อนุมัติ Classic Release           │   │
│  │  - /api/pr-history/{id} ดู log ของ PR รายตัว              │   │
│  │  - /api/merge-lookup    ค้นหา CI/CD สำหรับงาน Merge       │   │
│  │  - /api/logs            ดึง Audit Logs จาก SharePoint     │   │
│  │  - /api/daily-summary   สรุปผลการทำงานประจำวัน             │   │
│  │  - /api/exception-scan  สแกนและแจ้งเตือน exception       │   │
│  │  - /api/log-retention-cleanup ล้าง/Archive Log เก่า       │   │
│  │  - /api/test-notification ทดสอบแจ้งเตือน Teams            │   │
│  │  - /api/webhook         (Legacy webhook receiver)        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────┬──────────────────┬─────────────────────┬──────────────────┘
      │                  │                     │
      │ REST API /       │ Graph API           │ HTTPS POST
      │ Release API      │ + Client Creds      │ (Teams Webhook)
      │ + PAT            │                     │
      ▼                  ▼                     ▼
┌─────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Azure       │  │ Microsoft 365    │  │ Microsoft Teams  │
│ DevOps      │  │ SharePoint List  │  │ (via C-Toss      │
│ (PR/Release)│  │ (Log + Archive)  │  │  Webhook Bot)    │
└─────────────┘  └──────────────────┘  └──────────────────┘

         ┌──────────────────────────────────┐
         │  GitHub (Source + CI/CD)         │
         │  - Auto Deploy on push to main   │
         │  - GitHub Actions runners        │
         └──────────────┬───────────────────┘
                        │
                        ▼ (Trigger / Call APIs)
         ┌──────────────────────────────────┐
         │  Azure Logic Apps (Consumption)  │
         │  - Trigger Daily Summary (18:00)  │
         │  - Trigger Exception Scan / Log  │
         │    Retention Cleanup             │
         └──────────────────────────────────┘
```

---

## 🛠️ 3. รายการเทคโนโลยีที่ใช้

### 3.1 Hosting & Compute

| เทคโนโลยี | เวอร์ชัน | บทบาท | Free Tier Limit / ราคา |
|---|---|---|---|
| **Azure Static Web Apps** | Free Plan | Host Frontend + Managed Functions API | 100 GB bandwidth/เดือน, 0.5 GB storage (ฟรี) |
| **Azure Functions** (Consumption) | Runtime v4 | Backend logic (Node.js Function App) | 1,000,000 executions/เดือน + 400,000 GB-sec (ฟรี) |
| **Azure Logic Apps** | Consumption | ตัวจับคู่เวลาเรียก API รายวัน/รายเดือน | จ่ายตามทริกเกอร์จริง (เฉลี่ยน้อยกว่า 10 บาท/เดือน) |
| **GitHub** | - | จัดเก็บโค้ด (Source code) + CI/CD trigger | ฟรีสำหรับการใช้งานของทีม |
| **GitHub Actions** | - | Auto-deploy workflow ไปยัง Azure SWA | 2,000 minutes/เดือน (ฟรี) |

### 3.2 Runtime & Languages

| เทคโนโลยี | เวอร์ชัน | บทบาท |
|---|---|---|
| **Node.js** | 22.x | Runtime หลักฝั่ง Backend Functions ในระบบ Azure SWA |
| **HTML5** | - | โครงสร้างไฟล์ Frontend (Dashboard, Activity, Merge, Logs, Health ฯลฯ) |
| **CSS3** | - | สไตล์การตกแต่งระบบ (Custom CSS — ขนาดประมาณ 3,023 บรรทัด / ~57 KB) |
| **Vanilla JavaScript** | ES2022+ | โครงสร้าง Logic การทำงานฝั่ง UI Client (ขนาดประมาณ 2,619 บรรทัด / ~110 KB) |
| **Azure Functions Extension Bundle** | `[3.*, 4.0.0)` | ตัวจัดการ Bindings และ extensions ของ Azure Functions App |

### 3.3 Authentication & Identity

| เทคโนโลยี | บทบาท |
|---|---|
| **Microsoft Entra ID** | Identity Provider (IdP) สำหรับการ Login ด้วยบัญชีอีเมลองค์กร (M365) |
| **OAuth 2.0 / OpenID Connect** | โปรโตคอลการทำ Authentication และ Authorization |
| **App Registration (Single-Tenant)** | ตั้งค่าแอปพลิเคชันบน Azure Portal ให้จำกัดสิทธิ์ใช้งานเฉพาะใน Tenant องค์กรเท่านั้น |
| **Client Credentials Flow** | ใช้ Client ID และ Client Secret ในการร้องขอ token จาก Microsoft Entra ID เพื่อใช้คุยกับ Microsoft Graph API |
| **SWA Built-in Auth** | จัดการ Cookie, Session, และ User Principal ส่งผ่าน Request Header ให้อัตโนมัติ |
| **Role-based Access Control (RBAC)** | จำกัดสิทธิ์ฟังก์ชันการทำงานที่สำคัญ (Approve/Reject) เฉพาะผู้ใช้ที่มีบทบาท `it_support_approve` |

### 3.4 APIs ที่เชื่อมต่อ

| API | Version | บทบาท | Authentication |
|---|---|---|---|
| **Azure DevOps REST API** | 7.0 | ดึงข้อมูล PR, Vote สิทธิ์ของผู้ใช้, และสั่ง Auto-Complete target | Basic Auth + Personal Access Token (PAT) |
| **Azure DevOps Release API** | 7.0 | ดึงข้อมูลประวัติ Classic Release และอนุมัติ deployment pre-approvals | Basic Auth + Personal Access Token (PAT) |
| **Microsoft Graph API** | v1.0 | จัดการบันทึก/อ่าน SharePoint List, ค้นหา User Profile Display Name, จัดเก็บไฟล์ CSV Archive | OAuth 2.0 Bearer Token (Client Credentials) |
| **C-Toss Webhook Bot** | custom | ส่งการแจ้งเตือนการเกิด Exception และ Daily Summary เข้า Teams | URL-based token |

### 3.5 Data Storage

| เทคโนโลยี | บทบาท | ค่าใช้จ่าย |
|---|---|---|
| **SharePoint Online List** | บันทึกประวัติการกระทำ (Audit Log) ทั้งหมด | รวมอยู่ในลิขสิทธิ์ M365 ขององค์กร |
| **SharePoint Document Library** | เก็บไฟล์ Archive CSV ย้อนหลังจากกระบวนการ Retention | รวมอยู่ในลิขสิทธิ์ M365 ขององค์กร |
| **Azure SWA Configuration** | เก็บค่าตัวแปรระบบ (Environment Variables & Secrets) | ฟรี |

### 3.6 Security

| เทคโนโลยี/มาตรการ | บทบาท |
|---|---|
| **HTTPS / TLS 1.2+** | เข้ารหัสการสื่อสารข้อมูลทั้งหมดที่รับส่งผ่าน Network |
| **HMAC Signature Verification** | ป้องกัน Payload Spoofing สำหรับการตรวจสอบ Webhook payloads |
| **HTTP Basic Auth** | สำหรับตรวจสอบความถูกต้องของ REST API Webhook (หากมี) |
| **Personal Access Token (PAT)** | กำหนด Scope สิทธิ์แคบที่สุด: `Code (Read & Write)` และ `Release (Read, Write & Manage)` เท่านั้น |
| **Graph Client Secret** | บันทึกเฉพาะใน Azure Configuration ป้องกันรั่วไหล |
| **Constant-time string comparison** | ป้องกัน Timing Attack ในกระบวนการยืนยันรหัสผ่าน / basic auth token |
| **Security Headers** | บังคับใช้ HSTS, X-Content-Type-Options: nosniff, X-Frame-Options: DENY และป้องกัน Clickjacking |

### 3.7 Tools / Development

| เครื่องมือ | บทบาท |
|---|---|
| **Visual Studio Code / github.dev** | ใช้สำหรับพัฒนา แก้ไข ปรับปรุงซอร์สโค้ดของระบบ |
| **Azure Portal** | ตรวจสอบและตั้งค่าทรัพยากรระบบ Cloud รวมถึงตรวจสอบ log ของ API |
| **Azure DevOps Console** | จัดการกำหนดสิทธิ์, สร้าง PAT, และตรวจสอบ Pull Requests |
| **npm** | ใช้จัดการและทดสอบความพร้อมของ Functions runtime dependencies |

---

## 🗂️ 4. โครงสร้างไฟล์โปรเจกต์

```text
ado-auto-approve/
│
├── .github/workflows/
│   └── [azure-static-web-apps.yml](file:///d:/Github/ado-auto-approve/ado-auto-approve/.github/workflows/azure-static-web-apps.yml)    GitHub Actions workflow สำหรับ deploy ไปยัง Azure SWA
│
├── public/                          ← โฟลเดอร์สำหรับ Frontend (Static Files)
│   ├── [index.html](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/index.html)                   หน้าหลัก Login (ผ่าน Microsoft Entra ID)
│   ├── [dashboard.html](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/dashboard.html)               หน้าหลัก Dashboard (PR Queue + Release Approval)
│   ├── [activity.html](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/activity.html)                หน้าประวัติ PR/Approval ที่เกิดขึ้นในรอบ 24 ชั่วโมง
│   ├── [merge.html](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/merge.html)                   หน้าค้นหา/วิเคราะห์ CI/CD pipeline สำหรับ PR ประเภท Merge
│   ├── [logs.html](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/logs.html)                    หน้าสำหรับค้นหาและตรวจสอบประวัติการทำรายการย้อนหลัง
│   ├── [health.html](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/health.html)                  หน้าตรวจสอบสุขภาพระบบภายนอกและการทำงานของ API
│   ├── [403.html](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/403.html)                     หน้าแจ้งเตือนไม่มีสิทธิ์ใช้งานระบบ (Forbidden)
│   ├── [core.css](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/core.css) / [core.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/core.js)            สไตล์พื้นฐานและฟังก์ชันบริการหลัก (safeFetch, modals, theme)
│   ├── [dashboard.css](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/dashboard.css) / [dashboard.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/dashboard.js)   สไตล์และคอนโทรลเลอร์สำหรับหน้า Dashboard อนุมัติ PR/Release
│   ├── [activity.css](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/activity.css) / [activity.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/activity.js)      สไตล์และคอนโทรลเลอร์สำหรับหน้าแสดงประวัติกิจกรรมย้อนหลัง
│   ├── [merge.css](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/merge.css) / [merge.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/merge.js)            สไตล์และคอนโทรลเลอร์สำหรับหน้าค้นหา/วิเคราะห์ Merge Pipeline
│   ├── [logs.css](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/logs.css) / [logs.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/logs.js)               สไตล์และคอนโทรลเลอร์สำหรับหน้าค้นหา SharePoint Audit Logs
│   ├── [health.css](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/health.css) / [health.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/health.js)            สไตล์และคอนโทรลเลอร์สำหรับหน้าประเมินและตรวจสอบ System Health
│   └── assets/                      โฟลเดอร์เก็บรูปภาพไอคอนและแบนเนอร์
│       ├── [buzzebees-banner.png](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/assets/buzzebees-banner.png)
│       ├── [buzzebees-icon.png](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/assets/buzzebees-icon.png)
│       └── [buzzebees-powered.png](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/assets/buzzebees-powered.png)
│
├── api/                             ← โฟลเดอร์สำหรับ Backend (Azure Functions Model V3)
│   ├── [host.json](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/host.json)                    การตั้งค่า Extension Bundle ของ Azure Functions runtime
│   ├── [package.json](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/package.json)                 รายการ Node Dependencies ของ API
│   │
│   ├── shared/                      ← โฟลเดอร์โมดูลที่ใช้ร่วมกันใน Backend
│   │   ├── [auth.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/auth.js)                  ตัวประเมินและดึงข้อมูลสิทธิ์และ Role ของผู้ใช้งาน
│   │   ├── [ado-client.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/ado-client.js)            ตัวเชื่อมต่อบริการ ADO REST API และ Release API
│   │   ├── [sharepoint-client.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/sharepoint-client.js)     ตัวเชื่อมต่อและบันทึก log ลง SharePoint List / Archive
│   │   ├── [teams-notifier.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/teams-notifier.js)        ตัวส่งการแจ้งเตือนหา Teams Channel (Webhook)
│   │   ├── [attention.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/attention.js)             ตัวคำนวณและประเมินระดับความด่วน (Attention Logic)
│   │   ├── [notification-service.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/notification-service.js)  ตัวคัดกรองและสแกนประวัติการทำงานเพื่อส่ง Teams alert
│   │   ├── [merge-pipeline-map.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/merge-pipeline-map.js)    ตัวเช็คจับคู่ CI/CD rule สำหรับงาน Merge
│   │   ├── [stg-ci-cd-map.json](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/stg-ci-cd-map.json)       ข้อมูลแผนผัง CI/CD mapping สำหรับการอ้างอิง
│   │   └── [user-profile.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/user-profile.js)          ตัวดึงข้อมูลชื่อ-สกุลจาก AD ผ่าน Graph API (User lookup)
│   │
│   ├── userinfo/                    Endpoint คืนค่าข้อมูลและสิทธิ์ของผู้ใช้งาน [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/userinfo/index.js)
│   ├── health/                      Endpoint ตรวจสอบระบบภายนอกและ runtime หลัง login [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/health/index.js)
│   ├── list-prs/                    Endpoint คืนค่า PR Active และ Activity PR [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/list-prs/index.js)
│   ├── approve-pr/                  Endpoint บันทึกอนุมัติและตั้งค่า Auto-Complete PR [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/approve-pr/index.js)
│   ├── reject-pr/                   Endpoint ปฏิเสธ PR พร้อมแนบเหตุผลการทำรายการ [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/reject-pr/index.js)
│   ├── approve-release/             Endpoint บันทึกอนุมัติ Classic Release Pre-deploy [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/approve-release/index.js)
│   ├── pr-history/                  Endpoint คืนประวัติ log ของ PR รายรายการ [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/pr-history/index.js)
│   ├── merge-lookup/                Endpoint ค้นหาและจับคู่ CI/CD สำหรับงาน Merge [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/merge-lookup/index.js)
│   ├── logs/                        Endpoint คืนค่าประวัติ log จาก SharePoint List [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/logs/index.js)
│   ├── daily-summary/               Endpoint สแกนส่งรายงานความก้าวหน้ารายวันหา Teams [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/daily-summary/index.js)
│   ├── exception-scan/              Endpoint สแกนและส่ง alert build/policy fail หา Teams [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/exception-scan/index.js)
│   ├── log-retention-cleanup/       Endpoint Archive ข้อมูล CSV ขึ้น SharePoint และล้าง log เก่า [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/log-retention-cleanup/index.js)
│   ├── test-notification/           Endpoint สำหรับทดสอบฟังก์ชัน Teams Webhook [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/test-notification/index.js)
│   ├── test-daily-summary/          Endpoint สำหรับการดึงสลากทดสอบทำ Daily Summary [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/test-daily-summary/index.js)
│   ├── test-exception-scan/         Endpoint ทดสอบ exception scan ของ API [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/test-exception-scan/index.js)
│   └── webhook/                     Endpoint webhook (Legacy receiver) [index.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/webhook/index.js)
│
├── docs/                            ← โฟลเดอร์เก็บเอกสารเพิ่มเติม
│   └── [approve-release-workflow.md](file:///d:/Github/ado-auto-approve/ado-auto-approve/docs/approve-release-workflow.md)  แผนภาพแสดงขั้นตอนการอนุมัติ Release
│
├── [public/staticwebapp.config.json](file:///d:/Github/ado-auto-approve/ado-auto-approve/public/staticwebapp.config.json) ระบบ Routing, Authentication และ Security Headers สำหรับ SWA
├── [README.md](file:///d:/Github/ado-auto-approve/ado-auto-approve/README.md)                        เอกสารคู่มือระบบหลักภาษาไทย
├── [SKILL.md](file:///d:/Github/ado-auto-approve/ado-auto-approve/SKILL.md)                         คู่มือ Developer Skill การแก้ไขปรับปรุงระบบ
└── [TECH-REPORT-TH.md](file:///d:/Github/ado-auto-approve/ado-auto-approve/TECH-REPORT-TH.md)                รายงานเทคโนโลยีฉบับนี้
```

---

## 🔄 5. การไหลข้อมูล (Data Flow)

### Flow 1: ผู้ใช้ Login เข้าใช้งานระบบ

```text
User Browser
    │ 1. เรียกหน้าเว็บ Dashboard หรือหน้าอื่นที่ต้อง Authentication
    ▼
Azure SWA Built-in Auth
    │ 2. คัดกรองและส่งการเชื่อมต่อ → Microsoft Login (Entra ID)
    ▼
Microsoft Entra ID
    │ 3. ตรวจสอบการ Login และสิทธิ์การใช้งานบัญชีองค์กร
    ▼
Azure SWA (รับ ID Token)
    │ 4. บันทึก Client Principal, สร้าง Session Cookie, ส่งกลับเข้าหน้าเว็บปลายทาง
    ▼
Browser แสดงผลหน้า Dashboard พร้อมแนบสิทธิ์ผู้ใช้ใน Header
```

### Flow 2: ผู้ใช้อนุมัติ Pull Request (Approve PR)

```text
Browser
    │ POST /api/approve-pr + Cookie Authentication
    ▼
Azure Static Web App (Verify session)
    │ ยืนยันสิทธิ์และทำการ Inject Header: x-ms-client-principal
    ▼
Azure Function: approve-pr/index.js
    │
    ├──► 1. ตรวจสอบสิทธิ์ (RBAC: it_support_approve) และข้อมูลผู้ใช้
    │
    ├──► 2. ADO REST API: GET /pullrequests/{prId}
    │    │ ตรวจสอบ target branch ต้องชี้ไปที่ staging
    │    └─►
    │
    ├──► 3. ADO REST API: PUT /reviewers/{botId} { vote: 10 }
    │    │ ส่งการ Approve (Vote = 10) ในฐานะ bot/service account
    │    └─►
    │
    ├──► 4. ADO REST API: PATCH /pullrequests/{prId}
    │    │ ตั้งค่า Auto-Complete (transitionWorkItems: false)
    │    └─►
    │
    ├──► 5. ADO REST API: POST /threads
    │    │ เขียน comment อ้างอิงว่าอนุมัติโดยบัญชีผู้ใช้งานใด
    │    └─►
    │
    └──► Graph API: POST /sites/{siteId}/lists/{listId}/items
         │ บันทึกข้อมูลประวัติ (Audit Log) การอนุมัติ PR สำเร็จ
         └─►
    
    ▼ คืนค่าผลการประมวลผล JSON { ok: true, ... }
Browser แสดงผล "อนุมัติ PR สำเร็จ!"
```

### Flow 3: ผู้ใช้อนุมัติ Classic Release (Approve Release)

```text
Browser
    │ POST /api/approve-release + Cookie Authentication
    ▼
Azure Static Web App (Verify session)
    │ ยืนยันสิทธิ์และทำการ Inject Header: x-ms-client-principal
    ▼
Azure Function: approve-release/index.js
    │
    ├──► 1. ตรวจสอบสิทธิ์ (RBAC: it_support_approve) และข้อมูลผู้ใช้
    │
    ├──► 2. ADO REST API: GET /pullrequests/{prId}
    │    │ ตรวจสอบข้อมูล PR และ Build ID ที่เกี่ยวข้อง
    │    └─►
    │
    ├──► 3. ADO Release API: ตรวจสอบและค้นหา Release Pipeline Run ที่ผูกกับ Build ID
    │    │ ตรวจสอบสถานะการ Deploy และสถานะ pre-deploy approvals
    │    └─►
    │
    ├──► 4. ADO Release API: PATCH /release/approvals/{approvalId}
    │    │ ส่งคำสั่งอนุมัติ Release (Status = approved) เฉพาะเมื่อมี pending approvals จริง
    │    └─►
    │
    └──► Graph API: POST /sites/{siteId}/lists/{listId}/items
         │ บันทึกข้อมูลประวัติ (Audit Log) เป็น action "Release Approved"
         └─►
    
    ▼ คืนค่าผลการประมวลผล JSON { ok: true, ... }
Browser แสดงผล "อนุมัติ Release สำเร็จ!"
```

### Flow 4: ระบบการส่ง Daily Summary & Exception Scan

```text
Azure Logic Apps (ตั้งเวลาทริกเกอร์ตามรอบการทำงาน)
    │ 1. ยิง HTTPS POST เข้า Endpoint (/api/daily-summary หรือ /api/exception-scan)
    │    พร้อมแนบ token ใน Request Header เพื่อยืนยันความปลอดภัย
    ▼
Azure Functions (API)
    │
    ├──► 2. ตรวจสอบความถูกต้องของ Token ใน Request Header
    │
    ├──► 3. รวบรวมข้อมูลสถานะการทำรายการและ PR ล่าสุดจาก SharePoint Lists / ADO
    │
    ├──► 4. ประมวลผลและคัดกรอง Exception หรือข้อมูลสรุปภาพรวม
    │
    ├──► 5. ป้องกันการส่งซ้ำ: ตรวจสอบ/บันทึก Event_Key ใน SharePoint List
    │
    └──► 6. HTTPS POST ไปยัง Teams Webhook Bot (ส่งข้อความเข้า Channel ในรูปแบบ Card)
```

### Flow 5: การติดตั้งและอัปเดตโค้ดอัตโนมัติ (Auto-Deploy Flow)

```text
ผู้พัฒนาโปรเจกต์ → สั่ง git push ขึ้น branch main
    │
    ▼
GitHub Repository
    │ ตรวจจับการ Push เข้า branch main และกระตุ้น GitHub Actions
    ▼
GitHub Actions Runner
    │
    ├─► 1. Checkout source code จาก repository
    ├─► 2. เรียกใช้งาน Azure Static Web Apps Deploy Action
    ├─► 3. ใช้ Secrets API Token ทำการยืนยันสิทธิ์กับ Azure SWA
    └─► 4. คอมไพล์และอัปโหลด Frontend (public/) และ Backend (api/) ไปยัง Cloud
    
    ▼ ปลายทางระบบพร้อมใช้งาน
Azure Static Web Apps (อัปเดตไฟล์ HTML/CSS และ API Runtime Node 22 ทันที)
```

---

## 💰 6. การวิเคราะห์ค่าใช้จ่าย (Cost Analysis)

สถิติการใช้งานและการประเมินรายเดือนสำหรับผู้ใช้กลุ่ม IT Support / Release Engineer (ไม่เกิน 100 คน):

| ทรัพยากรระบบ (Service) | ปริมาณใช้งานจริง (ประมาณการ) | ขีดจำกัด Free Tier | ค่าใช้จ่ายรายเดือน |
| --- | --- | --- | --- |
| **Azure Static Web Apps** | < 1 GB Bandwidth / เดือน | 100 GB Bandwidth / เดือน | 0.00 บาท |
| **Azure Functions** | < 30,000 requests / เดือน | 1,000,000 executions / เดือน | 0.00 บาท |
| **Azure Functions GB-sec** | < 1,000 GB-sec / เดือน | 400,000 GB-sec / เดือน | 0.00 บาท |
| **Azure Logic Apps** | ~100 runs / เดือน (ตั้งเวลา) | จ่ายตามทริกเกอร์จริง (Consumption) | ~0.00 บาท (ต่ำกว่า 1 บาท) |
| **Microsoft Entra ID** | SSO Login | รวมอยู่ใน Microsoft 365 License องค์กร | 0.00 บาท |
| **Microsoft Graph API** | < 15,000 requests / เดือน | 100,000 requests / app / 10s | 0.00 บาท |
| **SharePoint Online** | < 2 MB ข้อมูล log / เดือน | 1 TB Tenant + 10 GB ต่อ User | 0.00 บาท |
| **GitHub Actions** | < 100 Build minutes / เดือน | 2,000 Build minutes / เดือน | 0.00 บาท |
| **Azure DevOps REST API** | < 10,000 requests / เดือน | ไม่จำกัดปริมาณใช้งานอย่างเป็นทางการ | 0.00 บาท |
| **ยอดค่าใช้จ่ายรวม** | | | **0.00 บาท/เดือน** |

> **หมายเหตุ:** ในทางปฏิบัติ ค่าใช้จ่ายทั้งหมดจะถูกหักลบด้วย Free Tier และลิขสิทธิ์ M365 ที่องค์กรใช้งานอยู่แล้ว ทำให้ค่าใช้จ่ายสุทธิฝั่ง Azure Cloud เป็น 0.00 บาทต่อเดือนได้อย่างถาวรภายใต้ workload ระดับ internal tool

---

## 🔒 7. มาตรการความปลอดภัยที่นำมาใช้

### 7.1 Authentication & Authorization (RBAC)

- **สิทธิ์การใช้งานจำกัด:** บังคับให้ผู้ใช้งานทุกคนเข้าผ่าน Microsoft Entra ID SSO ภายใต้ Tenant องค์กรที่กำหนดเท่านั้น
- **การคัดกรองระดับเส้นทาง (Route-level protection):** กำหนดสิทธิ์ให้แดชบอร์ดและ API ที่ใช้งานผ่านหน้าเว็บ รวมถึง `/api/health` รองรับเฉพาะผู้ใช้ที่ `authenticated` แล้ว ส่วน endpoint สำหรับ scheduler ต้องใช้ token เฉพาะใน header
- **Role-based Access Control:** ปุ่ม Approve PR, Reject PR, และ Approve Release จะทำงานได้เฉพาะผู้ใช้ที่มีบทบาท `it_support_approve` เท่านั้น (สำหรับผู้ใช้งานทั่วไปจะถูกซ่อนปุ่มและไม่สามารถยิงคำขอเข้า API ได้)

### 7.2 Secret Management

- **การเก็บรักษาความลับ:** ข้อมูล Token และ Key ต่าง ๆ ถูกบันทึกเป็น Environment Variables บน Azure Static Web Apps Configuration ไม่มีการระบุลงในซอร์สโค้ดของ Git
- **ขอบเขตสิทธิ์ PAT ที่จำกัด:** Azure DevOps PAT ที่ใช้งานได้รับสิทธิ์จำกัดในระดับ `Code: Read & Write` และ `Release: Read, Write & Manage` เท่านั้น และกำหนดอายุขยายไม่เกิน 90 วันเพื่อความปลอดภัย

### 7.3 Code-level Safety Nets (ระบบป้องกันความผิดพลาดในโค้ด)

- **Branch target Lock:** ระบบ API จะตรวจสอบว่า target branch ของ PR เป็น `refs/heads/staging` (หรือ Branch พิเศษที่รองรับตาม Rule) เสมอ หากผู้ใช้พยายามเรียกอนุมัติ PR อื่น API จะปฏิเสธคำขอทันที
- **บังคับเหตุผลสำหรับการปฏิเสธ:** การ Reject PR จะต้องแนบเหตุผลที่มีความยาวขั้นต่ำ 3 ตัวอักษร
- **`transitionWorkItems: false`:** มีการ Hardcoded ค่านี้ในกระบวนการ Auto-Complete เพื่อไม่ให้กระทบต่อ Work Item และรักษาความปลอดภัยของระบบ Worklist
- **Double Validation for Release:** การส่งคำสั่งอนุมัติ Release จะตรวจสอบประวัติความสัมพันธ์ของ PR -> Build -> Release และต้องตรวจพบรายการ pre-deploy approval สถานะ `pending` บน ADO จริง ๆ เท่านั้น
- **Duplicate Prevention:** ใช้คีย์เฉพาะ `Event_Key` (เช่น PR_ID + Action + Date/Build ID) บน SharePoint เพื่อสกัดการทำงานที่ซ้ำซ้อน ไม่ว่าจะเป็นการแจ้งเตือนหรือการสรุปผลซ้ำในวันเดียวกัน

### 7.4 Transport Security

- **การบังคับใช้ HTTPS:** บังคับการส่งผ่านข้อมูลด้วยโปรโตคอล HTTPS (TLS 1.2+) ทุก Endpoint
- **HTTP Headers:** มีการเพิ่ม HSTS (Strict-Transport-Security), X-Frame-Options: DENY เพื่อกัน clickjacking, Content-Security-Policy (CSP) และ X-Content-Type-Options: nosniff

### 7.5 Audit & Compliance

- **บันทึกประวัติละเอียด:** ทุกความเคลื่อนไหวผ่านแดชบอร์ดจะบันทึกลง SharePoint List (มี Columns ครอบคลุมถึง 17 มิติ เช่น PR_ID, Action, User, Repository, Result, Reason, Target_Branch, Build_Status, Policy_Status, Last_Checked_At ฯลฯ)
- **Log Retention Policy:** มีระบบ archive ข้อมูล log ใน SharePoint List ที่มีอายุเกิน 365 วัน ออกมาเป็นไฟล์ CSV (UTF-8 BOM เพื่อรองรับการเปิดใน Excel) เก็บลงใน SharePoint Document Library โฟลเดอร์ `ADO AutoApprove Archive` แล้วล้างข้อมูล List เก่าเพื่อควบคุมความเร็วและความจุในการคิวรี

---

## 🎓 8. หลักการออกแบบที่ใช้

### 8.1 Architectural Patterns

- **Serverless Architecture:** ทำงานแบบไม่มี Server ถาวร ลดค่าใช้จ่ายในการบำรุงรักษาและการ patching ระบบปฏิบัติการ
- **Stateless API:** Backend Functions ไม่มีการเก็บสถานะ (State) แต่ใช้ประโยชน์จากความน่าเชื่อถือของ SharePoint List และ Azure DevOps ในการดึงสถานะและยืนยันข้อมูลเรียลไทม์

### 8.2 Code Practices

- **Defensive Programming:** การเช็ค validate input ทุกมิติและดักจับข้อผิดพลาด (try-catch) ของภายนอกทุกขั้นตอน พร้อมตอบกลับปลายทางด้วยข้อมูลที่ชัดเจน (Explicit error message)
- **Single Responsibility Principle (SRP):** มีการแยกโค้ด Backend ย่อยแยกโมดูลอย่างชัดเจน เช่น โมดูลคุยกับ ADO ([ado-client.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/ado-client.js)), SharePoint ([sharepoint-client.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/sharepoint-client.js)), และ Teams ([teams-notifier.js](file:///d:/Github/ado-auto-approve/ado-auto-approve/api/shared/teams-notifier.js))

### 8.3 Security Principles

- **Least Privilege:** จำกัดสิทธิ์ของ API token และ PAT ให้ต่ำที่สุดเท่าที่ฟังก์ชันจำเป็นต้องใช้
- **Fail Closed:** หากการประมวลผลหรือสิทธิ์การเข้าถึงเกิดความขัดข้อง ระบบจะปฏิเสธคำขอและปิดกั้นการดำเนินการ (Fail Closed) แทนการละเว้นความปลอดภัย

---

## 📚 9. References & Documentation

### Microsoft Docs

- Azure Static Web Apps: <https://learn.microsoft.com/azure/static-web-apps>
- Azure Functions Node.js Reference: <https://learn.microsoft.com/azure/azure-functions/functions-reference-node>
- Microsoft Graph API v1.0 Docs: <https://learn.microsoft.com/graph>
- SharePoint List resources: <https://learn.microsoft.com/graph/api/resources/list>
- Microsoft Entra ID Client Credentials Flow: <https://learn.microsoft.com/azure/active-directory/develop/v2-oauth2-client-creds-grant-flow>

### Azure DevOps Docs

- Azure DevOps REST API Reference: <https://learn.microsoft.com/rest/api/azure/devops>
- Git Pull Requests API: <https://learn.microsoft.com/rest/api/azure/devops/git/pull-requests>
- Release Management API Reference: <https://learn.microsoft.com/rest/api/azure/devops/release>
- Personal Access Tokens (PAT) Guide: <https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate>

---

## 📈 10. สถานะปัจจุบัน & แผนถัดไป

### ✅ สถานะการทำงานที่พัฒนาเสร็จสิ้นแล้ว

- **Phase 1:** ติดตั้ง Azure Static Web Apps + SSO ด้วย Microsoft Entra ID
- **Phase 2:** สร้างกลไกดึงข้อมูล (Polling Active PR Queue) และคัดกรองตาม target branch/reviewer group
- **Phase 3:** พัฒนาระบบ Manual Approve / Reject PR ผ่านหน้าเว็บ พร้อมระบบบันทึก Log ลง SharePoint List และส่ง Comment ลงใน PR
- **Extension Phase (ส่วนต่อขยาย):**
  - **หน้าแดชบอร์ดและหน้าย่อย:** เพิ่มหน้า Activity (ประวัติ 24 ชั่วโมง), Merge Lookup (จับคู่และค้นหา CI/CD target branch จากไฟล์ CSV Mapping ~2,891 รายการ), Audit Logs (ระบบค้นหา log SharePoint) และหน้า System Health
  - **การอนุมัติ Release:** ระบบ Approve Classic Release (pre-deploy) โดยตรงผ่านหน้าเว็บ พร้อม Guardrails ป้องกัน
  - **การสแกนและสรุปรายงาน:** ตั้งเวลาทริกเกอร์ exception scan เมื่อ build/policy ล้มเหลว และระบบ Daily summary ส่งหา Teams รายวันตอน 18:00
  - **ระบบล้างและจัดเก็บข้อมูล:** ฟังก์ชัน Log Retention Cleanup สแกนเก็บ CSV และลบ log เก่าเกิน 365 วันอัตโนมัติ

### 🔜 แผนพัฒนาเพิ่มเติมในอนาคต (Roadmap)

- **การปรับปรุง UI/UX ให้ดียิ่งขึ้น:** พัฒนาการแสดงผลแดชบอร์ดให้มีความรวดเร็วและรองรับ responsive ได้สมบูรณ์แบบมากยิ่งขึ้น
- **รองรับกลุ่มผู้อนุมัติเพิ่มเติม (Multi-Reviewer Group):** ขยายฟังก์ชันการตรวจสอบให้รองรับกลุ่ม reviewer นอกเหนือจากกลุ่ม IT Support Approve เมื่อมีการขยายขอบเขตงานในอนาคต

---

## 📝 11. สรุปจุดเด่นของระบบ

| มิติความคุ้มค่า | รายละเอียดจุดเด่น |
| --- | --- |
| **ค่าใช้จ่าย** | 0.00 บาท/เดือน ถาวร โดยเลือกใช้ Microsoft Free Tier + Consumption Plan |
| **ความปลอดภัย** | เข้าระบบด้วย SSO, ตรวจสอบบทบาทด้วย RBAC, ป้องกัน Branch target Lock, ไม่แตะต้อง Worklist |
| **การเก็บ Log** | มีการบันทึกประวัติละเอียด 17 มิติลง SharePoint และควบคุมพื้นที่ด้วยระบบ Retention Archive |
| **ความสะดวกรวดเร็ว** | ดูภาพรวม PR, Build, Policy, และ Release จบได้ในหน้าแดชบอร์ดเดียว พร้อมอนุมัติผ่านเว็บได้ทันที |
| **การแจ้งเตือน** | Teams Notification อัจฉริยะ คัดกรองเอาเฉพาะข้อมูล Exception alerts ป้องกัน noise รบกวน |
| **การพัฒนาและปรับใช้** | พัฒนาสถาปัตยกรรม Serverless อัปเดตผ่าน GitHub CI/CD deployed ภายใน 2 นาที |

---

**จัดทำเอกสารโดย:** ADO Auto-Approve Project Team
**วันที่:** 12 มิถุนายน 2026
**Repository:** <https://github.com/birdzee4-cmd/ado-auto-approve>
