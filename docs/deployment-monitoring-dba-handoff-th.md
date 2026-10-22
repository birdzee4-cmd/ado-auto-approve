# ข้อมูลที่ต้องยืนยันเพื่อเปิด G0: Deployment Monitoring

สถานะ 22 ตุลาคม 2026: **ยังไม่ผ่าน G0** เอกสารนี้เป็นแบบฟอร์มรอข้อมูล ไม่ใช่หลักฐานว่าตรวจ DB แล้ว ไม่ต้องส่ง password, connection string หรือแถวข้อมูลจริงในแชต/commit และยังไม่มีการส่งเอกสารนี้ให้บุคคลอื่นโดยอัตโนมัติ

## 1. ผู้อนุญาตและ UAT

| หัวข้อ | คำตอบจาก DBA/owner |
|---|---|
| ผู้อนุญาต / วันที่ / ticket หรือ evidence reference | รอยืนยัน |
| Environment ที่ยืนยันว่าเป็น UAT | รอยืนยัน |
| ที่อยู่ configuration/secret store ที่ผู้ปฏิบัติงานได้รับอนุญาตให้อ่าน | รอยืนยัน; ไม่ใส่ค่า secret |
| UAT identity และวิธี authentication ที่รองรับ | รอยืนยัน |
| Effective permissions และ role membership | รอยืนยัน SELECT เฉพาะ source ที่อนุมัติ; ไม่มีสิทธิ์เขียน/DDL/EXEC แบบครอบคลุม |
| Network route จาก SWA managed API หรือ hosting ที่อนุมัติ | รอยืนยัน |
| Trusted gateway / direct Functions host authentication restriction | รอยืนยัน |
| TLS hostname/certificate และ connection/query timeout/budget | รอยืนยัน; ไม่ bypass certificate validation |

## 2. Metadata ก่อนอ่านแถวข้อมูล

ใช้ [discovery SQL](sql/deployment-monitoring-discovery.sql) เฉพาะ metadata SELECT สามชุดแรก ได้แก่ sys.columns, indexes และ fn_my_permissions ภายใต้ connection/สิทธิ์ UAT ที่อนุญาต หยุดก่อน `DECLARE @From` และอย่ารันทั้งไฟล์ เนื่องจาก boundaries ส่วนข้อมูลด้านล่างสมมติ Bangkok local และยังไม่ยืนยัน

| ข้อสรุป | คำตอบ / หลักฐาน |
|---|---|
| Table/view ที่อนุมัติ | คาดหมาย dbo.Internal_ProjectPlanning; รอยืนยันจาก owner |
| จำนวน columns จริง / ข้อสรุป 49 เทียบ 57 | รอยืนยัน; metadata ไม่ครบอาจเกิดจาก visibility permission |
| ชื่อ/type/length/nullability/defaults/identity ที่ต้องใช้ | รอ metadata; inventory ในแผนไม่ใช่ live schema |
| PK/unique key และ ID uniqueness/non-null | รอยืนยัน; ไม่ถือว่า ID เป็น unique เพราะชนิด int |
| Indexes / filtered index / execution plan ที่เหมาะสม | รอยืนยันจาก DBA |
| SQL Server version / collation | รอยืนยัน |

หากต้องตรวจ duplicate/null/จำนวนข้อมูลนอก metadata ให้ DBA เลือก query และประเมินภาระก่อน ไม่ให้ full-table scan เป็นงานอัตโนมัติ

## 3. Time semantics, scope และ visibility

- ระบุว่าแต่ละ datetime เก็บ UTC หรือ local timezone ใด รวม SubmitDate, TargetDate, CompletedDate, CreatedDate, LastModifiedDate และ StageOne–FourDate
- ยืนยันการแปลงช่วงวัน Bangkok เป็น SQL boundaries `[from,toExclusive)` ก่อนใช้ส่วนข้อมูลใน discovery; วันที่ตัวอย่างในไฟล์ไม่ใช่วันที่ UAT โดยอัตโนมัติ
- ระบุ deployment scope/row visibility ของแต่ละ role; ไม่มี Environment column จึงห้ามเดาจาก Server หรือ DeployType
- อนุมัติ field allowlist แยก list/detail/summary และระบุ fields ที่ห้ามส่ง browser โดยเฉพาะ paths, backup code/files, documents, links, JSON และข้อมูลบุคคล

| Field / operation | Allowed roles / row scope | การแสดงผลหรือ redaction | ผู้อนุมัติ / evidence |
|---|---|---|---|
| รอ owner ระบุ | รอยืนยัน | รอยืนยัน | รอยืนยัน |

## 4. Code mapping จาก source app/lookup

กรอกเฉพาะรหัสที่ตรวจจากแหล่งจริง ไม่ใช้ค่าจาก synthetic preview เป็น mapping รักษา raw code และแยก null จาก 0 หากยังไม่มีนิยาม outcome ต้องยืนยันว่าจะรับ unknown อย่างชัดเจน และยังไม่คำนวณ success rate/overdue

| Field | Raw code / null | Label | Category / terminal (ถ้าเกี่ยวข้อง) | Source / owner / mapping version |
|---|---|---|---|---|
| Status | รอยืนยัน | รอยืนยัน | รอยืนยัน | รอยืนยัน |
| DeployType | รอยืนยัน | รอยืนยัน | รอยืนยัน scope/environment แยก | รอยืนยัน |
| GetType | รอยืนยัน | รอยืนยัน | รอยืนยัน | รอยืนยัน |
| Priority | รอยืนยัน | รอยืนยัน | รอยืนยัน | รอยืนยัน |

ยืนยันชื่อและความหมาย stage รวมความหมายของ IsPrepared และ CompletedDate โดยไม่อนุมาน success จาก timestamp หรือ readiness

## 5. ผล discovery ข้อมูลหลังได้รับอนุญาต

ให้ DBA/owner ทวนส่วนข้อมูล A/B/C หลังยืนยัน metadata/timezone/scope และค่า parameters แล้ว เก็บผลจริงในพื้นที่จำกัดสิทธิ์ ส่งกลับเฉพาะ reference/ข้อสรุปที่ปกปิดข้อมูลบุคคล:

- วันปฏิทินที่ใช้เทียบ source app และ boundaries หลังแปลงตาม timezone DB
- distribution และตัวอย่างตาม raw status ใน 30 วันตามภาระที่อนุมัติ
- ID 52844: พบหนึ่งรายการ/ไม่พบ/พบซ้ำ และข้อสรุปจาก owner; ห้ามสร้างแถวแทนผลจริง
- known nulls, tie timestamps, unknown codes และ data quality ที่มีผลต่อ paging/summary
- ขอบเขต workload, p95/payload/connection budget และวิธีวัด UAT ที่ตกลง

## 6. สรุป gate

- [ ] UAT identity/network/SELECT-only และ trusted-host boundary ยืนยันแล้ว
- [ ] schema 49/57, key/uniqueness, datetime timezone และ deployment scope ยืนยันแล้ว
- [ ] field/row visibility ได้รับอนุมัติ
- [ ] mapping มี owner/evidence/version หรือ owner ยอมรับ unknown โดยชัดเจน
- [ ] อนุญาตและตรวจ UAT connectivity/SELECT สำเร็จ พร้อม evidence reference

เมื่อข้อมูลครบจึงทำ production SQL adapter, parameterized queries/pool/driver, registered API และการแทนหน้าจริงตามลำดับในแผน การให้ข้อมูล G0 ไม่ใช่ UAT signoff หรือ production release approval และไม่อนุญาต push/merge/deploy production โดยอัตโนมัติ
