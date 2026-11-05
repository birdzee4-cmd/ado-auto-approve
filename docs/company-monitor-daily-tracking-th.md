# ติดตามปัญหา Project ภายในวัน

ใช้ timeline จาก `events-YYYY-MM-DD` ในตาราง archive เดิม Collector เพิ่ม status observation แบบ append-only ไม่ถือการ polling หรือระยะเวลาที่เปลี่ยนเป็น Build ใหม่

ประวัติก่อนมี index เติมจาก snapshot เดิมด้วย `scripts/backfill-company-monitor-events.cjs` โดยส่ง connection string ผ่าน environment อ่าน poll references/daily pointers และตรวจ SHA ก่อนสร้าง event รันซ้ำได้โดยไม่แก้หรือลบ snapshot เดิม

## กติกา

- จำกัดวัน LastUpdate ที่เลือกตามเวลาไทย ไม่ใช้ success วันถัดไปปิด Fail ของวันก่อน
- กลุ่มย่อยคือ Project + Environment + ProjectType + Git Branch แยก Module/Plugin และ branch
- Build fail กับ Deploy fail เป็นปัญหาคนละประเภท เก็บประวัติ Fail ไว้เมื่อพบ success
- จับคู่ Complete ครั้งแรกภายหลังในกลุ่มเดียวกัน Build ใหม่ต้องมี StartTime ที่อ่านได้และเริ่มตั้งแต่เวลา Fail เป็นต้นไป เพื่อไม่ใช้ success ของงานเก่าหรืองานที่รันค้างก่อน Fail
- Build ID เดิมเปลี่ยนเป็น Complete ภายหลัง ถือเป็นการกลับมาสำเร็จตาม Monitor ยังไม่ยืนยันการแก้ code เดิมหรือ artifact
- Complete ภายหลังที่ไม่มีหลักฐานเวลาเริ่ม Build ใหม่แสดงเป็น candidate และยังไม่ปิด Fail
- ยกเลิกและกำลังทำไม่ปิด Fail กำลังลองใหม่ต้องเป็นสถานะล่าสุดในกลุ่มย่อยและเป็นงานหลัง Fail
- Fail หลายครั้งก่อน success สามารถอ้าง success เดียวกัน จำนวนครั้งที่กลับมาสำเร็จคือจำนวน Fail ที่มี success ตามหลัง ไม่ใช่จำนวน success runs
- Retry Build ID เดิมแล้ว Fail ซ้ำโดยไม่มีสถานะคั่นกลางที่ตรวจพบ ไม่มี attempt ID ให้แยก จึงไม่อ้างว่าเก็บครบทุก retry

## หน้าเว็บ

แต่ละ Environment มีสรุป Project ยังมีปัญหา / กลับมาสำเร็จ / ทุก Project ค่าเริ่มต้นแสดงปัญหาค้าง มีจำนวน Build fail ค้าง, Deploy fail ค้าง, งานทั้งวัน, Fail, Fail ที่กลับมาสำเร็จ, งานล่าสุด, เวลา Fail ล่าสุด และระยะเวลาค้างนานสุด

กดชื่อ Project จากสรุปหรือการ์ดเปิดรายละเอียด Project + Environment + วันที่เดิม แสดงทุกประเภทและ Branch ของ Project นั้น โดยไม่ใช้ status filter หรือ search หน้าหลักตัดรายละเอียด มีตาราง Fail → Complete และทุก run/สถานะที่ตรวจพบเรียงล่าสุดก่อน Build เดิมเปลี่ยนสถานะแสดงหลายแถว แต่งานนับ Build ID ไม่ซ้ำ

ระยะเวลาค้างคำนวณ ณ เวลาอ่านข้อมูล วันอดีตหยุดนับที่สิ้นสุดวันนั้น ไม่มี timer/auto refresh เพิ่มเติม

## ข้อจำกัด

Complete เป็นผลจาก Monitor ไม่ใช่หลักฐาน CI/CD stage, Commit หรือ Artifact จาก Azure DevOps การจับคู่ยืนยันเพียงว่ากลุ่มงานเดียวกันมีงานสำเร็จภายหลัง ต้องอ่าน Azure DevOps เพิ่มเพื่อยืนยันเวอร์ชัน

การดึงทุก 1 นาทีอาจพลาดสถานะระหว่างรอบ ข้อมูลก่อนเริ่มเก็บที่ API ไม่ส่งแล้วกู้จาก index ไม่ได้ วันและเวลายึด LastUpdate/StartTime ของ Monitor ซึ่งไม่มี offset จึงสมมติเวลาไทยและเก็บต้นฉบับไว้
