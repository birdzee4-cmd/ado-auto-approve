# 📘 คู่มือ Phase 2 — Webhook + Teams Notification

ต่อจาก Phase 1 ที่ Login O365 ใช้ได้แล้ว Phase 2 จะเพิ่ม:

- รับ Webhook จาก Azure DevOps เมื่อมี PR ใน Staging branch
- ส่ง Adaptive Card แจ้งเตือนเข้า Microsoft Teams channel
- ปุ่ม "Test Teams" บน Dashboard เพื่อทดสอบ
- (ยังไม่ Auto-Approve — รอ Phase 3)

**ใช้เวลา:** ประมาณ 20-30 นาที

---

## 🗂️ สิ่งที่เปลี่ยนแปลงในรอบนี้

### ไฟล์ใหม่ (5 ไฟล์)
```
api/shared/teams-notifier.js           ← โมดูลส่งข้อความเข้า Teams
api/webhook/function.json
api/webhook/index.js                   ← รับ ADO webhook
api/test-notification/function.json
api/test-notification/index.js         ← endpoint ทดสอบ
PHASE2-GUIDE-TH.md                     ← ไฟล์นี้
```

### ไฟล์ที่ถูกแก้ (4 ไฟล์)
```
public/dashboard.html                  ← เพิ่มปุ่ม Test + Webhook URL section
public/app.js                          ← logic ของปุ่มใหม่
public/styles.css                      ← สไตล์ส่วนใหม่
staticwebapp.config.json               ← เพิ่ม route /api/webhook + /api/test-notification
```

---

# ขั้นตอน Deploy Phase 2

## ขั้นตอน 1: Update โค้ดใน GitHub (5 นาที)

### วิธีที่ง่ายที่สุด: Upload ทั้งโฟลเดอร์ใหม่

1. เข้า GitHub repo `ado-auto-approve` ของคุณ
2. คลิก **"Add file"** → **"Upload files"**
3. ลากโฟลเดอร์ `ado-auto-approve` (ทั้งหมด) จากชุดที่ผมส่งให้
4. ✅ ติ๊ก **"Replace existing files"**
5. ใส่ commit message: `Phase 2 - Webhook + Teams notification`
6. คลิก **"Commit changes"**

### ⚠️ ขั้นตอนสำคัญ — แก้ Tenant ID กลับเข้าไป

เพราะ upload ไฟล์ใหม่จะ**เขียนทับ** `staticwebapp.config.json` ที่คุณเคยใส่ Tenant ID ไว้ใน Phase 1 ดังนั้นต้องเอากลับเข้าไป:

1. ใน GitHub repo เปิดไฟล์ `staticwebapp.config.json`
2. คลิกไอคอนดินสอ (Edit)
3. หาบรรทัด:
   ```
   "openIdIssuer": "https://login.microsoftonline.com/__AAD_TENANT_ID__/v2.0",
   ```
4. แทนที่ `__AAD_TENANT_ID__` ด้วย **Directory (tenant) ID** ของคุณ (ค่าเดียวกับ Phase 1)
5. Commit changes

> 💡 ถ้าจำ Tenant ID ไม่ได้: เข้า Azure Portal → Microsoft Entra ID → Overview → คัดลอก Tenant ID

### ตรวจว่า GitHub Action รัน
1. ไป tab **"Actions"** ของ repo
2. ดูว่า workflow ใหม่กำลังรัน → รอจนเขียว ✅ (~2 นาที)
3. เปิดเว็บ login → ควรเห็น Dashboard ใหม่มี **ปุ่ม Test Teams** + ส่วน **Webhook URL**

---

## ขั้นตอน 2: ติดตั้ง Webhook Bot ใน Teams (10 นาที)

ใช้ **Webhook Bot** (third-party app) ที่ติดตั้งใน Teams channel เพื่อรับข้อความ
รูปแบบ payload ที่ระบบเราส่งคือ `{"text": "markdown content"}` ซึ่ง Webhook Bot รองรับ

### 2.1 ติดตั้ง Webhook Bot ใน Channel

1. เปิด Microsoft Teams → ไปที่ **channel** ที่ต้องการให้แจ้งเตือนเข้า
2. คลิกที่ **"+"** เพิ่ม tab/app → ค้นหา **"Webhook Bot"** (C-Toss)
3. กด **Add** → เลือก team/channel ที่ต้องการ → **Configure**
4. ตั้งชื่อ webhook เช่น `ADO Auto-Approve Bot`
5. **คัดลอก URL ที่แสดง** ← ค่านี้สำคัญที่สุด เก็บไว้สำหรับขั้นตอน 2.2
   - หน้าตาประมาณ: `https://webhookbot.c-toss.com/api/bot/webhooks/<uuid>`

> 💡 ถ้าทดสอบยิง API ได้ response แล้ว แปลว่า URL ใช้งานได้

### 2.2 ใส่ URL ลง Azure Configuration

1. เข้า Azure Portal → Static Web App ของคุณ
2. เมนูซ้าย คลิก **"Configuration"** → **"+ Add"**
3. เพิ่ม environment variable:
   - **Name**: `TEAMS_WEBHOOK_URL`
   - **Value**: (วาง URL ที่ copy มา)
4. คลิก **"OK"** → **"Save"** ด้านบน

> 💡 ทางเลือกอื่น: ถ้าองค์กรไม่อนุญาตให้ติดตั้ง C-Toss สามารถใช้ Power Automate Workflows หรือ Incoming Webhook connector ของ Microsoft ได้เช่นกัน เพียงปรับ payload format ใน `api/shared/teams-notifier.js` ให้ตรงกับที่ provider ต้องการ

---

## ขั้นตอน 3: ทดสอบ Teams Notification (1 นาที)

1. กลับมาที่เว็บ Dashboard
2. คลิกปุ่ม **"💬 ทดสอบส่งข้อความเข้า Teams"**
3. ควรเห็นข้อความสีเขียว: **✅ ส่งสำเร็จ!**
4. เปิด Teams channel ที่ตั้งไว้ → ต้องเห็นข้อความ markdown "✅ Test Notification" พร้อมตาราง

### 🔧 ถ้าไม่สำเร็จ
- **"TEAMS_WEBHOOK_URL is not configured"** → กลับขั้นตอน 2.2 ตรวจชื่อ env var
- **"Teams returned 4xx/5xx"** → URL ที่ copy มาผิด/หมดอายุ ทำขั้นตอน 2.1 ใหม่
- **"timeout"** → Webhook Bot ไม่ตอบ ตรวจสอบใน Teams ว่ายังติดตั้งอยู่

---

## ขั้นตอน 4: ตั้ง Basic Auth สำหรับ Webhook (3 นาที)

เพื่อกัน webhook endpoint ถูกเรียกโดยคนอื่น เราตั้งให้ ADO ส่ง username/password มาก่อน

1. เข้า Azure Portal → Static Web App → **Configuration**
2. เพิ่ม environment variables 2 ตัว:

| Name | Value (ตัวอย่าง) |
|---|---|
| `WEBHOOK_USERNAME` | `ado-bot` (ตั้งอะไรก็ได้) |
| `WEBHOOK_PASSWORD` | สุ่มสตริงยาวๆ เช่น `Xk9pL2mQ7rT4vB8nW3jH5fG6yD1cZ0sA` |

> 💡 วิธีสร้าง password สุ่ม: Search ใน Google ว่า "password generator" หรือเปิด PowerShell แล้ว run:
> ```
> -join ((33..126) | Get-Random -Count 32 | ForEach-Object {[char]$_})
> ```

3. (Optional) เพิ่ม env var เพื่อ override ชื่อ Staging branch ถ้าของคุณไม่ใช่ `staging`:

| Name | Value |
|---|---|
| `STAGING_BRANCH_REF` | `refs/heads/staging` (default) — เปลี่ยนเป็น `refs/heads/release` ฯลฯ ถ้าต่าง |

4. **Save** ทั้งหมด

---

## ขั้นตอน 5: ตั้ง ADO Service Hook (10 นาที)

ขั้นนี้คือบอก ADO ว่า "เวลามี PR อะไรเกิดขึ้นใน Staging ส่งมาบอกระบบเรา"

### 5.1 เข้า Service Hooks

1. เข้า Azure DevOps ของคุณ
2. เลือก **Project** ที่ต้องการ
3. มุมซ้ายล่าง คลิก **"Project settings"** (รูปเฟือง)
4. หาเมนู **"Service hooks"** → คลิก
5. คลิก **"+ Create subscription"** (มุมขวาบน หรือกลางหน้า)

### 5.2 เลือก Webhook Type

1. ในรายการ services เลือก **"Web Hooks"** → **"Next"**

### 5.3 ตั้ง Trigger (Event ที่ 1: PR Created)

| Field | ค่าที่ใส่ |
|---|---|
| **Trigger on this type of event** | **Pull request created** |
| **Repository** | (เลือก repo ที่ต้องการ — หรือเว้นว่างเพื่อใช้ทุก repo) |
| **Branch** | `refs/heads/staging` (พิมพ์เอง ไม่ต้องเลือก dropdown) |
| **Pull request reviewer vote** | Any |
| **Created by group** | Any |

คลิก **"Next"**

### 5.4 ตั้ง Action (URL ที่ส่งไปหา)

| Field | ค่าที่ใส่ |
|---|---|
| **URL** | `https://<your-swa-url>/api/webhook` (ดูจาก Dashboard ของเว็บ) |
| **Basic authentication username** | `ado-bot` (ตามที่ตั้งไว้ใน WEBHOOK_USERNAME) |
| **Basic authentication password** | (วาง WEBHOOK_PASSWORD) |
| **HTTP headers** | (เว้นว่าง) |
| **Resource details to send** | All |
| **Messages to send** | None |
| **Detailed messages to send** | None |

คลิก **"Test"** → ควรเห็น **"Notification sent successfully"** + HTTP 200

> ⚠️ ถ้า test ขึ้น 401 → username/password ใน ADO ไม่ตรงกับ env vars ใน Azure
> ⚠️ ถ้า test ขึ้น 502 → TEAMS_WEBHOOK_URL ไม่ถูกต้อง

คลิก **"Finish"**

### 5.5 ทำซ้ำสำหรับ Event "Pull request updated"

ทำขั้นตอน 5.1 ถึง 5.4 อีกครั้ง แต่เปลี่ยน Trigger เป็น **"Pull request updated"**

---

## ขั้นตอน 6: ทดสอบจริงจาก ADO (1 นาที)

1. ไปที่ ADO → repo ที่ตั้ง webhook ไว้
2. สร้าง branch ทดสอบ เช่น `test-phase2`
3. แก้ไฟล์อะไรก็ได้ → commit → push
4. สร้าง **Pull Request** จาก `test-phase2` → `staging`
5. รอ 2-3 วินาที → ✅ เห็นการ์ด "🔔 New PR Detected on Staging" เด้งเข้า Teams channel
6. **Close PR ทิ้งโดยไม่ merge** เพราะ Phase 2 ยังไม่ approve อะไร

🎉 **Phase 2 เสร็จ!**

---

# 🔧 Troubleshooting

## ❌ Teams ไม่ได้รับข้อความ
1. ทดสอบด้วยปุ่ม "Test Teams" บน Dashboard ก่อน — ถ้าตรงนี้ไม่ผ่าน แสดงว่า TEAMS_WEBHOOK_URL ผิด
2. ตรวจว่า Webhook Bot ยังติดตั้งอยู่ใน Teams channel
3. ลองทดสอบยิง URL จาก Postman ด้วย payload `{"text": "test"}` ดูว่าได้ response 200
4. ดู log ใน Azure Portal → Static Web App → Application Insights → Live Metrics

## ❌ ADO Service Hook test ขึ้น 401
- WEBHOOK_USERNAME / WEBHOOK_PASSWORD ใน Azure Configuration ไม่ตรงกับใน ADO
- ตรวจว่ามี space เกิน / spacing ผิด

## ❌ ADO Service Hook test ขึ้น 200 แต่ Teams ไม่เด้ง
- Filter ในขั้น 5.3 ไม่ตรง (branch ไม่ใช่ refs/heads/staging)
- ดู log ใน Application Insights ว่ามี "Ignored" reason อะไร

## ❌ สร้าง PR แล้ว Teams ไม่เด้ง (แต่ test ผ่านหมด)
- Target branch ของ PR ไม่ใช่ Staging
- ADO Service Hook อาจตั้ง filter branch ไม่ตรง
- ตรวจ env var `STAGING_BRANCH_REF` ใน Azure

## ❌ Webhook ตอบช้า (timeout)
- Cold start ของ Azure Functions ครั้งแรกใช้เวลา 2-5 วินาที — ปกติ
- ครั้งต่อๆ ไปจะเร็วขึ้นเอง

---

# 📊 ตรวจสุขภาพระบบหลัง Deploy

ลองทดสอบทุกข้อต่อไปนี้:

- [ ] เปิดเว็บ → Login → เห็น Dashboard ใหม่ (มีปุ่ม Test Teams)
- [ ] กดปุ่ม "Test Teams" → เห็นการ์ดใน Teams
- [ ] กดปุ่ม "Test Health" → เห็นข้อความ Healthy
- [ ] URL `/api/webhook` แสดงในกล่อง Webhook URL Section
- [ ] ADO Service Hook test = ✅ Notification sent successfully
- [ ] สร้าง PR test → เห็น Teams notify
- [ ] PR ที่ merge เข้า branch อื่น (ไม่ใช่ staging) → **ไม่** ส่ง Teams

---

# 🎯 Phase 3 ต่อไป

เมื่อ Phase 2 ทำงานเรียบร้อย ขั้นถัดไปจะเพิ่ม:
- **Validation logic** (เช็ก Merge conflict + Build status ผ่านมั้ย)
- **Auto-Approve API call** (ส่งคำสั่งให้ ADO ว่า approved แล้ว)
- **Set Auto-Complete** (ให้ ADO merge เอง โดย transitionWorkItems = false — ไม่แตะ Worklist)
- **State machine** เก็บใน Cosmos DB (free tier)
- **Lock + Debouncing** กัน race condition

แค่บอกผมเมื่อ Phase 2 ทำงานได้ ผมจะเตรียม Phase 3 ให้ครับ
                                                                                                                                                                                                                                                                                   