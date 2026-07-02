# 📘 คู่มือ Deploy ฉบับสมบูรณ์ — Phase 1

คู่มือนี้สำหรับคนที่ **ไม่เคยใช้ Azure / GitHub มาก่อน** ทำตามทีละขั้น
จบแล้วจะได้เว็บไซต์ Login ด้วย O365 ที่เข้าใช้งานได้จาก URL ของจริง

**ใช้เวลาทั้งหมด:** ประมาณ 30-45 นาที (สำหรับครั้งแรก)

> หมายเหตุสถานะ production ปัจจุบัน: ระบบใช้งานมากกว่า Phase 1 แล้ว โดยมี App Service Portal เพิ่มเติมบน URL เดิม และใช้ Azure Function App แยกชื่อ `func-ado-auto-approve-appservice-api` สำหรับ App Service Portal API. Function App นี้ใช้ Managed Identity + Azure Resource Graph เพื่อ list `stg-*` App Services ทั้ง subscription เมื่อ `APP_SERVICE_RESOURCE_GROUP=ALL`. รายละเอียดปัจจุบันให้อ้างอิง `README.md`, `docs/app-service-portal-runbook.md`, และ `docs/function-app-api-migration-plan.md`.

---

## ✅ ก่อนเริ่ม — สิ่งที่ต้องมี

| รายการ | ตรวจสอบยังไง |
|---|---|
| ☑️ Azure Subscription | เปิด https://portal.azure.com ได้ + เห็นชื่อ subscription |
| ☑️ GitHub Account | เปิด https://github.com ได้ |
| ☑️ M365 Admin permission | สามารถสร้าง App Registration ใน Entra ID (ถ้าไม่ใช่ admin ต้องขอ IT) |
| ☑️ Browser (Chrome/Edge) | สำหรับทำตามคู่มือ |

---

# ขั้นตอนที่ 1: Upload โค้ดเข้า GitHub (5 นาที)

## 1.1 สร้าง GitHub Repository ใหม่

1. เข้า https://github.com แล้ว login
2. คลิกปุ่ม **"+"** มุมขวาบน → เลือก **"New repository"**
3. ตั้งชื่อ repo เช่น `ado-auto-approve` (จะเปลี่ยนภายหลังก็ได้)
4. เลือก **Private** (สำคัญ! เพราะเป็นโค้ดภายในองค์กร)
5. **อย่า** ติ๊ก "Add a README file" / "Add .gitignore" (เพราะเราจะ upload เอง)
6. คลิก **"Create repository"**

## 1.2 Upload โค้ดเข้า Repo

1. ในหน้า repo ที่เพิ่งสร้าง คลิก **"uploading an existing file"** (อยู่ในข้อความ "Quick setup")
2. เปิด File Explorer ไปที่โฟลเดอร์ `ado-auto-approve/` ที่ผมเตรียมให้
3. **เลือกทุกไฟล์ + ทุกโฟลเดอร์ข้างใน** (Ctrl+A)
4. **ลาก** เข้าไปในหน้าเว็บ GitHub (Drag & Drop)
5. รอจนเห็นไฟล์ทั้งหมดอยู่ในรายการ
6. ในช่อง "Commit changes":
   - Title: `Initial commit - Phase 1`
   - คลิก **"Commit changes"**

> ⚠️ **สำคัญ:** ต้อง upload โฟลเดอร์ `.github/workflows/` ด้วย ถ้า GitHub ไม่แสดง folder ที่ขึ้นต้นด้วย `.` ให้เปิดดูใน File Explorer แล้วเปิด "Show hidden files"

✅ **เสร็จขั้นที่ 1** — ตอนนี้โค้ดอยู่บน GitHub แล้ว

---

# ขั้นตอนที่ 2: Deploy Azure Static Web App (5 นาที)

## 2.1 เปิด Azure Portal

1. เข้า https://portal.azure.com แล้ว login ด้วย O365
2. ที่ Search Bar ด้านบน พิมพ์ `Static Web Apps` → คลิกที่ผลลัพธ์

## 2.2 สร้าง Static Web App

1. คลิก **"+ Create"** มุมซ้ายบน
2. กรอกข้อมูลตามนี้:

| Field | ค่าที่ใส่ |
|---|---|
| **Subscription** | เลือก subscription ของคุณ |
| **Resource Group** | คลิก "Create new" → ตั้งชื่อ `rg-ado-auto-approve` |
| **Name** | `ado-auto-approve` (จะเป็นส่วนหนึ่งของ URL) |
| **Plan type** | **Free** ← สำคัญมาก |
| **Region (Source)** | เลือก `East Asia` หรือ `Southeast Asia` |
| **Source** | **GitHub** |

3. คลิก **"Sign in with GitHub"** → อนุญาตการเข้าถึง
4. หลังจาก authen เสร็จ จะมี dropdown เพิ่มมา:

| Field | ค่าที่ใส่ |
|---|---|
| **Organization** | บัญชี GitHub ของคุณ |
| **Repository** | `ado-auto-approve` |
| **Branch** | `main` |
| **Build Presets** | **Custom** |
| **App location** | `/public` |
| **Api location** | `/api` |
| **Output location** | (เว้นว่าง) |

5. คลิก **"Review + create"** → **"Create"**
6. รอประมาณ 1-2 นาที จนเห็นข้อความ "Your deployment is complete"
7. คลิก **"Go to resource"**

## 2.3 ทดสอบเบื้องต้น

1. ในหน้า Static Web App ที่เพิ่งสร้าง ดู **URL** (ที่ขึ้นต้นว่า `https://xxxxx.azurestaticapps.net`)
2. คลิก URL นั้น
3. **ควรเห็นหน้า Login** ที่มีปุ่ม "Sign in with Microsoft 365"
   > ⚠️ ถ้ายังไม่เห็น รอ 2-3 นาทีให้ GitHub Action build เสร็จก่อน (เช็คได้ที่ tab "Actions" บน GitHub)
4. **อย่าเพิ่งคลิก Login** เพราะยังต้องตั้ง Entra ID ใน ขั้นตอนที่ 3 ก่อน

✅ **เสร็จขั้นที่ 2** — เว็บออนไลน์แล้ว เหลือแค่ตั้ง O365 Login

> สำหรับ production ที่ต้องใช้ App Service Portal และ role/auth ขั้นสูง ปัจจุบัน Static Web App ใช้ SKU `Standard` และ App Service Portal backend ใช้ Function App แยก. คู่มือ Phase 1 นี้ยังใช้ได้สำหรับการตั้งต้นเว็บ/SSO แต่ไม่ครอบคลุมการตั้งค่า Function App, Managed Identity, RBAC และ SharePoint List `App Service Portal Log`.

---

# ขั้นตอนที่ 3: Register Entra ID App (15 นาที)

ขั้นตอนนี้คือการสร้าง "ตัวแทน" ของเว็บไซต์เราใน Microsoft 365
เพื่อให้ M365 รู้จักและยอมรับ login

## 3.1 เปิด Microsoft Entra ID

1. กลับไปที่ https://portal.azure.com
2. Search bar พิมพ์ `Microsoft Entra ID` → คลิก
3. ในเมนูซ้าย คลิก **"App registrations"**
4. คลิก **"+ New registration"**

## 3.2 สร้าง App Registration

กรอกข้อมูล:

| Field | ค่าที่ใส่ |
|---|---|
| **Name** | `ADO Auto-Approve - Web App` |
| **Supported account types** | **Accounts in this organizational directory only (Single tenant)** ← สำคัญ! |
| **Redirect URI - Platform** | **Web** |
| **Redirect URI - URL** | `https://<your-swa-url>/.auth/login/aad/callback` <br/> *(แทนที่ `<your-swa-url>` ด้วย URL จากขั้นตอน 2.3)* |

ตัวอย่าง Redirect URI:
```
https://ado-auto-approve-xxxxx.azurestaticapps.net/.auth/login/aad/callback
```

คลิก **"Register"**

## 3.3 จดค่าสำคัญ 3 ตัว

หลังจาก register เสร็จ จะเข้าหน้า Overview ของ app **จดค่าต่อไปนี้ไว้**:

1. **Application (client) ID** — คลิกปุ่ม copy ข้างค่า แล้วเก็บไว้
2. **Directory (tenant) ID** — คลิกปุ่ม copy แล้วเก็บไว้

ทั้งสองค่าเป็นรหัสประมาณ `12345678-abcd-1234-abcd-123456789012`

## 3.4 สร้าง Client Secret

1. ในเมนูซ้ายของหน้า App คลิก **"Certificates & secrets"**
2. แท็บ "Client secrets" → คลิก **"+ New client secret"**
3. กรอก:
   - Description: `ADO Auto-Approve Secret`
   - Expires: **24 months** (จะต้องสร้างใหม่ทุก 2 ปี)
4. คลิก **"Add"**
5. **คัดลอกค่าในคอลัมน์ "Value" ทันที** ← ค่านี้จะแสดงครั้งเดียว ถ้าปิดหน้าแล้วจะดูไม่ได้อีก
6. จดไว้เป็นค่าที่ 3: **Client Secret**

> 📅 ตั้ง reminder ใน calendar ก่อนหมดอายุ 14 วัน เพื่อสร้างใหม่

## 3.5 ตั้ง API Permissions

1. เมนูซ้าย คลิก **"API permissions"**
2. ค่า default `User.Read` มีอยู่แล้ว ไม่ต้องเปลี่ยน
3. คลิก **"Grant admin consent for [Your Org]"** → **"Yes"**
4. ตรวจดูว่าคอลัมน์ "Status" เป็นเครื่องหมายถูกสีเขียว ✅

## 3.6 (Optional) จำกัด User ที่ใช้งานได้

ถ้าต้องการให้เฉพาะบางคนใช้ได้ ไม่ใช่ทุกคนในองค์กร:

1. ไปที่ **Microsoft Entra ID** → **Enterprise applications**
2. ค้นหาชื่อ app `ADO Auto-Approve - Web App` → คลิก
3. เมนูซ้าย → **Properties**
4. เปลี่ยน **"Assignment required?"** เป็น **Yes** → **Save**
5. เมนูซ้าย → **Users and groups** → **+ Add user/group**
6. เพิ่ม user หรือ group ที่อนุญาตให้ใช้

✅ **เสร็จขั้นที่ 3** — ตอนนี้มี 3 ค่าที่ต้องใช้ในขั้นตอนถัดไป

---

# ขั้นตอนที่ 4: เชื่อม Config + ทดสอบ (5 นาที)

## 4.1 ใส่ค่า Tenant ID ในโค้ด

1. กลับไปที่ GitHub repo ของคุณ
2. เปิดไฟล์ `public/staticwebapp.config.json` → คลิกไอคอนดินสอ (Edit)
3. หาบรรทัด:
   ```json
   "openIdIssuer": "https://login.microsoftonline.com/__AAD_TENANT_ID__/v2.0",
   ```
4. แทนที่ `__AAD_TENANT_ID__` ด้วย **Directory (tenant) ID** จากขั้นตอน 3.3
5. ตัวอย่างหลังแก้:
   ```json
   "openIdIssuer": "https://login.microsoftonline.com/12345678-abcd-1234-abcd-123456789012/v2.0",
   ```
6. เลื่อนลงล่าง → "Commit changes" → คลิกปุ่ม **"Commit changes"**

## 4.2 ใส่ Client ID + Client Secret ใน Azure

1. กลับไปที่ Azure Portal → Static Web App ของคุณ
2. เมนูซ้าย คลิก **"Configuration"**
3. คลิก **"+ Add"** เพิ่ม environment variable 2 ตัว:

| Name | Value |
|---|---|
| `AAD_CLIENT_ID` | **Application (client) ID** จากขั้นตอน 3.3 |
| `AAD_CLIENT_SECRET` | **Client Secret Value** จากขั้นตอน 3.4 |

4. คลิก **"Save"** ทุกครั้งหลังเพิ่มแต่ละตัว

## 4.3 รอ Auto-Deploy + ทดสอบ Login

1. กลับไปที่ GitHub repo → tab **"Actions"**
2. ดูว่ามี workflow กำลังรันอยู่ (เพราะเราเพิ่ง commit) → รอจนเขียว ✅ (~2 นาที)
3. เปิด URL ของ Static Web App
4. คลิก **"Sign in with Microsoft 365"**
5. เด้งไปหน้า Microsoft → ใส่ O365 ของคุณ → อนุญาต (ครั้งแรกเท่านั้น)
6. **ถ้าทุกอย่างถูกต้อง:** จะเด้งกลับมาที่หน้า Dashboard เห็นชื่อตัวเอง ✅

🎉 **เสร็จ Phase 1!** เว็บใช้ได้แล้ว Login ผ่าน O365 จริง

---

# 🔧 Troubleshooting

## ❌ "AADSTS50011: Reply URL specified in request..."
- Redirect URI ใน App Registration ไม่ตรง
- กลับไปขั้นตอน 3.2 → แก้ Redirect URI ให้ตรงกับ URL ของ Static Web App **เป๊ะๆ**

## ❌ "We couldn't sign you in" / "Tenant ID invalid"
- Tenant ID ใน `public/staticwebapp.config.json` ผิด
- กลับไปขั้นตอน 4.1 → ตรวจสอบค่า

## ❌ หน้าเว็บแสดงเป็น "404"
- GitHub Action ยังรันไม่เสร็จ — เช็คที่ tab Actions
- หรือ `app_location` ใน `.github/workflows/azure-static-web-apps.yml` ผิด (ต้องเป็น `/public`)

## ❌ Login สำเร็จแต่กลับมาเห็นหน้าว่าง / Error 401
- `AAD_CLIENT_SECRET` ใน Configuration ผิดหรือหมดอายุ
- กลับไปขั้นตอน 3.4 สร้าง Secret ใหม่ → อัปเดตใน Configuration

## ❌ "Forbidden" หลัง Login
- บัญชี O365 ของคุณยังไม่ได้รับสิทธิ์ (ถ้าตั้ง Assignment required = Yes)
- กลับไปขั้นตอน 3.6 → เพิ่มชื่อตัวเองในรายการ user

---

# 🔐 Security Checklist (สำคัญ!)

หลัง deploy เสร็จแล้ว ตรวจสอบสิ่งเหล่านี้:

- [ ] GitHub repo ตั้งเป็น **Private**
- [ ] Static Web App Plan = **Free** (ไม่ใช่ Standard ที่เสียเงิน)
- [ ] Client Secret มี calendar reminder ก่อนหมดอายุ
- [ ] ลองทดสอบเปิด URL ใน Incognito → ต้องเห็นหน้า login (ไม่ใช่ dashboard ตรงๆ)
- [ ] ลองทดสอบเรียก `/api/userinfo` โดยไม่ login → ต้อง redirect ไป login
- [ ] เปิด Application Insights เพื่อดู log (อยู่ในเมนูซ้ายของ Static Web App)

---

# 📊 Free Tier Quota — ระวังไม่ให้เกิน

| Resource | Limit | ใช้ได้ประมาณ |
|---|---|---|
| Static Web Apps Bandwidth | 100 GB/เดือน | เกินกว่า 10,000 user/วัน |
| Azure Functions | 1M execution/เดือน | ~33,000 call/วัน |
| Application Insights | 5 GB/เดือน | ปกติใช้ไม่ถึง |

สำหรับโปรเจกต์นี้ workload ต่ำ — ไม่ทะลุ free tier แน่นอน

---

# 🎯 ขั้นตอนถัดไป

หลัง Phase 1 ใช้งานได้แล้ว มา Phase 2 ต่อ:
- เชื่อม ADO Webhook
- ทดสอบรับ payload ของ PR
- ส่งข้อความเข้า Microsoft Teams

แค่บอกผมเมื่อ Phase 1 ทำงานเรียบร้อย ผมจะเตรียม Phase 2 ให้ครับ
