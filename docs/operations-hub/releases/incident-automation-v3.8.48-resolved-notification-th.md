# Incident Automation v3.8.48 — แจ้ง RESOLVED หลังบันทึกสถานะ

กรณี INC-2026-000308 วันที่ 15 ตุลาคม 2026 เวลา 10:44 น. อีเมล RESOLVED มาถึง `NowAlert_AppService` และ Operations Hub แสดง Recovered/Resolved at แล้ว แต่ยังไม่เห็น `✅ RESOLVED` ใน Teams

ใน package v3.8.47 action `Post_RESOLVED_to_Teams` รอ `Scope_Update_Tier1_after_RESOLVED` ซึ่งทำงาน Azure DevOps หลายขั้นตอน ทั้ง comment, ดึง Related Work Items และอาจปิด Tier 1 ดังนั้นข้อความ Teams อาจล่าช้าระหว่างขั้นตอนเหล่านี้ แม้ SharePoint บันทึก RESOLVED แล้ว

v3.8.48 เปลี่ยน `runAfter` ของ `Post_RESOLVED_to_Teams` ให้ส่งหลัง `Update_matching_incident_RESOLVED` สำเร็จโดยตรง ส่วน `Scope_Update_Tier1_after_RESOLVED` ยังคงทำงานหลัง update เดียวกันและไม่ถูกตัดออก ข้อความ FIRING และปลายทาง Teams คงตาม v3.8.47

**ผลตรวจ Run history ภายหลัง:** สำหรับ INC-2026-000308 สาเหตุจริงไม่ใช่การรอ Azure DevOps ใน v3.8.47 แต่ `Get_latest_open_FIRING` คืนค่า 0 เพราะ filter ใช้ `Metric eq ''` จากเมล RESOLVED ที่ไม่มี Metric จึงข้าม Teams action ตั้งแต่ก่อน update เส้นทางนี้ต้องแก้ correlation เพิ่มใน v3.8.49

การเปลี่ยนนี้แก้ความล่าช้าจาก dependency ที่พบใน package แต่ยังต้องตรวจ Run history ของเหตุการณ์จริงเพื่อยืนยันว่า RESOLVED วิ่งเข้า Flow นี้และ Teams action ไม่ล้มเหลวด้วยสาเหตุอื่น หาก Incident ถูกอัปเดตโดย Alert Lifecycle Reconciliation แทน Flow หลัก การเปลี่ยนนี้จะไม่ส่งข้อความย้อนหลัง

Work Item #890392 อยู่ Processing ไม่ได้ขัดกับ Monitoring ที่ Recovered: สถานะ Azure DevOps เป็นงานติดตามที่ต้องดำเนินการต่อจนเสร็จ และข้อความ Ready to close จะยังไม่เข้าเงื่อนไขในระหว่างนั้น
