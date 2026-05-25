# ADO Auto-Approve System — Phase 1

ระบบเว็บไซต์สำหรับ Automation Approve Pull Request บน Azure DevOps
รันบน **Azure Static Web Apps (Free Tier)** + **Microsoft Entra ID (O365 Login)**

---

## 🎯 Phase 1 ทำอะไรได้

- ✅ เว็บไซต์ที่เข้าถึงจากที่ไหนก็ได้ผ่าน URL
- ✅ Login ด้วย Microsoft 365 (Single Sign-On)
- ✅ จำกัดผู้ใช้เฉพาะคนในองค์กรเท่านั้น
- ✅ Backend API พร้อมใช้ (Azure Functions)
- ✅ HTTPS + Custom Domain ฟรี
- ⏭️ Phase 2-5 จะเพิ่ม ADO Webhook, Auto-Approve Logic, Dashboard, Daily Report

---

## 📁 โครงสร้างไฟล์

```
ado-auto-approve/
├── public/                         ← หน้าเว็บ (Frontend)
│   ├── index.html                  หน้า Login
│   ├── dashboard.html              หน้าหลังจาก Login
│   ├── 403.html                    หน้าไม่มีสิทธิ์
│   ├── styles.css                  สไตล์
│   └── app.js                      JavaScript
│
├── api/                            ← Backend (Azure Functions)
│   ├── host.json                   Config Azure Functions
│   ├── package.json                Node.js dependencies
│   ├── userinfo/                   GET /api/userinfo
│   │   ├── function.json
│   │   └── index.js
│   └── health/                     GET /api/health
│       ├── function.json
│       └── index.js
│
├── .github/workflows/              ← Auto-Deploy
│   └── azure-static-web-apps.yml
│
├── staticwebapp.config.json        ← Config Auth + Routes
├── .gitignore
└── README.md                       ← ไฟล์นี้
```

---

## 🚀 คู่มือ Deploy (ภาษาไทย)

ดูคู่มือฉบับเต็มที่มีรูปประกอบและเลขข้อชัดเจน:
**[DEPLOY-GUIDE-TH.md](./DEPLOY-GUIDE-TH.md)**

ภาพรวม 4 ขั้นตอน (ใช้เวลา ~30-45 นาที):
1. **Upload โค้ดเข้า GitHub** (5 นาที) — ลากไฟล์เข้าผ่านเว็บ ไม่ต้องใช้ git
2. **Deploy Azure Static Web App** (5 นาที) — กดปุ่มบน Portal
3. **Register Entra ID App** (15 นาที) — สำหรับ O365 Login
4. **เชื่อม Config + ทดสอบ** (5 นาที) — เปิดเว็บ login จริง

---

## 🔧 Technology Stack

| Component | Technology | Free Tier |
|---|---|---|
| Hosting | Azure Static Web Apps | 100 GB bandwidth/เดือน |
| Backend | Azure Functions (Node.js 18) | 1M executions/เดือน |
| Auth | Microsoft Entra ID (Azure AD) | รวมใน M365 |
| CI/CD | GitHub Actions | ฟรี |
| Monitoring | Application Insights | 5 GB log/เดือน |

**ค่าใช้จ่ายโดยรวม: 0 บาท/เดือน** (ภายใต้ Free Tier limits)

---

## ❓ ปัญหาที่พบบ่อย

ดูในไฟล์ [DEPLOY-GUIDE-TH.md](./DEPLOY-GUIDE-TH.md) หมวด "Troubleshooting"

---

## 📞 Support

- ปัญหาเรื่อง Code: Open issue ใน GitHub repo นี้
- ปัญหาเรื่อง Azure: docs.microsoft.com/azure/static-web-apps

---

## 📜 License

Internal use only — โปรเจกต์ภายในองค์กร
