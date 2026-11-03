# ปิด Incident หลายรายการ

หน้า Incidents เพิ่มแผง `Close multiple ready incidents` สำหรับผู้ที่เชื่อมต่อ ADO และมี capability `closeIncident` เลือกงาน Ready to close ในหน้าปัจจุบันได้สูงสุด 20 รายการ พร้อมเลือกทั้งหมดเฉพาะหน้าที่เห็น

กด Close selected incidents เพื่อตรวจเลข INC, Resource, เวลาที่ Recovered และสถานะ ADO กรอกหมายเหตุร่วมได้ แล้วกด Confirm closure ระบบทยอยเรียก API ปิดงานเดิมทีละรายการ พร้อมแสดงความคืบหน้าและผลราย INC ถ้าบางรายการไม่สำเร็จ งานอื่นยังดำเนินต่อ และลองใหม่เฉพาะรายการที่ล้มเหลวได้

API ต้องตรวจ Work Item ทุกใบด้วย delegated identity เดิม ไม่รับการจำกัด roles ในคำขอปิด งานแบบกลุ่มต้องมี Primary Work Item, Work Item ทั้งหมดสิ้นสุด, Monitoring เป็น RESOLVED, ลำดับเวลาฟื้นตัวถูกต้องตามกติกาเดิม และไม่มี lifecycle conflict ตรวจสถานะที่ ADO ตอบกลับโดยตรงด้วย เพื่อป้องกัน SharePoint ยังอ่านได้สถานะเก่าหลัง synchronize กรณีตรวจข้อมูลไม่ได้จะไม่ปิดงาน

ไม่ใช้ Force Close สำหรับชุดงาน Audit INCIDENT_CLOSED ของแต่ละ INC บันทึกผู้ปิด เวลา หมายเหตุ และ batch ID งานที่ปิดแล้วรายงาน Already closed ตามพฤติกรรมเดิม การลองใหม่สร้าง batch ID ใหม่และเก็บผลสำเร็จก่อนหน้าไว้ในหน้าสรุป

ใช้ feature flag OPERATIONS_CLOSE_ENABLED เดิม ไม่ต้องเพิ่ม Power Automate package หรือ SharePoint schema Deploy API และ UI ร่วมกันผ่าน workflow ปกติ รุ่น UI ใหม่นี้ต้องใช้ API ที่มีเงื่อนไข batchClose แล้ว

การตรวจสอบ: TypeScript/Vite build ผ่าน; operations-bulk-close.test.js ผ่านทั้ง 8 สถานการณ์ ชุดทดสอบ operations-service และ operations-api ยังมี assertion ไม่ผ่านรวม 3 จุดในส่วน description ของ related ticket และ capabilities ที่ไม่ตรงกับ implementation ปัจจุบัน ไม่ได้แก้ assertion เหล่านั้นในงานนี้ ยังไม่ได้ deploy หรือทดลองปิดข้อมูลจริง
