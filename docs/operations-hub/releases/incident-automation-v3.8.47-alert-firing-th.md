# Incident Automation v3.8.47 — คืนข้อความ ALERT FIRING

หมายเหตุการตรวจย้อนหลัง: คำอธิบายเดิมที่ระบุว่า v3.8.40 เป็นจุดเปลี่ยนข้อความไม่ถูกต้อง แพ็กเกจ v3.7.8 และ v3.8.0 ส่ง `🚨 P1 INCIDENT CREATED — FIRING` อยู่แล้ว ขณะที่ v2.7 ส่ง `🔥 ALERT FIRING` การเปลี่ยนเกิดขึ้นก่อน v3.7.8 และข้อความ `🔥 ALERT FIRING` ที่เคยปรากฏคู่กับข้อความสร้าง Incident อาจมาจาก Flow อีกตัว ต้องตรวจ Run history และชื่อ Flow ผู้ส่งก่อนสรุปสาเหตุจริง

แพ็กเกจ `OperationsHub-IncidentAutomationv3.8.47-AlertFiring-Import.zip` เป็นทางแก้เฉพาะหน้าที่เพิ่ม action `Post_Alert_FIRING_to_Teams` หลังสร้าง Incident ใหม่สำเร็จ สำหรับเส้นทาง P1 FIRING โดยยังส่งข้อความสร้าง Incident เดิมหลังบันทึก Azure DevOps work item เช่นเดิม ข้อความ alert ใช้แชตปลายทางเดียวกับข้อความ Incident **ยังไม่ควร import** จนกว่าจะตรวจ Flow ต้นทางของข้อความเดิม เพราะอาจทำให้แจ้งซ้ำเมื่อ Flow ต้นทางกลับมาทำงาน

ตรวจ ZIP แล้วมีไฟล์ 5 รายการ ชื่อแพ็กเกจ ชื่อ Flow ชื่อ resource และ `contentVersion` เป็น v3.8.47 ตรงกันทั้งหมด หลัง import ให้ทดสอบเมล FIRING ใหม่หนึ่งฉบับและตรวจ Run history ว่า action ส่ง Teams ทั้งสองขั้นตอนสำเร็จ รวมถึงทดสอบเมล FIRING ซ้ำหนึ่งฉบับว่าไม่สร้าง Incident ใหม่
