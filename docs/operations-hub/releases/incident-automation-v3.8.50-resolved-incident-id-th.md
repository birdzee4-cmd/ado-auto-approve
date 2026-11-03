# Incident Automation v3.8.50: จับคู่ RESOLVED ด้วย IncidentId

## เหตุการณ์ 16 ตุลาคม 2026

เคส `INC-2026-000309` / ADO `#891726` ได้รับอีเมล `✅ RESOLVED` เวลา 03:43 น. แต่ Teams ไม่มีข้อความ RESOLVED และมี `🔔 Operations Hub: Incident ready to close` เวลา 03:50 น.

run ของ Incident Automation v3.8.49 ที่รับอีเมล RESOLVED สำเร็จ แต่ `Get_latest_open_FIRING` คืน `value: []`; `Update_matching_incident_RESOLVED` และ `Post_RESOLVED_to_Teams` จึงถูกข้าม ตัวกรอง v3.8.49 ใช้ `FirstSeenAt` ในช่วง ±1 นาที โดย Flow คำนวณเป็น `2026-10-16T03:18:00+07:00` ขณะที่ SharePoint คืนค่าของรายการที่สร้างเป็น `15/10/2026 13:18:00` จึงไม่ตรงช่วงเวลา แม้ `IncidentId` ของอีเมลและรายการตรงกัน

ข้อความ ready to close มาจาก API reconciliation แยกจาก Flow และไม่ได้ยกเลิกการส่ง RESOLVED แต่ API ไม่ตรวจว่าข้อความ Teams RESOLVED ส่งสำเร็จก่อน จึงยังไม่รับประกันลำดับที่ต้องการ

## การแก้ในแพ็กเกจ

`OperationsHub-IncidentAutomationv3.8.50-ResolvedIncidentId-Import.zip` เปลี่ยน `Get_latest_open_FIRING` ให้ค้นด้วย `IncidentId` ที่ Flow คำนวณจาก alert, resource และ first seen ของอีเมลทั้งสองฉบับ พร้อมเงื่อนไข `AdoWorkItemId ne null` และสถานะ FIRING/RESOLVED จากนั้น Teams RESOLVED ยังส่งหลังอัปเดตรายการ SharePoint สำเร็จ

ให้นำเข้าแบบ **Update** โดยเลือก Flow เดิม `Operations Hub - Incident Automation v3.8.49` และเชื่อมต่อ Outlook, SharePoint, Teams, Azure DevOps, Approvals ชุดเดิม การนำเข้าจะเปลี่ยนเวอร์ชันของ Flow เดิม ไม่ควร Create as new เพราะจะมี Flow รับอีเมลซ้ำ

แพ็กเกจนี้แก้การแจ้ง RESOLVED ของอีเมลใหม่ ไม่ย้อนส่งข้อความของเคส `INC-2026-000309` ที่ถูกประมวลผลแล้ว ส่วนการรับประกันว่า ready to close ส่งหลัง Teams RESOLVED ทุกกรณี ต้องเพิ่มหลักฐานการส่ง Teams ที่ API reconciliation อ่านได้ และให้ API รอหลักฐานนั้นก่อนแจ้ง
