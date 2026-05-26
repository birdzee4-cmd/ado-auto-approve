# 📘 Phase 2 (Simplified) — ใช้ Azure Repos Teams App

แทนการเขียน webhook + Function เอง เราใช้ **Azure Repos** ซึ่งเป็น app ที่ Microsoft ทำมาให้ ติดตั้งใน Teams แล้วสั่ง subscribe ได้ทันที

**ผลลัพธ์ที่ได้:** เมื่อมี PR ใหม่/อัปเดตใน Staging branch จะมีการ์ดเด้งเข้า Teams channel พร้อมปุ่ม **Approve / View / Vote**

**ใช้เวลา:** ประมาณ 5-10 นาที

---

## ✅ ก่อนเริ่ม — สิ่งที่ต้องมี

- [ ] Microsoft Teams (มีอยู่แล้ว)
- [ ] บัญชี O365 ที่ใช้กับ Azure DevOps (ใช้บัญชีเดียวกัน)
- [ ] สิทธิ์ดู repo ใน ADO project ที่จะ subscribe

---

# ขั้นตอนทำงาน

## ขั้นตอน 1: ติดตั้ง Azure Repos app ใน Teams (2 นาที)

1. เปิด Microsoft Teams
2. คลิก **"Apps"** (รูปไอคอน apps มุมซ้ายล่าง)
3. ในช่องค้นหา พิมพ์ **"Azure Repos"**
4. เลือก app **"Azure Repos"** (publisher: Microsoft)
5. คลิก **"Add"** → เลือกว่าจะ add ไปที่ team/channel ไหน
   - แนะนำ: เพิ่มเข้า channel ที่ต้องการรับแจ้งเตือน (เช่น `#dev-staging`)
6. คลิก **"Set up"** หรือ **"Add to a team"**

> 💡 ถ้าค้นหาไม่เจอ: อาจเป็นเพราะ Admin ปิด external apps ไว้ ติดต่อ IT admin ให้เปิด "Azure Repos" app

## ขั้นตอน 2: Sign in ด้วย ADO (1 นาที)

1. ใน channel ที่ติดตั้ง Azure Repos
2. พิมพ์ในช่องแชท:
   ```
   @Azure Repos signin
   ```
3. กด Enter
4. จะมีการ์ดเด้งขึ้นมาให้กด **"Sign in"**
5. เด้งหน้าเว็บ → login ด้วย O365 → อนุญาตการเข้าถึง
6. กลับมาที่ Teams จะเห็นข้อความ **"Signed in"** ✅

## ขั้นตอน 3: Subscribe PR events ของ Staging (3 นาที)

### 3.1 หา URL ของ project

1. เปิด Azure DevOps ของคุณ
2. ไปที่ project ที่ต้องการ subscribe
3. คัดลอก URL จาก browser address bar รูปแบบประมาณ:
   ```
   https://dev.azure.com/<organization>/<project>
   ```
   ตัวอย่าง: `https://dev.azure.com/mycompany/MyProject`

### 3.2 ใช้คำสั่ง subscribe

กลับมาที่ Teams channel พิมพ์:

```
@Azure Repos subscribe https://dev.azure.com/<organization>/<project>
```

ตัวอย่าง:
```
@Azure Repos subscribe https://dev.azure.com/mycompany/MyProject
```

จะมีการ์ดเด้งขึ้นมาให้เลือก:
- **Repository:** เลือก repo ที่ต้องการ
- **Event:** เลือก **"Pull request created"** ก่อน → กด **"Submit"**

### 3.3 เพิ่ม filter เฉพาะ branch Staging

หลังจาก subscribe แล้ว ในการ์ดที่เด้งให้คลิก **"View/edit subscriptions"** หรือพิมพ์:

```
@Azure Repos subscriptions
```

แล้วคลิก **"Edit"** หรือ **"Filter"** ใส่:

| Filter | Value |
|---|---|
| **Target branch** | `refs/heads/staging` (หรือ `staging` แล้วแต่ระบบ) |
| **Repository** | (เลือก repo เฉพาะ ถ้าต้องการ) |

> 💡 ถ้าใส่ filter ไม่ได้ผ่าน UI ลองพิมพ์:
> ```
> @Azure Repos subscribe https://dev.azure.com/<org>/<project>/_git/<repo> pullrequest --target-branch staging
> ```

### 3.4 ทำซ้ำสำหรับ "Pull request updated"

พิมพ์อีกครั้ง:
```
@Azure Repos subscribe https://dev.azure.com/<org>/<project>
```

เลือก event เป็น **"Pull request updated"** (เพื่อรับการ์ดเมื่อมี commit ใหม่ใน PR)

---

## ขั้นตอน 4: ทดสอบ (2 นาที)

1. เปิด ADO project ที่ subscribe
2. สร้าง branch ทดสอบ เช่น `test-azurerepos`
3. แก้ไฟล์อะไรก็ได้ → commit → push
4. สร้าง **Pull Request** จาก `test-azurerepos` → `staging`
5. รอ 5-10 วินาที → ✅ ควรเห็นการ์ด PR เด้งเข้า Teams channel
   - การ์ดมี: ชื่อ PR, ผู้สร้าง, source/target branch
   - มีปุ่ม **Approve, View, Reject** ในตัว!

🎉 **Phase 2 เสร็จ!** — ไม่ต้องเขียนโค้ดเลย

---

## 🛠️ คำสั่งที่มีประโยชน์

| คำสั่ง | ความหมาย |
|---|---|
| `@Azure Repos signin` | Login |
| `@Azure Repos signout` | Logout |
| `@Azure Repos subscriptions` | ดู subscription ที่มีทั้งหมด ลบหรือแก้ไขได้ |
| `@Azure Repos unsubscribe all` | ยกเลิกทุก subscription |
| `@Azure Repos feedback` | ส่ง feedback ให้ Microsoft |
| `@Azure Repos help` | ดูคำสั่งทั้งหมด |

---

## 🔧 Troubleshooting

### ❌ ค้นหา "Azure Repos" ใน Teams ไม่เจอ
- IT Admin อาจปิด external apps ขอให้เปิดให้
- หรือลองค้น "Azure Boards" / "Azure Pipelines" แล้วดูว่ามี publisher = Microsoft ไหม

### ❌ Subscribe สำเร็จแต่ไม่มีการ์ดเด้งตอนสร้าง PR
- ตรวจ filter ว่า target branch ตั้งถูกหรือไม่ — Staging ที่ใช้จริงคือ `staging` หรือ `refs/heads/staging`
- ใช้ `@Azure Repos subscriptions` เช็คว่า subscription มีอยู่จริง
- ลอง unsubscribe แล้ว subscribe ใหม่ครั้งเดียวก่อน (ไม่ใส่ filter) เพื่อพิสูจน์ว่าเชื่อมต่อได้

### ❌ "Sign in" แล้วไม่เจอ project
- บัญชี O365 ที่ใช้ใน Teams ต้องเป็นบัญชีเดียวกับที่มีสิทธิ์ใน ADO project
- ถ้าใช้คนละบัญชี ใช้ `@Azure Repos signout` แล้ว `@Azure Repos signin` ใหม่

---

## 📊 อะไรเกิดขึ้นกับ Azure Functions ที่เขียนไปแล้ว?

โค้ดเก่าที่เขียนไป (`/api/webhook`, `/api/test-notification`, `/api/shared`) ยังอยู่บน Static Web App ของคุณ
- **ไม่ก่อให้เกิดปัญหาอะไร** (จะ idle ไม่ทำงานจนกว่าจะมีคนเรียก)
- **ไม่เปลือง quota** (free tier วัดจาก execution ไม่ใช่ deploy)
- **เก็บไว้ก่อนได้** เพราะ Phase 3 (auto-approve) จะต้องใช้ Azure Functions อยู่ดี

ถ้าอยากลบทิ้งให้สะอาด ก็ลบโฟลเดอร์ `api/webhook` และ `api/test-notification` ใน GitHub แล้ว commit ได้

---

# 🎯 ขั้นถัดไป — Phase 3: Auto-Approve

Phase 3 จะเป็นส่วนที่เริ่มมี code logic จริงๆ
หน้าที่: เมื่อ PR เข้า Staging + Build ผ่าน → ส่งคำสั่งให้ ADO Approve และ Merge อัตโนมัติ

โครงคร่าวๆ ที่ผมกำลังคิด (จะมาเล่าละเอียดเมื่อ Phase 2 พร้อม):
1. **Timer-based polling** (ทุก 5 นาที) — Azure Function ดึง PR ที่ active ใน Staging มาตรวจ
2. ถ้าผ่านเงื่อนไข (Build ✅ + ไม่ Conflict + ไม่ Draft) → เรียก API Approve + Set AutoComplete
3. ไม่แตะ Work Item (`transitionWorkItems: false`)
4. แจ้งผลเข้า Teams ผ่าน Azure Repos (ก็จะเห็น vote เปลี่ยนใน Teams)

ข้อดีของ polling แทน webhook สำหรับ Phase 3:
- ไม่ต้องตั้ง webhook ใน ADO อีก
- 24/7 ในตัว (timer trigger)
- Recovery ง่ายถ้าตัว Function ตาย — รอบหน้าก็ทำงานต่อ
- Debug ง่ายกว่า

แค่บอกผมเมื่อ Phase 2 (Azure Repos app) ทำงานเรียบร้อย ผมจะเตรียม Phase 3 ให้ครับ
