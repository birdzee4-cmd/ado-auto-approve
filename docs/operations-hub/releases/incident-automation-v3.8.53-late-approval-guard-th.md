# Incident Automation v3.8.53: ป้องกัน Approval ย้อนหลังเปิดงานที่ปิดแล้ว

**พบ runtime bug หลัง Approve ใน v3.8.53:** guard เรียก empty() กับ revision ที่เป็น Integer ให้ใช้แพ็กเกจ v3.8.54 แทน ดู `incident-automation-v3.8.54-revision-type-fix-th.md` การผ่าน local checks/Flow checker ของ v3.8.53 ไม่ใช่หลักฐานว่าเส้นทางหลัง Approve ทำงานสำเร็จ

แพ็กเกจ: `artifacts/power-automate/OperationsHub-IncidentAutomationv3.8.53-LateApprovalGuard-Import.zip`

## สถานะติดตั้ง 29 ตุลาคม 2026

- สำรอง Flow จริงจากบัญชี IT Support เป็น `OperationsHub-IncidentAutomation-LiveExport-20261029-1003_20261029030251.zip` โดยเก็บไฟล์ตามที่ส่งออก ไม่แก้ metadata
- เปรียบเทียบ definition จริงกับฐาน v3.8.52 แล้ว ต่างเฉพาะ metadata เวลา ไม่ต่างใน actions หรือ triggers
- Power Automate ยืนยัน All package resources were successfully imported และ The flow has been updated successfully โดย Update Flow ID เดิม `bd8d4c3c-ee57-4a88-b15d-d0c063c1592a`
- เปิด designer ของ v3.8.53 และตรวจ Flow checker: Errors (0), Warnings (0)
- หลังนำเข้า Flow เป็น Off จึงเปิดกลับเป็น On และตรวจหน้า Details ว่า Status On พร้อมเมนู Turn off แล้ว
- หลักฐานอยู่ที่ `artifacts/power-automate/IncidentAutomation-v3.8.53-import-success.png` และ `IncidentAutomation-v3.8.53-on.png`
- ผล local validator 36 checks และ UI build ผ่าน แต่ยังไม่มีผล UAT ของเส้นทางรับคำตอบ Approval จริงหลังอัปเดต ไม่ถือว่าผล Import หรือ Flow checker แทนการทดสอบ runtime ได้
- ยังไม่ได้ deploy UI ไปเว็บ Production หรือยกเลิก run/คำขอเก่า ไม่มีการกด Approve/Reject แทนผู้ใช้ และไม่ได้แก้สถานะใบงานเดิม

### ตรวจ runtime และคิวค้างหลังนำเข้า

- Run ใหม่ `08584083619315834121295490841CU07` เริ่ม 29/10/2026 10:35 (Asia/Bangkok) ใช้ v3.8.53 สร้าง INC-2026-000545 / VSTS #897261 สำเร็จ และรอที่ Start and wait for an approval (เริ่มรอ 10:36:01)
- ใน run เดียวกันมี Get Work Item After Approval, Get Incident After Approval และ Condition Approval Still Current อยู่หลังขั้นรอ ทั้งสามยัง Waiting ไม่ใช่ผลทดสอบผ่าน
- ตรวจหน้า Run history โดยเลือก Running พบ 2 รายการ: run ใหม่ข้างต้นและ run เก่าเวลา 09:28 `08584083659515310828365735703CU00` หน้า Operations Hub แสดง INC-2026-000545 และ INC-2026-000543 / #897186 ยัง Active, New, Unassigned จึงคงทั้งสองรายการ ไม่ใช้ Cancel all flow runs
- ภายในผล Running ที่แสดงในรอบตรวจนี้ไม่พบ run ของใบงานกลางคืนที่ Closed แล้ว การตรวจนี้ไม่ยืนยันว่าไม่มีคำขอ orphan ใน Teams/Approvals ซึ่งต้องตรวจแยกจาก Flow run status
- การ deploy UI ยังติดสิทธิ์ GitHub: CLI token ไม่ถูกต้อง และ GitHub connector ตอบ 403 Resource not accessible by integration เมื่อสร้าง branch ผู้ใช้เลือกเข้าสู่ระบบ GitHub ผ่าน Edge เพื่อดำเนินการต่อ ยังไม่มี remote branch/commit ใหม่จากงานนี้

## พฤติกรรม

หลังได้รับคำตอบหรือข้อผิดพลาดจาก Approvals จะอ่าน VSTS และ SharePoint ใหม่ ก่อนเข้าเส้นทาง Approve, Reject หรือ Error โดยต้องครบทุกเงื่อนไข:

- Alert ยัง FIRING และ workflow ยัง AWAITING_APPROVAL
- IncidentId และ AdoWorkItemId ตรงกับ run เดิม
- ไม่มี ResolvedAt หรือ ApprovalCompletedAt
- ApprovalRequestedAt และ ApprovalAttempt ยังตรงกับคำขอเดิม
- VSTS ยัง New, Active หรือ Processing และมี revision
- มี SharePoint ETag สำหรับ conditional update

ถ้าไม่ผ่าน จะไม่ Assign และไม่เปลี่ยนสถานะ VSTS คำตอบของคำขอเดิมที่ยังไม่มีผลตอบรับจะถูกบันทึกเป็น `Historical:<outcome>` พร้อมชื่อ ความเห็น เวลา และ Approval ID โดยไม่เขียน lifecycle, owner หรือ AdoState ส่วนคำตอบซ้ำหรือคำขอที่ถูกแทนด้วยคำขอใหม่จะไม่แก้ข้อมูลเดิม

การแก้ VSTS ใช้ REST JSON Patch พร้อม `test /rev` ถ้ามีคนปิดงานหลังอ่านข้อมูล server จะปฏิเสธ patch ทั้งชุด การเขียน SharePoint ในเส้นทางรับผลใช้ ETag และ MERGE เมื่อข้อมูลเปลี่ยนหลังอ่าน จะล้มเหลวแทนการทับข้อมูลใหม่ ไม่มี automatic retry สำหรับ conditional writes และไม่เขียน tags หรือ environment ทับจากข้อมูลเก่า

หน้า Operations Hub แสดง Cancelled / No longer required / Historical response แทน Awaiting approval ตามสถานการณ์ ส่วนคำขอที่อนุมัติจริงแล้วคงแสดง Approved

## นำเข้าและจัดการคำขอเดิม

1. ตรวจว่า Flow ปัจจุบันตรงกับฐาน v3.8.52 ของแพ็กเกจนี้ หากมีการแก้บนระบบเพิ่มเติม ให้ export เก็บและตรวจ diff ก่อนนำเข้า
2. นำเข้า ZIP แบบ Update Flow เดิม ใช้ connection เดิม ไม่เปิด Flow ซ้ำอีกตัว ตรวจชื่อ v3.8.53 และ contentVersion 3.8.53.0
3. อัปเดตเว็บด้วย source UI ที่มาพร้อมการแก้นี้ตามกระบวนการ deploy ปกติ
4. **Run ที่รอ Approval อยู่ก่อนอัปเดตยังใช้ definition เก่า** ต้องตรวจ run history และจับคู่ Incident/Work Item ก่อนจัดการ อย่ากด Approve หรือ Reject รายการ Closed เพื่อเคลียร์คิว
5. สำหรับงานที่ Recovered/Closed แล้ว ให้ผู้ดูแลยกเลิก run เก่าที่รอ Approval และผู้สร้างจัดการยกเลิกคำขอค้างใน Approvals ตรวจทั้งสถานะ run และคำขอจริง ไม่ถือว่าค่า CANCELLED ใน SharePoint แปลว่าคำขอ Teams ถูกยกเลิกแล้ว
6. งานที่ยัง FIRING ให้เก็บไว้ในรายการติดตามและส่งให้ผู้รับผิดชอบรับช่วงอย่างชัดเจนก่อนยกเลิกหรือสร้างคำขอทดแทน ห้ามยกเลิกทุก run แบบเหมารวม
7. งานที่ถูกเปิดกลับแล้ว ให้ตรวจ History ว่ามาจาก Approval เก่าจริง และตรวจว่าไม่มีเหตุใหม่/งานติดตามที่ยังเปิด ก่อนแก้สถานะและผู้รับผิดชอบคืน

แพ็กเกจนี้ยังไม่ยกเลิกคำขอ Teams อัตโนมัติเมื่อ RESOLVED และไม่ส่งข้อความแทนผู้ใช้ ไม่แก้ข้อมูล Production หรือคำขอเดิมอัตโนมัติ การกดคำขอเก่าใน run ใหม่จะเป็นการบันทึกย้อนหลังอย่างปลอดภัย ส่วนการล้างคิวเดิมต้องทำตามขั้นตอนข้างต้น

## ตรวจสอบก่อนใช้งานจริง

Validator อ่าน definition ที่สร้างจริง ทดสอบเงื่อนไข Active/Recovered/Cancelled/Closed, การตอบซ้ำ, เปลี่ยน Incident/Work Item/คำขอ, JSON ที่มีชื่อและความเห็นพร้อมเครื่องหมายคำพูด และโครงสร้าง revision/ETag รวมทั้งสถานะ UI:

```powershell
node scripts/validate-operations-hub-late-approval-guard.js <unpacked-package>
cd operations-ui
npm run build
```

ตรวจ UAT บน Power Automate หลัง import ด้วย: (1) Active แล้ว Approve ได้ Processing และ Assign ถูกคน (2) RESOLVED และปิด VSTS ก่อน Approve แล้วสถานะ/owner ไม่เปลี่ยน (3) Closed แล้ว Reject ไม่เปิดหรือเปลี่ยนเป็น Reject (4) ปิด VSTS ระหว่าง GET/PATCH แล้ว revision test ปฏิเสธ (5) RESOLVED ระหว่าง GET/MERGE แล้วได้ 412 และสถานะ SharePoint คง RESOLVED (6) ข้อมูลอ่านไม่ได้จะไม่เข้า mutation branch

การตรวจ local ไม่ใช่หลักฐานว่า import หรือ UAT ผ่านแล้ว และ SharePoint/VSTS ไม่มี transaction ร่วมกัน หาก RESOLVED เข้ามาระหว่างสองระบบ อาจมีช่วงเวลาที่ cache ยังไม่ตรงกัน ต้องตรวจ reconciliation หลังทดสอบด้วย ห้ามสรุปจากผล action เดียว

## สร้างซ้ำ

สคริปต์ builder ต้องใช้ source/output ใต้ `artifacts/power-automate/_work/` และอ่านชื่อ ZIP ของ IncidentAutomation ทุก archive รวม export ก่อนเลือก patch ถัดไป เก็บ ZIP เก่าไว้เสมอ การสร้างซ้ำหลังเผยแพร่ v3.8.53 จะได้ v3.8.54 หรือสูงกว่าตาม baseline จริง

เอกสารอ้างอิง: [ADO revision test](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1), [SharePoint connector HTTP request](https://learn.microsoft.com/en-us/connectors/sharepointonline/), [จัดการคำขอ Approval](https://learn.microsoft.com/en-us/power-automate/guidance/business-approvals-templates/process-approval-requests)
