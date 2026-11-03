# Incident Automation v3.8.52: ให้ API เขียน RESOLVED Discussion เพียงจุดเดียว

## สาเหตุ

ใบงาน `#892521` (`INC-2026-000314`) และ `#892460` (`INC-2026-000312`) มีคอมเมนต์ `✅ MONITORING ALERT RESOLVED` สองรายการ เพราะ Flow v3.8.50 เรียก `Add_RESOLVED_comment_to_Tier1` และ Operations Hub reconciliation API เรียก `ensureResolvedPrimaryComment` แยกกัน ทั้งสองใช้บัญชี IT Support แต่กลไกกันซ้ำของแต่ละระบบไม่ครอบคลุมอีกระบบ

## การแก้

แพ็กเกจ `OperationsHub-IncidentAutomationv3.8.52-ApiResolvedOwner-Import.zip` ให้ Flow ยังคงจับคู่ incident ด้วย `IncidentId`, อัปเดตสถานะ RESOLVED ใน SharePoint และส่ง `✅ RESOLVED` ไป Teams เมื่ออัปเดตสำเร็จ แต่ไม่เขียน Discussion และไม่ปิดใบงาน Tier 1 เอง

Operations Hub reconciliation API ที่ใช้งานอยู่จะเขียนคอมเมนต์ด้วย `ADO_RESOLVED_COMMENT_PAT` ของ IT Support เพียงครั้งเดียวตาม audit key แล้วปิดใบงาน Tier 1 เมื่อทุก related work item อยู่ในสถานะสิ้นสุด หากยังมีงาน related เปิดอยู่ API จะเขียนคอมเมนต์แล้วคง Tier 1 เปิดไว้

ให้นำเข้าแพ็กเกจ **v3.8.52 แบบ Update กับ Flow เดิม v3.8.50** และใช้ connection เดิม อย่านำเข้า v3.8.51 ซึ่งเป็นอาร์ติแฟกต์ระหว่างการพัฒนาและยังคงเส้นทางปิด Tier 1 ใน Flow หลังนำเข้าให้ตรวจว่า Flow เป็น v3.8.52 และ On; ไม่ควรเปิด Flow v3.8.50 อีกตัวควบคู่กัน

การแก้นี้มีผลกับอีเมล RESOLVED ใหม่ คอมเมนต์ที่ซ้ำในใบงานเดิมยังคงอยู่ และเวลาที่ API แสดงในคอมเมนต์ยังต้องตรวจแก้แยกจากปัญหาการแจ้งซ้ำ
