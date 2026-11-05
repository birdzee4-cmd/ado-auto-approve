# ประวัติ Company Monitor บน Azure

## การทำงาน

- Azure Logic App `company-deployment-monitor-collector` เรียก `POST /api/company-monitor-collect` ทุก 1 นาที มี concurrency 1 และ retry แบบ exponential 3 ครั้ง
- Collector ต้องมี secret header `x-company-monitor-key` ที่ตรงกับ setting `COMPANY_MONITOR_COLLECT_KEY` เปรียบเทียบแบบ timing-safe; ไม่มี secret อยู่ใน JavaScript ฝั่งผู้ใช้
- API ต้นทางคงที่: `https://statoffice.buzzebees-dev.com/monitordeployment/getDeploymentStatus`; ไม่ส่ง cookie/token ของผู้ใช้ไปต้นทาง
- ใช้ connection string `COMPANY_MONITOR_STORAGE_CONNECTION_STRING` หรือ fallback ของ deployment events เดิม ตารางค่าเริ่มต้น `CompanyDeploymentArchive`
- ตัวอ่าน `GET /api/company-deployment-monitor?date=YYYY-MM-DD` ต้องเป็น role `it_support_approve` หรือ `admin` และอ่าน Storage เท่านั้น ไม่ต้องมีใครเปิดเว็บเพื่อให้ collector ทำงาน
- หน้า Monitor ใช้ปฏิทินเลือกวัน ค่าเริ่มต้นเป็นวันนี้ใน Asia/Bangkok เปลี่ยนวันแล้วโหลดประวัติใหม่ มีการป้องกันผลตอบกลับของวันที่เก่าทับวันที่ผู้ใช้เลือกใหม่ ไม่มี polling/auto refresh ของหน้าจอ

## ข้อมูลและความถูกต้อง

| Partition | เนื้อหา |
| --- | --- |
| `days` | RowKey วันที่; ชี้ไป snapshot ล่าสุดของวัน พร้อมเวลารวบรวมครั้งแรก/ล่าสุด จำนวนรายการสะสม และจำนวนรายการวันนั้นที่ API ส่งในรอบล่าสุด |
| `snapshot-<SHA256>` | snapshot แบบ content-addressed ที่ไม่เขียนทับประวัติก่อนหน้า; gzip/base64 แยก chunk ไม่เกิน 24,000 ตัวอักษร และ manifest `meta` ที่เขียนหลัง chunks ครบ |
| `polls-<วันเวลาไทยที่ตรวจ>` | ผลทุกการตรวจ: เวลาเริ่ม/เสร็จ สำเร็จ/ล้มเหลว จำนวนแถว และ SHA snapshot ของแต่ละวันที่พบ |
| `system` / `health` | เวลาเริ่มเก็บ ครั้งที่พยายามล่าสุด ครั้งที่สำเร็จล่าสุด และสถานะสำหรับแจ้งเตือนข้อมูลไม่ล่าสุด |

snapshot เก็บ raw JSON ของแต่ละรายการครบทุก field รวม field เพิ่มเติมที่ต้นทางอาจเพิ่มในอนาคต, normalized item, firstObservedAt และ lastChangedObservedAt คง TotalTime ต้นฉบับที่มีเศษวินาที และ StartTime/LastUpdate ต้นฉบับ ไม่แปลงทิ้ง

ใช้ environment ต้นทาง + raw BuildId เป็น identity และคง suffix `_M`/`_P`; numeric Azure BuildId เป็นอีก field สำหรับลิงก์ ห้ามใช้แทน identity

รวมรายการที่พบใหม่กับประวัติของวันนั้น ไม่ลบรายการเก่าเมื่อ API หยุดส่ง หาก raw JSON ไม่เปลี่ยนจะใช้ snapshot เดิม ถ้าเปลี่ยนจะสร้าง SHA ใหม่ ผลการตรวจทุกครั้งยังบันทึกแยกไว้ วันก่อนหน้าคง snapshot ของตนเองเมื่อรายการย้าย LastUpdate ไปวันใหม่

อ่าน chunk แล้วตรวจ SHA256 ก่อนส่งข้อมูล; เปลี่ยน pointer ของวันหลัง snapshot สมบูรณ์เท่านั้น ใช้ ETag ป้องกันการเขียนทับ pointer เมื่อมีงานซ้อน หากบางวันเขียนสำเร็จแล้ววันอื่นผิดพลาด ผล poll เป็น failed แต่แต่ละ snapshot ที่เผยแพร่แล้วมีข้อมูลครบของวันนั้น ไม่ใช่ธุรกรรมข้ามวันแบบ atomic

ไม่ตั้ง retention ลบข้อมูลอัตโนมัติ ตารางนี้ไม่ใช่ตารางเป้าหมายของ cleanup เดิม

## ขอบเขตความครบถ้วน

- เป็นประวัติของข้อมูล/สถานะที่ตรวจพบ ไม่ใช่ event stream ของทุก transition; สถานะที่เกิดและหายไประหว่างรอบ 1 นาทีอาจไม่ถูกพบ
- ยังไม่ยืนยัน endpoint ย้อนหลังของต้นทาง จึงเริ่มเก็บได้จากข้อมูลที่ API ยังส่งมา ณ เวลาเริ่มเท่านั้น ไม่สามารถเติมอดีตที่หายไปจากต้นทางโดยอัตโนมัติ
- วันของรายการอิง LastUpdate รูปแบบ DD/MM/YYYY HH:mm:ss โดยสมมติ +07:00 ตามหน้า Monitor บริษัท; raw time ไม่มี offset จึงเก็บต้นฉบับด้วย
- ยอดย้อนหลังเป็นจำนวนรายการสะสมที่เคยพบในวันนั้น อาจต่างจากหน้า live หากต้นทางลบ/หยุดส่งรายการ
- วันไม่มี snapshot แสดงว่า “ยังไม่มีข้อมูลที่บันทึกไว้” ไม่อ้างว่าวันนั้นไม่มีงาน หากตรวจล่าสุดล้มเหลวหรือไม่สำเร็จเกิน 5 นาที หน้าเว็บแจ้งข้อมูลอาจไม่ล่าสุด
- ทุกข้อมูลอยู่ใน Storage account เดิมที่เข้ารหัสตามบริการ Azure ไม่ทำสำเนา token/secret ของ browser ใน archive

## การ deploy และตรวจสอบ

1. `scripts/deploy-company-monitor-collector.ps1` สร้าง secret เฉพาะ collector หากยังไม่มี และ deploy Logic App แบบ Disabled โดยไม่แสดงค่า secret
2. Deploy โค้ด SWA และตรวจ endpoint ฝั่ง collector/read
3. เรียก script ด้วย `-EnableCollector` เพื่อเปิดทุก 1 นาที แล้วตรวจ Logic App run history ว่า action สำเร็จ
4. ตรวจ read API กับวันปัจจุบัน/วันไม่มีข้อมูล และตรวจ snapshot อ่านกลับผ่าน SHA ได้

Logic App ซ่อน inputs/outputs ของ HTTP action จาก run history เพื่อไม่ให้ header secret ปรากฏ ผู้ดูแลยังตรวจสถานะ/เวลาแต่ละ run ได้ Secret key ต้องไม่ถูกเก็บใน repo หรือ log
