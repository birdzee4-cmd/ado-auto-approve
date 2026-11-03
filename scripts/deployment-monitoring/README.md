# UAT connection / permissions probe

## Module-reference metadata mode

เพิ่ม `-ModuleMetadataApproved` / `--module-metadata-approved` ตามอนุมัติผู้ใช้เพื่อค้นเฉพาะ module names/types ที่อ้าง target table โดยไม่ execute module หรือคืน definition SQL มี SELECT ตรวจ VIEW DEFINITION flags, declared dependencies และ text-reference candidates ใน sys.sql_modules จำกัด 301 records และไม่อ่าน source-table rows เลือก discovery scope ได้ครั้งเดียวและต้องมี ConnectApproved จึงเชื่อมจริง

ผลภายใต้ identity ที่ตรวจ: ไม่มี VIEW DEFINITION ทั้งระดับ database และ target object และทั้ง declared/text-reference result sets ไม่คืนรายการที่มองเห็นได้ จึงห้ามสรุปว่าไม่มี module หรือไม่มี mapping ใน DB และห้ามยกระดับสิทธิ์หรือขยาย SQL เอง ทางต่อคือตรวจผ่าน DBA/owner ที่มีสิทธิ์ metadata เหมาะสม หรือขออนุมัติตรวจ source-app ที่พบแยกต่างหาก G0 ยัง pending ไม่มีการ execute procedure/function/view หรืออ่านแถวข้อมูลจากการค้นนี้

สถานะ: รุ่นก่อนเพิ่ม diagnostic ผ่าน compile/plan-only ด้วย JDK 21.0.12.1 แล้ว และลอง connection หนึ่งครั้งตามอนุมัติ แต่จบด้วย exit 3 ก่อนมีข้อความ Connection established หรือผล permission SELECT จึงยังไม่มีหลักฐานว่า login/SELECT สำเร็จ G0 ยัง pending ไม่มีการทดลองเขียนข้อมูลหรือใช้ production ทดแทน

รุ่น stage diagnostic ผ่าน offline plan-only แล้ว และลอง connection ครั้งที่สองตามอนุมัติ จบด้วย CONNECT_AUTH / SQLState unavailable / vendorCode 0 ยังไม่มีผล permission SELECT และผู้ใช้ไม่เห็นหน้า sign-in/MFA จากนั้นเพิ่ม cause-type diagnostic ตามอนุมัติ โดยยังไม่อนุมัติการเชื่อมต่อครั้งที่สาม การอนุมัติแก้โค้ด/ตรวจ offline ไม่ใช่อนุมัติ retry

ต่อมาผู้ใช้อนุมัติการเชื่อมต่อครั้งที่สามด้วย cause-type diagnostic แล้ว ผลยังเป็น CONNECT_AUTH / SQLState unavailable / vendorCode 0 โดยพบเพียง SQLServerException ไม่มี cause ซ้อน จึงหยุดโดยไม่ retry การตรวจ DBeaver แบบ non-secret พบ explicit encrypt=true และ ActiveDirectoryInteractive แต่ไม่พบ explicit hostname/timeout/proxy จึงยังสรุปสาเหตุไม่ได้

## ขอบเขต

- `UatReadOnlyProbe.java` ใช้ JDBC/Entra interactive MFA ไม่มี user/password/token arguments และไม่อ่าน DBeaver connection/secure storage
- `Invoke-UatReadOnlyProbe.ps1` รับ server/database/Java/JAR classpath ที่อนุมัติจากผู้เรียก ไม่ค้นหาหรือดาวน์โหลด dependencies เอง
- ค่าเริ่มต้นเป็น **plan-only** พิมพ์ target และ fixed SQL แล้วจบก่อน load JDBC driver; แม้ plan-only ก็เป็นการรัน Java source จึงต้องขออนุมัติก่อนรัน
- เฉพาะเมื่อระบุ `-ConnectApproved` หลังได้รับอนุมัติจึงเปิด connection และรัน prepared SELECT **หนึ่งคำสั่ง** ใน Java source ไม่มี arbitrary SQL/file input หรือ query แถวข้อมูลใน Internal_ProjectPlanning
- SQL ตรวจ database context, SELECT/INSERT/UPDATE/DELETE/ALTER/CONTROL flags และ role indicators เท่านั้น ผลเป็นตัวเลขหรือ unknown ไม่มีชื่อ principal/แถวข้อมูล ไม่ทดลอง INSERT/UPDATE/DELETE เพื่อทดสอบสิทธิ์
- `applicationIntent=ReadOnly` เป็น routing intent ไม่ได้บังคับสิทธิ์บัญชี ต้องใช้ SELECT-only identity และให้ DBA ตรวจ role membership/สิทธิ์ประกอบ
- TLS เปิด encrypt และตรวจ certificate ไม่มี trust bypass, authentication fallback, production fallback หรือ retry loop (`connectRetryCount=0`)
- ถ้าพบ broad rights, SELECT หาย, database mismatch หรือ unknown ให้หยุด (exit 4) ไม่รัน discovery ต่อ บาง Azure SQL role flags อาจเป็น unknown ให้ DBA ตีความ ไม่แปลเป็น false อัตโนมัติ
- แม้ flags ผ่านก็ยังไม่ยืนยัน least privilege ทั้งระบบ/schema/timezone/mapping หรือ G0; metadata discovery ต้องขออนุมัติแยก
- ไม่เขียน report/credential/token/connection string ลงไฟล์เอง; runtime/JDBC/MSAL อาจใช้ OS temporary resources และ interactive browser session ระหว่าง login จึงไม่อ้างว่า runtime ไม่มีผลต่อไฟล์/session ใด ๆ เลย
- Diagnostic แสดงเฉพาะ application stage ล่าสุด, SQLState ที่ผ่านรูปแบบ `[A-Z0-9]{5}` และ vendor error code ตัวเลข หากไม่มีให้แสดง unavailable ไม่แสดง exception message/cause/stack trace หรือ secrets; stage CONNECT_AUTH ไม่ได้แยกว่า TCP/TLS/Entra/database login ส่วนใดล้มเหลวแน่ชัด
- Cause-type diagnostic แสดงเฉพาะชื่อคลาสที่อยู่ใน SAFE_EXCEPTION_TYPES ใน Java source ชนิดอื่นแสดง unlisted ไม่พิมพ์ชื่อจริง จำกัดลำดับ cause ไม่เกิน 6 ชั้นและกัน cycle ไม่แสดง message ของ cause หรือ token/URL/request payload; ยังไม่รับรองว่าจะระบุ root cause ได้หาก driver ไม่แนบ cause
- Message-hint diagnostic ตรวจข้อความในหน่วยความจำไม่เกิน 10,000 ตัวอักษรต่อ cause/6 ชั้น แล้วแสดงเฉพาะค่าคงที่ CERTIFICATE_HINT/TLS_HINT/DEPENDENCY_HINT/BROWSER_HINT/NETWORK_HINT/AUTHENTICATION_HINT หรือ UNCLASSIFIED ไม่ส่ง substring หรือข้อความจริงออกทาง output/file คำใบ้อาจซ้อนกันหรือคลาดเคลื่อน ไม่ใช่ข้อยืนยัน root cause
- Offline `java UatReadOnlyProbe.java --self-test` compile และตรวจ 7 synthetic classification cases กับ redaction 1 กรณีโดยไม่โหลด driver/login/เชื่อม DB; ต้องได้รับอนุมัติก่อนรันเช่นกัน

## การแก้ปัญหา interactive timeout

หลังผู้ใช้อนุมัติให้ดำเนินการจนเชื่อมต่อได้ ตรวจ HTTPS นอก sandbox ด้วย .NET สำเร็จ HTTP 200 และด้วย Java สำเร็จทั้ง login.microsoftonline.com/login.windows.net โดยไม่แก้ proxy/TLS พบ Java Desktop/BROWSE รองรับและอยู่ Windows session เดียวกับ DBeaver

การตรวจสถานะของ Java probe (พิมพ์เฉพาะชื่อ method ที่เกี่ยวข้อง ไม่พิมพ์ thread names/arguments) พบ MSAL รอ HTTP listener ของ interactive flow และพบแท็บ Microsoft sign-in ใน Chrome แต่ driver 13.4 จำกัด wait ของ interactive result ประมาณ 20 วินาทีตาม source ทางการ จึงเปลี่ยน probe เป็น supported access-token callback ที่เรียก MSAL interactive เดิมด้วย public JDBC client ID เดิมและ scope จาก server โดยรอได้ 240 วินาที login timeout 300 วินาที

- Callback ยอมรับเฉพาะ HTTPS authorities login.windows.net/login.microsoftonline.com และ scope database.windows.net ตรวจ hostname/certificate ของ SQL เหมือนเดิม ไม่ใช้ service principal/password และไม่ขยาย scopes จาก flow เดิม
- Credential ส่งจาก MSAL ไป JDBC ภายใน process เท่านั้น ไม่ print/save/inspect และไม่อ่าน token cache ของ DBeaver ไม่มี cache persistence handler ของ probe
- Authentication callback เรียกได้ครั้งเดียวต่อ probe ไม่มี retry loop และยกเลิก pending future/ปิด executor หลังจบหรือ timeout
- เนื่องจากใช้ typed JDBC/MSAL APIs ต้องส่ง classpath ที่ครบทั้ง JDBC/MSAL/transitive JARs แม้ compile offline; ตัวอย่างคำสั่งเดิมที่มีแค่ JDBC JAR ไม่เพียงพอแล้ว
- `--public-https-check` อ่าน public metadata สอง endpoints ข้างต้นเท่านั้น ไม่ login/SQL; `--browser-check` ตรวจ Desktop/BROWSE capability ไม่เปิด browser ทั้งสองโหมดต้องอยู่ในขอบเขตที่อนุมัติก่อนรัน
- SQL ตรวจสิทธิ์เดิมไม่เปลี่ยน ไม่มี query แถวข้อมูล ยังต้องรอผล MFA/permission flags ก่อนสรุปการเชื่อมต่อ และ G0 ไม่ผ่านจากการพบหน้า login เพียงอย่างเดียว

## Metadata-only mode

ผู้ใช้อนุมัติ metadata discovery แยกแล้ว จึงเพิ่ม `-MetadataApproved` / `--metadata-approved` สำหรับ SELECT columns, indexes/PK และ object permissions เท่านั้น หลังตรวจ permission flags ผ่านและมี `-ConnectApproved` ด้วย หากไม่มี ConnectApproved จะยังเป็น plan-only

ใช้คำสั่ง metadata สามชุดแรกจาก `docs/sql/deployment-monitoring-discovery.sql` โดย bind object name และเพิ่ม index flags is_disabled/has_filter เพื่อแยก unique index ที่ไม่ครอบคลุมทั้งตาราง ไม่โหลดหรือรันส่วน query แถวข้อมูลในไฟล์ SQL ดังกล่าว จำกัด metadata result set ไม่เกิน 5,000 แถว/ชุดและ query timeout 10s หากเกินหรือผิดพลาดให้หยุด

CSV output ใช้ `\\N` แทน NULL; raw metadata พิมพ์ออก process output เท่านั้น ไม่บันทึกลงไฟล์หรือ commit โดยอัตโนมัติ การเชื่อมต่อและ metadata อ่านสำเร็จแล้วตามอนุมัติ แต่ยังไม่ใช่ G0 signoff: timezone/รหัสธุรกิจ/field visibility และการเข้าถึงจาก API hosting ยังต้องยืนยัน ไม่อ่านแถวข้อมูลหรือขยาย SQL ต่อเอง

## Extended-property / foreign-key mode

ผู้ใช้อนุมัติแยกให้ค้นคำอธิบาย timezone/รหัสและ lookup references จึงเพิ่ม `-SemanticsApproved` / `--semantics-approved` ใช้ร่วมกับ ConnectApproved และเลือกแยกจาก MetadataApproved (ส่งพร้อมกันถูก reject ก่อน connect) ตรวจสิทธิ์เดิมก่อน SELECT เฉพาะ sys.extended_properties และ foreign-key metadata ที่ผูกกับ target table ไม่มี query แถวข้อมูล

แสดงค่า extended property เฉพาะชื่อ description/timezone/code-mapping ที่อยู่ใน allowlist ชื่อ property อื่นแสดง value เป็น NULL และปกปิด value ที่เข้า pattern credentials/token เพื่อไม่เผยข้อมูลลับแฝงในคำอธิบาย ไม่มีการเก็บ raw results ลงไฟล์

ผลครั้งที่ได้รับอนุมัติ: permission flags ผ่าน และ result sets ของ extended properties กับ foreign keys เป็น 0 แถวภายใต้ identity นี้ ไม่ถือว่า metadata ของทั้งระบบไม่มีหรือยืนยัน visibility ครบ ยังไม่มีหลักฐาน timezone/mapping เพิ่มจากผลนี้ ห้ามอนุมาน code meanings หรือผ่าน G0 และห้ามค้น schema อื่น/อ่าน lookup rows โดยไม่มีอนุมัติขอบเขตถัดไป

## Lookup-candidate metadata mode

ผู้ใช้อนุมัติแยกให้ค้นชื่อตาราง/คอลัมน์ที่อาจเกี่ยวกับ Status/DeployType/GetType/Priority จึงเพิ่ม `-LookupMetadataApproved` / `--lookup-metadata-approved` เลือกได้เพียงหนึ่ง discovery scope ต่อครั้ง และต้องมี ConnectApproved จึงเชื่อมจริง หลังตรวจสิทธิ์เดิมแล้ว SELECT เฉพาะ sys.tables/schemas/columns/types ของตารางที่ตรงเงื่อนไขชื่อหรือ planning/lookup ที่มีคอลัมน์ชื่อรหัสที่กำหนด ไม่อ่าน lookup data rows

จำกัด TOP 301 metadata records และแจ้ง potentially truncated เมื่อถึง cap ไม่ขยายเงื่อนไขเอง ผลครั้งที่อนุมัติได้ 90 metadata records โดยไม่ได้อ่านข้อมูลภายในตาราง ข้อสรุปมีเพียงรายชื่อ candidates ไม่ใช่ code meanings หรือข้อยืนยันว่าตารางใดเป็น lookup ของ source จริง ยังต้องให้ owner/source-app ยืนยันความเกี่ยวข้อง, mapping และ timezone และ G0 ยัง pending ไม่มีการบันทึก raw metadata ลงไฟล์หรือ commit อัตโนมัติ

อ้างอิง: [JDBC 13.4 interactive wait](https://github.com/microsoft/mssql-jdbc/blob/v13.4.0/src/main/java/com/microsoft/sqlserver/jdbc/SQLServerMSAL4JUtils.java), [Microsoft JDBC callback](https://learn.microsoft.com/en-us/sql/connect/jdbc/connecting-using-azure-active-directory-authentication)

## ตรวจทานก่อนขอรัน

1. ระบุ UAT server/port/database ในคำขออนุมัติจริง ไม่ hardcode ใน source
2. ตรวจ fixed SQL ใน Java source: bind ชื่อ database เป็น parameter ไม่รับ SQL เพิ่ม
3. ตรวจ Java/JDBC/MSAL dependencies และ classpath แต่ละไฟล์ที่อนุมัติ ไม่ถือว่าพบ MSAL แล้ว dependencies ครบ
4. ผู้ใช้ทำ Entra/MFA เอง ไม่ให้ agent อ่านหรือกรอก password/token
5. login timeout 180s, query 10s, cancel 5s ยังไม่ทดสอบจริง หาก TLS/dependencies/auth ล้มเหลวให้หยุด ไม่แก้ config หรือ retry เอง

## รูปแบบคำสั่งเพื่อขออนุมัติขั้นถัดไป

นี่เป็น placeholder ไม่ใช่คำสั่งที่รันแล้ว classpath เป็น approved JARs คั่นด้วย `;` บน Windows ไม่มี credentials ใน arguments

```powershell
# Offline plan-only: ต้องอนุมัติก่อนรันเช่นกัน
& ./scripts/deployment-monitoring/Invoke-UatReadOnlyProbe.ps1 `
  -Server '<approved-UAT-server>' -Database '<approved-UAT-database>' `
  -JavaExe '<approved-java.exe>' -JdbcClasspath '<approved-jar1>;<approved-jar2>'

# หลังอนุมัติ login + fixed permission SELECT โดยเฉพาะ จึงเพิ่ม -ConnectApproved
```

การอนุมัติสร้างสคริปต์ไม่ใช่อนุมัติรัน/เชื่อม DB และไม่รวม commit/push/PR/deploy หรืออ่าน config/secrets เพิ่ม

อ้างอิง: [Microsoft JDBC properties](https://learn.microsoft.com/en-us/sql/connect/jdbc/setting-the-connection-properties), [Microsoft Entra authentication](https://learn.microsoft.com/en-us/sql/connect/jdbc/connecting-using-azure-active-directory-authentication)
