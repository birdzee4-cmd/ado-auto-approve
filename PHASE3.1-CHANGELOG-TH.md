# 📘 Phase 3.1 — Preserve Config + Ignore Release Notes + Approvals UI

อัปเดตเล็กจาก Phase 3 ไม่ต้องสร้างอะไรใหม่ใน Azure/SharePoint แค่ upload โค้ดทับและรอ deploy

## ✅ สิ่งที่เปลี่ยน

### 1. Backend — เคารพ completionOptions เดิม + ลบ Release Notes อัตโนมัติ

**ลำดับใหม่ตอน Approve:**

| ลำดับ | ขั้นตอน |
|---|---|
| 1 | GET PR detail + reviewers |
| 2 | GET Branch Policies ของ staging |
| 3 | หา Release Notes policy ID (ถ้ามี) |
| 4 | ⭐ **Set Auto-Complete** (merge config เดิม + ใส่ Release Notes ใน `autoCompleteIgnoreConfigIds`) |
| 5 | **Vote = 10** |
| 6 | Add comment ระบุ user |
| 7 | Log SharePoint |

**ฟิลด์ที่บังคับเสมอ (ไม่ให้เขียนทับ):**
- `transitionWorkItems: false` ★ ไม่แตะ Worklist
- `bypassPolicy: false` ★ เคารพ branch policy

**ฟิลด์ที่ preserve จากเดิม:**
- `deleteSourceBranch` (ใช้ค่าเดิมของผู้เปิด PR)
- `mergeStrategy` (ใช้ค่าเดิม ถ้าไม่มีใช้ `noFastForward`)
- `mergeCommitMessage` (ของผู้เปิด PR ถ้ามี)
- `squashMerge` และฟิลด์อื่นๆ
- `autoCompleteIgnoreConfigIds` เดิม + เพิ่ม Release Notes

### 2. Frontend — Column "Approvals" + Reviewers Modal

ตาราง PR เพิ่ม column ใหม่:

```
🟢 3/3 Complete    ← พร้อม merge
🟡 1/3 Pending     ← รอ approver เพิ่ม
🔴 Rejected        ← มี reviewer reject
```

**คลิกที่ badge → popup รายชื่อ reviewers:**
- ชื่อ reviewer (เรียง required ก่อน, group ก่อนคน)
- Type: 👥 Group / 👤 Person
- Required / Optional
- Vote: ✅ Approved / ☑️ Approved with suggestions / ⏸ Waiting / ❌ Rejected / ⏳ No vote
- Summary: Branch policy minimum approver count

### 3. Modal Approve อัปเดตข้อความ

เพิ่ม line:
```
⭐ Uncheck "Release Notes" optional check (ถ้ามี)
```

---

## 📦 ไฟล์ที่เปลี่ยน

```
api/shared/ado-client.js          ← เพิ่ม getBranchPolicies, findReleaseNotesPolicyIds, findMinimumApproverCount + แก้ setAutoComplete
api/approve-pr/index.js           ← เปลี่ยนลำดับ + ใช้ logic ใหม่
api/list-prs/index.js             ← เพิ่ม approval count + reviewers detail
public/dashboard.html             ← เพิ่ม column + Reviewers Modal
public/app.js                     ← renderApprovalBadge + openReviewersModal
public/styles.css                 ← styles สำหรับ badge + modal
```

ไฟล์ที่ **ไม่ได้แก้** (ยังใช้ของ Phase 3 ได้):
- `api/shared/sharepoint-client.js`
- `api/shared/teams-notifier.js`
- `api/reject-pr/index.js`
- `api/pr-history/index.js`
- `api/health/index.js`
- `api/host.json`
- `api/package.json`
- `staticwebapp.config.json`

---

## 🚀 วิธี Deploy (3 ขั้นตอน, ~5 นาที)

1. แตก ZIP `ado-auto-approve-phase3.1.zip`
2. ลากไฟล์ทั้งหมด**ภายใน**โฟลเดอร์เข้า GitHub repo → ✅ Replace existing → Commit
3. รอ Actions tab เขียว (~2 นาที) แล้ว refresh เว็บ

**ไม่ต้องตั้ง env vars เพิ่ม** ใช้ค่าเดิม Phase 3 ได้ทั้งหมด

> ⚠️ ระวัง: ถ้า upload เขียนทับ `staticwebapp.config.json` ให้ใส่ Tenant ID กลับ (ที่ใส่ตอน Phase 1)

---

## 🧪 ทดสอบกับ PR #341066

### Step 1: Verify Release Notes policy ที่ branch staging

```
1. ไปที่ ADO Project → Branches → staging → ⚙️ Branch Policies
2. ดู section "Check for Linked Work Items" หรือ "Build Validation" หรือ "Status Checks"
3. ถ้าเห็น policy ชื่อ "Release Notes" → ✅ ระบบจะ detect และ ignore ตามที่ต้องการ
4. ถ้าไม่เห็น → อาจไม่ใช่ branch policy แต่เป็นอย่างอื่น (อาจต้อง configure additional)
```

### Step 2: ทดสอบ Approve PR #341066

1. ก่อนกด Approve → เปิด PR #341066 ใน ADO ตรวจ:
   - มี ☑ Release Notes อยู่ใน auto-complete dialog ใช่ไหม
   - มี completionOptions อะไรอื่นที่ตั้งไว้
2. กดปุ่ม **✅ Approve** บนเว็บ → confirm
3. เช็คผลใน ADO:
   - บอท vote=10 ✅
   - PR เปิด auto-complete ✅
   - **Release Notes checkbox ถูก uncheck** ⭐ (ผลที่คาดหวัง)
   - ถ้ามี config อื่นที่ผู้เปิด PR ตั้งไว้ → ยังคงอยู่
4. ดู Comment ใน PR — ระบบจะระบุ:
   ```
   Ignored optional check(s): Release Notes (X policy ID)
   ```
   ถ้าตัวเลขเป็น `0` = ไม่เจอ policy "Release Notes" ที่ branch level

### Step 3: ทดสอบ Approvals Badge

1. กด **🔄 Refresh** บนเว็บ
2. ดูแถวของ PR #341066 ใน column "Approvals"
3. คลิกที่ badge → popup รายชื่อ reviewers + ดู status

### Step 4: API response (debug)

เปิด Developer Tools (F12) → Network → กด Refresh → ดู response ของ `/api/list-prs`

ใน PR #341066 ควรมี:
```json
{
  "approval": {
    "approvedCount": ...,
    "requiredCount": ...,
    "status": "pending|complete|rejected",
    "minApproversFromPolicy": ...
  },
  "policyFetched": true,
  "reviewers": [
    { "displayName": "...", "vote": 10, "isRequired": true, "isContainer": false }
  ]
}
```

---

## 🔧 Troubleshooting

| อาการ | สาเหตุที่เป็นไปได้ | วิธีแก้ |
|---|---|---|
| Approvals badge ขึ้น `0/0 Pending` ตลอด | PAT ไม่มี scope อ่าน policy | เปิด PAT ใหม่ add scope **Code (Read)** + **Project & Team (Read)** |
| Modal popup ว่าง | reviewers field ว่าง | เช็ค response `/api/list-prs` ใน Network tab |
| comment บอกว่า "Release Notes ignored: 0" | ไม่เจอ policy "Release Notes" ที่ branch level | อาจเป็น status policy ที่ตั้ง name อื่น (ลบ/ตรวจชื่อ statusName ใน branch policies) |
| Release Notes ยัง check อยู่หลัง approve | API call timing — ลอง refresh PR ใน ADO | ตรวจ comment ของบอทว่าระบุ ignore กี่ตัว |
| `policyFetched: false` | ใช้ PAT scope ไม่พอ | เพิ่ม PAT scope ตามด้านบน |

---

## 🛡️ Security Constraints ที่ระบบยังบังคับ

✅ Target ต้องเป็น staging (refuse otherwise)
✅ PR status ต้อง active
✅ User ต้อง login ผ่าน O365
✅ Reject ต้องมีเหตุผล ≥ 3 ตัวอักษร
✅ `transitionWorkItems: false` (ห้ามแตะ Worklist) — **บังคับเสมอ ไม่ override ได้**
✅ `bypassPolicy: false` (เคารพ branch policy) — **บังคับเสมอ**

---

## 📊 Cost: ยังคง 0 บาท/เดือน

API call ที่เพิ่ม:
- `/policy/configurations` — 1 ครั้งต่อ repo (cache ภายใน list-prs) → +5-10 calls/วัน
- ทั้งหมดยังอยู่ใต้ free tier ของทุก service
