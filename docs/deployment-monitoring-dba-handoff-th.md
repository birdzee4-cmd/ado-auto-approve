# ข้อมูลที่ต้องยืนยันเพื่อเปิด G0: Deployment Monitoring

สถานะ 22 ตุลาคม 2026: **ยังไม่ผ่าน G0** เอกสารนี้เป็นแบบฟอร์มรอข้อมูล ไม่ใช่หลักฐานว่าตรวจ DB แล้ว ไม่ต้องส่ง password, connection string หรือแถวข้อมูลจริงในแชต/commit และยังไม่มีการส่งเอกสารนี้ให้บุคคลอื่นโดยอัตโนมัติ

## 1. ผู้อนุญาตและ UAT

| หัวข้อ | คำตอบจาก DBA/owner |
|---|---|
| ผู้อนุญาต / วันที่ / ticket หรือ evidence reference | รอยืนยัน |
| Environment ที่ยืนยันว่าเป็น UAT | รอยืนยัน |
| UAT server/instance/FQDN และ port | รอยืนยัน; ใส่ในเอกสารจำกัดสิทธิ์หรือให้ configuration reference |
| UAT database | รอยืนยัน; ไม่ใช้ production ทดแทน |
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

### รูปแบบผลลัพธ์ที่ส่งกลับ

ส่งเป็น UTF-8 CSV แยก result set พร้อม Markdown สรุป owner/date/environment/query parameters/evidence reference ในพื้นที่จำกัดสิทธิ์ที่ทีมเข้าถึงได้ ไม่ commit ผลจริงเข้า repository และไม่แนบ credential/connection string หรือชื่อบุคคลในไฟล์ กรณีไม่อนุญาตส่งแถว ให้ส่งเฉพาะข้อสรุปและ reference ที่ผู้ตรวจได้รับสิทธิ์แทน

| ชื่อผลลัพธ์ที่เสนอ | SQL ที่ต้องรัน / headers หรือเนื้อหา |
|---|---|
| `01-columns.csv` | metadata SELECT แรก: column_id,name,type_name,declared_length,is_nullable,is_identity,precision,scale; ส่งทุก column ที่เห็นจริง ห้ามตัดให้เหลือ 49 |
| `02-indexes.csv` | metadata SELECT สอง: name,is_unique,is_primary_key,type_desc,key_ordinal,is_included_column,column_name; DBA ระบุเพิ่มว่า filtered/disabled หรือไม่ และ constraint ใดยืนยัน uniqueness ได้จริง |
| `03-permissions.csv` | metadata SELECT สาม: permission_name; แนบข้อสรุป effective permissions/role membership จาก DBA เพราะ SELECT ที่มีอยู่ไม่ได้พิสูจน์ว่าไม่มี write permission โดยลำพัง |
| `04-source-decisions.md` | column count 49/57, SQL version/collation, key/PK/nullability/defaults, timezone ราย field และ source evidence; defaults/filtered indexes/version ไม่ได้อยู่ครบใน SQL ที่แนบ ให้ DBA ใช้วิธี metadata ที่อนุมัติเพิ่ม ห้ามแปลผลว่ายืนยันแล้วจาก result sets แรกเพียงอย่างเดียว |
| `05-today-redacted.csv` | ส่วน A หลังอนุมัติ: headers ตาม SELECT TOP (100) ในไฟล์; ProjectName ใช้ token สังเคราะห์ที่สม่ำเสมอ ไม่ส่งชื่อบุคคล/ข้อมูลลับแฝงในชื่อโครงการ |
| `06-code-distribution.csv` | ส่วน B: Status,DeployType,GetType,Priority,record_count; คง null แยกจาก 0 และไม่อนุมาน label จากจำนวน |
| `07-status-samples-redacted.csv` | CTE samples ในส่วน B: ID,TargetDate,Status,IsPrepared,CompletedDate,StageOneDate,StageTwoDate,StageThreeDate,StageFourDate; ไม่เกิน 5 ต่อ raw Status ตาม SQL; ไม่เพิ่ม full row projection |
| `08-reference-id.md` | ส่วน C: ID 52844 พบหนึ่ง/ไม่พบ/ซ้ำ พร้อม owner verification; เก็บผลแถวเต็มของ projection นี้เฉพาะพื้นที่อนุญาต และส่ง summary แทนหากยังไม่อนุมัติ field visibility |
| `09-mapping.csv` | field,raw_code,is_null,label_th,category,is_terminal,mapping_version,owner_evidence; mapping ของ Status/DeployType/GetType/Priority ตามข้อ 4 โดย non-applicable ใช้ null ไม่สร้างความหมายขึ้นเอง |
| `10-visibility.csv` | operation,field,allowed_roles,row_scope,display_rule,owner_evidence; list/detail/summary ต้องสอดคล้องกันและ owner อนุมัติ |

CSV ใช้ blank field เป็น SQL NULL พร้อมระบุ convention นี้ในสรุป; empty string ที่เป็นค่าจริงให้ระบุแยกใน schema notes ไม่แทน null ด้วยเลข 0 โดยเฉพาะ mapping ให้ใช้ is_null=true แยกจาก raw_code=0 อย่างชัดเจน วันที่ในผลให้คง wall-clock ตาม DB จนกว่า timezone ได้รับการยืนยัน; ระบุ convention และ precision ของทุก datetime ในสรุป ห้ามเติม Z ให้ข้อมูล local โดยอัตโนมัติ

สรุปที่แนบต้องมี `G0: pending/confirmed` พร้อมผู้รับรองและหลักฐานแยกรายข้อ ข้อที่ยังไม่ตรวจเขียน pending; owner ต้องยืนยันการรับ unknown โดยชัดเจนหาก mapping ยังไม่ครบ ไม่ใช้ผล preview/unit test แทนผล UAT

## 6. สรุป gate

- [ ] UAT identity/network/SELECT-only และ trusted-host boundary ยืนยันแล้ว
- [ ] schema 49/57, key/uniqueness, datetime timezone และ deployment scope ยืนยันแล้ว
- [ ] field/row visibility ได้รับอนุมัติ
- [ ] mapping มี owner/evidence/version หรือ owner ยอมรับ unknown โดยชัดเจน
- [ ] อนุญาตและตรวจ UAT connectivity/SELECT สำเร็จ พร้อม evidence reference

เมื่อข้อมูลครบจึงทำ production SQL adapter, parameterized queries/pool/driver, registered API และการแทนหน้าจริงตามลำดับในแผน การให้ข้อมูล G0 ไม่ใช่ UAT signoff หรือ production release approval และไม่อนุญาต push/merge/deploy production โดยอัตโนมัติ
