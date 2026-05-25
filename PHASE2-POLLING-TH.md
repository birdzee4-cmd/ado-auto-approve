# 📘 Phase 2 (Polling Mode) — ดึง PR ด้วย PAT

แทนการใช้ Webhook (ที่ต้องตั้ง Service Hook ใน ADO) เราใช้ **Polling** คือให้เว็บของเรา "ดึง" ข้อมูล PR จาก ADO ผ่าน REST API + PAT แทน

**ผลลัพธ์:** มีปุ่ม **"Check Now"** บน Dashboard กดแล้วเห็นรายการ Active PR ใน Staging ทันที

**ใช้เวลา:** ประมาณ 15-20 นาที

---

## ✅ ก่อนเริ่ม

- [ ] Phase 1 deploy ขึ้นไปแล้ว Login O365 ได้
- [ ] ADO Project ที่คุณมีสิทธิ์เข้า
- [ ] สร้าง PAT ได้เอง (ไม่ต้อง Admin)

---

# ขั้นตอนที่ 1: สร้าง Personal Access Token (5 นาที)

## 1.1 เข้าหน้าสร้าง PAT

1. เข้า Azure DevOps ของคุณ (https://dev.azure.com/...)
2. มุมขวาบน คลิก **รูปคน** (User Settings)
3. เลือก **"Personal access tokens"**
4. คลิก **"+ New Token"**

## 1.2 ตั้งค่า PAT

| Field | ค่าที่ใส่ |
|---|---|
| **Name** | `ADO Auto-Approve Bot` |
| **Organization** | เลือก organization ของคุณ |
| **Expiration** | **90 days** (จะต้องสร้างใหม่ทุก 3 เดือน) |
| **Scopes** | เลือก **"Custom defined"** |

ใน Custom defined scopes ติ๊ก:
- ✅ **Code** → **Read** (สำหรับ Phase 2 พอ)

> 💡 Phase 3 จะต้องเพิ่ม **Code → Read & Write** เพื่อกด Approve เราจะกลับมาแก้ภายหลัง

## 1.3 คัดลอก Token

1. คลิก **"Create"**
2. ⚠️ **คัดลอก token ที่แสดงทันที** — ปิดหน้าแล้วจะดูไม่ได้อีก
3. เก็บไว้ใน Notepad ชั่วคราว (ลบทิ้งหลังเสร็จ)

หน้าตา token: รหัสยาวๆ เช่น `abc123def456...xyz789` (ประมาณ 52 ตัวอักษร)

---

# ขั้นตอนที่ 2: หา Organization และ Project Name (2 นาที)

1. เปิด URL ของ project ใน ADO เช่น:
   ```
   https://dev.azure.com/mycompany/MyProject/_git/repo1
                          └────┬────┘ └───┬────┘
                          Organization  Project
   ```
2. จด **Organization** = `mycompany`
3. จด **Project** = `MyProject`

> ⚠️ ใส่ให้ตรง case-sensitive (พิมพ์เล็ก/ใหญ่ต้องตรงเป๊ะ)

---

# ขั้นตอนที่ 3: Update โค้ดใน GitHub + Deploy (5 นาที)

## 3.1 Upload ไฟล์ใหม่

1. Download **ado-auto-approve-phase2.zip** (มี folder `api/list-prs/` ใหม่)
2. เข้า GitHub repo ของคุณ
3. **Add file → Upload files** → ลากโฟลเดอร์ใหม่เข้าไป → ✅ Replace existing files
4. Commit: `Phase 2 - Polling mode`

## 3.2 ตรวจ Tenant ID (ระวัง!)

เพราะ upload จะเขียนทับ `staticwebapp.config.json` ที่มี Tenant ID ของคุณอยู่:

1. เปิดไฟล์ `staticwebapp.config.json` ใน GitHub
2. ถ้าเห็น `__AAD_TENANT_ID__` ให้แทนด้วย Tenant ID ของคุณ (เหมือนใน Phase 1)
3. Commit

## 3.3 รอ Auto-deploy

1. GitHub tab **Actions** → ดูว่า workflow เขียว ✅ (~2 นาที)
2. เปิดเว็บ → login → ดู Dashboard ใหม่ ควรเห็น **section "📋 Active PRs in Staging"** มีปุ่ม "🔄 Check Now"

---

# ขั้นตอนที่ 4: ตั้ง Environment Variables (3 นาที)

1. Azure Portal → Static Web App ของคุณ
2. เมนูซ้าย คลิก **"Configuration"**
3. คลิก **"+ Add"** เพิ่ม 3 ตัว:

| Name | Value (ตัวอย่าง) |
|---|---|
| `ADO_ORGANIZATION` | `mycompany` (จากขั้นตอน 2) |
| `ADO_PROJECT` | `MyProject` (จากขั้นตอน 2) |
| `ADO_PAT` | (วาง PAT จากขั้นตอน 1.3) |

4. (Optional) ถ้า branch ของคุณไม่ใช่ `staging`:

| Name | Value |
|---|---|
| `ADO_TARGET_BRANCH` | `refs/heads/<your-branch>` |

5. คลิก **"Save"** ด้านบน

> ⚠️ หลัง Save Static Web App จะ restart sec ๆ ให้ทำงานใหม่

---

# ขั้นตอนที่ 5: ทดสอบ (1 นาที)

1. กลับมาที่ Dashboard
2. คลิกปุ่ม **"🔄 Check Now"**
3. ผลที่คาดหวัง:
   - ✅ ขึ้นข้อความ **"ดึงสำเร็จ: พบ X PR ใน ..."**
   - แสดง **ตาราง PR** พร้อมข้อมูล: PR ID, Title, Source→Target, Repo, Merge status, ลิงก์ Open

### 🔧 ถ้าผิดพลาด

จากข้อความที่ Dashboard แสดง:

| Error message | สาเหตุ | วิธีแก้ |
|---|---|---|
| `Missing environment variables` | env vars ยังไม่ครบ | กลับขั้นตอน 4 ใส่ให้ครบ + Save |
| `ADO API returned 401` | PAT ผิด/หมดอายุ | สร้าง PAT ใหม่ + อัปเดต ADO_PAT |
| `ADO API returned 404` | ORG/PROJECT สะกดผิด | ตรวจ ADO_ORGANIZATION + ADO_PROJECT |
| `ตอบกลับไม่ใช่ JSON (HTTP 302)` | Session login หมดอายุ | Refresh หน้านี้แล้วลองใหม่ |
| `Backend ตอบไม่ใช่ JSON` | Function ยัง deploy ไม่เสร็จ | รอ GitHub Action เขียวก่อน |

---

# 🎯 Phase 3 ที่จะมาต่อ

เมื่อ Phase 2 ทำงานได้ (ปุ่ม Check Now เห็น PR ได้ถูกต้อง) Phase 3 จะเพิ่ม:

1. **Timer trigger** — ดึงทุก 5 นาทีอัตโนมัติ (24/7)
2. **Validation logic** — เช็ก Build status + Merge conflict ก่อน approve
3. **Approve API call** — POST ไป ADO ให้ vote=10 (ต้องเพิ่ม PAT scope: Code Read & Write)
4. **Set Auto-Complete** — ให้ ADO merge เอง โดย `transitionWorkItems: false` (ไม่แตะ Worklist)
5. **Teams notification** — แจ้งผลเข้า C-Toss webhook ของคุณ (ที่ทดสอบยิงได้แล้ว)
6. **Skip ที่ approve ไปแล้ว** — กัน notify ซ้ำ

แค่บอกผมเมื่อ Phase 2 ทำงานเรียบร้อย — ปุ่ม Check Now เห็น PR ได้
ผมจะเตรียม Phase 3 ให้ครับ

---

# 🔐 Security Note

- PAT มีอายุ 90 วัน — ตั้ง calendar reminder 14 วันก่อนหมดอายุ
- PAT เก็บอยู่ใน Azure Configuration (encrypted) ไม่อยู่ในโค้ด
- ไม่ commit PAT ลง GitHub โดยเด็ดขาด
- Scope ของ PAT ตอนนี้คือ Code Read เท่านั้น (อ่านได้ ทำอะไรใน ADO ไม่ได้) ปลอดภัย
