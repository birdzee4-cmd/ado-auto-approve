# Incident Automation v3.8.46 — ผู้เขียน RESOLVED Discussion

แพ็กเกจ: `artifacts/power-automate/OperationsHub-IncidentAutomationv3.8.46-ITSupportIdentity-Import.zip`

ใน v3.8.45 action `Add_RESOLVED_comment_to_Tier1` มี reference ชื่อ `_it_support` แต่ reference นี้ชี้ connection resource และ embedded connection เดียวกับ Azure DevOps reference หลัก ผู้เขียน Discussion จึงเป็นบัญชีที่ connection นั้นลงชื่อเข้าใช้จริง ซึ่งในภาพเป็น Kiattisak Yooyong (Bird) ชื่อ display ของ resource ในแพ็กเกจไม่กำหนดผู้เขียน comment

v3.8.46 แยก connection resource สำหรับ action นี้และปล่อย embedded connection ว่าง เพื่อให้เลือก connection Azure DevOps ที่ลงชื่อเข้าใช้ด้วย `it-support@buzzebees.com` ตอน import โดยเฉพาะ Action อื่นยังใช้ connection เดิม

ตอน import ให้เลือก **Update** Flow เดิม และที่ resource `Azure DevOps - it-support@buzzebees.com (RESOLVED Discussion)` ให้เลือกหรือสร้าง Azure DevOps connection ซึ่งยืนยันในหน้า Connections ว่าลงชื่อเข้าใช้ด้วย `it-support@buzzebees.com` หากเลือก connection ของ Bird ผู้เขียน comment จะยังเป็น Bird หลัง import ให้ทดสอบกับ Incident ใหม่และตรวจผู้เขียน Discussion ใน Azure DevOps; comment เก่าจะไม่เปลี่ยนผู้เขียนย้อนหลัง
