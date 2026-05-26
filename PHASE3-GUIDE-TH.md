# 📘 Phase 3 — Manual Approve + Reject + SharePoint Log

ระบบ approve/reject PR ผ่านเว็บ พร้อม **confirm popup** ทุกครั้ง และเก็บ log ใน SharePoint List

## 🎯 ฟีเจอร์

- ✅ ดึง PR เฉพาะที่ group **"IT Support Approve"** เป็น reviewer (กรองอัตโนมัติ)
- ✅ ปุ่ม **Approve / Reject / View History / Open in ADO** แต่ละแถว
- ✅ Popup confirm ก่อนทุก action
- ✅ Bot vote ในนาม Service Account + Comment ใส่ชื่อ user
- ✅ Set Auto-Complete (merge ตาม policy) — **transitionWorkItems: false** ไม่แตะ Worklist
- ✅ Log ทุก action ลง SharePoint List

**ใช้เวลา setup:** ~30-45 นาที (เพราะต้องสร้าง SharePoint + Graph permission)

---

## ✅ ก่อนเริ่ม

- [ ] Phase 1 + Phase 2 ทำงานได้แล้ว
- [ ] ADO_PAT มี scope **Code: Read & Write** (พร้อมแล้ว)
- [ ] M365 license มี SharePoint Online (มาตรฐาน)
- [ ] สิทธิ์ Entra ID Admin (เพิ่ม Graph permission)

---

# ขั้นตอน 1: สร้าง SharePoint Site + List (15 นาที)

## 1.1 สร้าง Site ใหม่

1. เข้า https://www.office.com → กดไอคอน **SharePoint**
2. คลิก **+ Create site** (มุมขวาบน)
3. เลือก **Team site**
4. กรอก:
   - Site name: `ADO Auto-Approve`
   - Site description: `Log สำหรับระบบอนุมัติ PR อัตโนมัติ`
   - Group email: (auto-generate)
   - Privacy: **Private — only members** (แนะนำ)
   - Language: เลือกตามต้องการ
5. คลิก **Next** → ใส่ owner = ตัวคุณ → **Finish**

จะได้ URL ประมาณ:
```
https://<yourorg>.sharepoint.com/sites/ADO-Auto-Approve
```

**จดค่านี้ไว้:**
- `SHAREPOINT_HOSTNAME` = `<yourorg>.sharepoint.com`
- `SHAREPOINT_SITE_PATH` = `/sites/ADO-Auto-Approve`

## 1.2 สร้าง List ใน Site

1. ในหน้า site ที่เพิ่งสร้าง คลิก **+ New** → **List**
2. เลือก **Blank list**
3. ตั้งชื่อ: `  ` → **Create**

## 1.3 เพิ่ม Columns

ในหน้า List ที่สร้างใหม่:

| คอลัมน์ที่ต้องสร้าง | Type | ตั้งค่าเพิ่ม |
|---|---|---|
| `PR_ID` | Number | Required |
| `Action` | Single line of text | Required (Max 50) |
| `User` | Single line of text | Max 255 |
| `Repository` | Single line of text | Max 255 |
| `PR_Title` | Multiple lines of text | Plain text |
| `Target_Branch` | Single line of text | Max 255 |
| `Result` | Single line of text | Max 500 |
| `Reason` | Multiple lines of text | Plain text |

**วิธีเพิ่ม column:** คลิก **+ Add column** → เลือก type → ตั้งชื่อ → Save

> ⚠️ ชื่อ column ต้องตรงตามนี้เป๊ะ (case-sensitive) — ระบบใช้ชื่อ "internal name" ในการเขียน

> 💡 SharePoint จะมี column `Title` มาให้อยู่แล้ว ไม่ต้องลบ ระบบจะเขียน auto

---

# ขั้นตอน 2: เพิ่ม Microsoft Graph Permission (10 นาที)

## 2.1 เปิด App Registration

1. เข้า https://portal.azure.com → **Microsoft Entra ID** → **App registrations**
2. เปิด app ที่สร้างไว้ตอน Phase 1 (เช่น `ADO Auto-Approve - Web App`)

## 2.2 เพิ่ม API Permissions

1. เมนูซ้าย → **API permissions**
2. คลิก **+ Add a permission**
3. เลือก **Microsoft Graph**
4. เลือก **Application permissions** (ไม่ใช่ Delegated)
5. ค้นหา **Sites.ReadWrite.All** → ติ๊ก → **Add permissions**

## 2.3 Grant Admin Consent

1. ในหน้า API permissions ใหม่ คลิก **"Grant admin consent for [Your Org]"**
2. ยืนยัน **Yes**
3. รอจน status เป็น **✅ Granted**

> ⚠️ ถ้าปุ่มขึ้นว่า "Need admin" = คุณไม่มีสิทธิ์ ต้องขอ admin ทำให้

---

# ขั้นตอน 3: Upload โค้ดใหม่ + ตั้ง env vars (10 นาที)

## 3.1 Upload โค้ด

แตก ZIP `ado-auto-approve-phase3.zip` แล้ว upload ขึ้น GitHub ตามวิธีเดิม:
1. เข้าโฟลเดอร์ที่แตก
2. เลือกไฟล์ทั้งหมด**ภายใน** (Ctrl+A) ลากเข้า GitHub
3. ✅ Replace existing files → Commit
4. **อย่าลืม:** ใส่ Tenant ID กลับใน `staticwebapp.config.json` (ถ้าโดน reset)

## 3.2 ตั้ง Env Vars ใหม่ใน Azure

Azure Portal → Static Web App → **Configuration** → เพิ่ม:

| Name | Value |
|---|---|
| `REVIEWER_GROUP_NAME` | `IT Support Approve` |
| `SHAREPOINT_HOSTNAME` | `<yourorg>.sharepoint.com` |
| `SHAREPOINT_SITE_PATH` | `/sites/ADO-Auto-Approve` |
| `SHAREPOINT_LIST_NAME` | `ADO Auto-Approve Log` |

ที่เคยตั้งไว้ (จาก Phase 1-2) ยังต้องคงอยู่:
- `AAD_TENANT_ID` (จาก Phase 1)
- `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` (จาก Phase 1)
- `ADO_ORGANIZATION`, `ADO_PROJECT`, `ADO_PAT` (จาก Phase 2)

## 3.3 รอ Deploy

ไป Actions tab → รอ workflow เขียว ✅ (~2 นาที)

---

# ขั้นตอน 4: ทดสอบ (5 นาที)

## 4.1 เปิดเว็บ

หน้าเว็บใหม่จะเห็น:
- ตาราง PR ที่รออนุมัติ (filter ตาม reviewer group แล้ว)
- แต่ละแถวมี 4 ปุ่ม: **✅ Approve / ❌ Reject / 📜 History / 🔗 Open**

## 4.2 ทดสอบ Approve

1. หา PR ทดสอบใน ADO ที่:
   - Target = `staging`
   - มี group `IT Support Approve` เป็น reviewer
2. กดปุ่ม **✅ Approve** บนเว็บ
3. Popup confirm ขึ้น → กด **ยืนยัน**
4. ผลที่คาดหวัง:
   - Alert: "✅ Approve สำเร็จ!"
   - ใน ADO PR เห็น vote = 10 จาก Bot
   - ใน ADO PR เห็น comment "Approved by your.email@..."
   - ใน SharePoint List มี row ใหม่
   - ตาราง refresh — PR หายไป (ถ้า merge แล้ว)

## 4.3 ทดสอบ Reject

1. หา PR ทดสอบอีกใบ
2. กด **❌ Reject** → popup ใส่เหตุผล → **ยืนยัน**
3. ผลที่คาดหวังคล้ายกัน + comment ใน PR มีเหตุผล

## 4.4 ทดสอบ View History

1. กด **📜** ของ PR ที่เคย approve/reject
2. Modal แสดงประวัติทั้งหมดของ PR นี้

---

# 🛡️ ความปลอดภัยที่ระบบมีในตัว

ระบบจะปฏิเสธ action ในกรณีต่อไปนี้:

1. **Target ไม่ใช่ Staging** → คืน HTTP 403 + log "Refused: target not staging"
2. **PR status != active** → ปฏิเสธ
3. **PAT หมดอายุ / สิทธิ์ไม่พอ** → คืน HTTP 401 พร้อม hint
4. **User ไม่ได้ login** → คืน 401
5. **Reject without reason** → คืน 400 ต้องใส่เหตุผลอย่างน้อย 3 ตัวอักษร

ทุก action จะมี log ลง SharePoint ไม่ว่าจะสำเร็จหรือ fail

---

# 🔧 Troubleshooting

| Error | สาเหตุ | วิธีแก้ |
|---|---|---|
| `Failed to find SharePoint site` | hostname / site path ผิด | ตรวจ env vars ขั้น 3.2 |
| `Failed to get token: HTTP 401` | Graph permission ไม่ครบ | ทำขั้น 2.2-2.3 ใหม่ |
| `SharePoint List not found` | ชื่อ list ไม่ตรง | ตรวจชื่อ list ใน SP + env var SHAREPOINT_LIST_NAME |
| `ADO API returned 403` | PAT ไม่มี Code: Write | สร้าง PAT ใหม่ scope Code Read & Write |
| `Cannot identify bot user` | PAT หมดอายุ | สร้าง PAT ใหม่ |
| Approve สำเร็จ แต่ log ไม่ขึ้น | Graph permission ยังไม่ propagate | รอ 5-10 นาที |

---

# 🎯 Phase 4 ที่จะมาต่อ (ถ้าต้องการ)

- **Daily Summary** ส่งเข้า Teams ทุกเย็น สรุปจำนวน Approved/Rejected วันนี้
- **Statistics Dashboard** กราฟ trend, top approver, top requester
- **Kill Switch** — feature flag ปิดระบบทันทีถ้าเกิดปัญหา
- **Notification on PR** ส่ง Teams เมื่อมี PR ใหม่เข้ามารอ
- **Polling Timer (24/7)** ถ้าเปลี่ยนใจอยาก Auto-Approve ในอนาคต

แต่ก่อนไป Phase 4 ใช้ Phase 3 จริงสักระยะหนึ่งก่อน เพื่อปรับ workflow ตามจริง

---

# 📊 Free Tier Quota ที่ใช้ Phase 3

| Service | Quota | ใช้จริง |
|---|---|---|
| Azure Functions executions | 1M/เดือน | < 1000/วัน |
| Static Web Apps bandwidth | 100GB/เดือน | น้อยมาก |
| SharePoint storage | 1TB+ ต่อ tenant | log แต่ละ row < 1KB |
| Graph API calls | 100,000/แอป/10s | น้อยมาก |
| ADO REST API | ไม่มี hard limit | < 100/วัน |

ทั้งหมดยังอยู่ใน **0 บาท/เดือน** ครับ
                  