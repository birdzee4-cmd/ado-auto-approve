-- Deployment Monitoring: discovery แบบอ่านอย่างเดียว ให้ DBA ตรวจ/รันบน UAT ก่อน
-- ไม่มี credentials, DDL, DML, NOLOCK; ผลอาจมีข้อมูลบุคคล ห้าม commit ผลจริง
-- metadata อาจไม่ครบเมื่อ principal ไม่มี metadata visibility; ห้ามถือว่า column หายทันที
SELECT c.column_id, c.name, t.name AS type_name,
       CASE WHEN t.name IN ('nvarchar','nchar') AND c.max_length > 0
            THEN c.max_length / 2 ELSE c.max_length END AS declared_length,
       c.is_nullable, c.is_identity, c.precision, c.scale
FROM sys.columns AS c
JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.Internal_ProjectPlanning')
ORDER BY c.column_id;

SELECT i.name, i.is_unique, i.is_primary_key, i.type_desc,
       ic.key_ordinal, ic.is_included_column, c.name AS column_name
FROM sys.indexes AS i
JOIN sys.index_columns AS ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
JOIN sys.columns AS c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE i.object_id = OBJECT_ID(N'dbo.Internal_ProjectPlanning')
ORDER BY i.index_id, ic.index_column_id;

SELECT permission_name
FROM fn_my_permissions(N'dbo.Internal_ProjectPlanning', N'OBJECT');

-- STOP: ยืนยัน metadata และ timezone กับ DBA ก่อนรัน query ข้อมูลด้านล่าง
-- ตัวอย่างนี้สมมติ TargetDate เก็บ Bangkok local datetime เท่านั้น
-- ถ้าเก็บ UTC ต้องแปลง boundaries เป็น UTC ก่อน ห้ามใช้ค่าท้องถิ่นนี้โดยตรง
DECLARE @From datetime = '2026-10-22T00:00:00';
DECLARE @ToExclusive datetime = '2026-10-23T00:00:00';
DECLARE @RecentFrom datetime = DATEADD(day, -29, @From);

-- A: งานวันนี้ จำกัด 100; เปลี่ยน parameter ตามวันที่ UAT ไม่ใช้ GETDATE ของ host
SELECT TOP (100) ID, ProjectName, TargetDate, Status, IsPrepared,
       DeployType, Priority, CompletedDate, LastModifiedDate
FROM dbo.Internal_ProjectPlanning
WHERE TargetDate >= @From AND TargetDate < @ToExclusive
ORDER BY TargetDate DESC, ID DESC;

-- B: distribution 30 วัน รวมวันนี้; ไม่อนุมานความหมายรหัสจาก counts
SELECT Status, DeployType, GetType, Priority, COUNT_BIG(*) AS record_count
FROM dbo.Internal_ProjectPlanning
WHERE TargetDate >= @RecentFrom AND TargetDate < @ToExclusive
GROUP BY Status, DeployType, GetType, Priority;

;WITH samples AS (
    SELECT ID, TargetDate, Status, IsPrepared, CompletedDate,
           StageOneDate, StageTwoDate, StageThreeDate, StageFourDate,
           ROW_NUMBER() OVER(PARTITION BY Status ORDER BY TargetDate DESC, ID DESC) AS rn
    FROM dbo.Internal_ProjectPlanning
    WHERE TargetDate >= @RecentFrom AND TargetDate < @ToExclusive
)
SELECT ID, TargetDate, Status, IsPrepared, CompletedDate,
       StageOneDate, StageTwoDate, StageThreeDate, StageFourDate
FROM samples WHERE rn <= 5
ORDER BY Status, TargetDate DESC, ID DESC;

-- C: ตรวจ ID ที่อ้างในแชต เฉพาะ projection สำหรับ discovery
SELECT ID, ProjectName, TargetDate, Status, IsPrepared, DeployType, GetType,
       Priority, CompletedDate, StageOneDate, StageTwoDate, StageThreeDate,
       StageFourDate, LastModifiedDate
FROM dbo.Internal_ProjectPlanning WHERE ID = 52844;

-- ไม่รัน full-table duplicate/null/count scan อัตโนมัติ
-- ให้ DBA ตรวจ PK/unique constraint และเลือกวิธีตรวจคุณภาพข้อมูลตาม execution plan
