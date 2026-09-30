# Operations Hub SharePoint time migration — 2026-09-18

**สถานะ:** ดำเนินการแล้วและตรวจสอบค่ากลับจาก SharePoint REST เมื่อ 18 กันยายน 2026 เวลาไทย โดยแก้เฉพาะ ID 1, 3, 5 และ 6 ตามตารางด้านล่าง

## สาเหตุ

Flow v2.2 สร้างค่าเวลาจากอีเมลเป็น ISO ที่มี `+07:00` แล้ว SharePoint connector แปลงซ้ำ ทำให้ `FirstSeenAt` และ `ResolvedAt` ถูกเก็บเร็วเกินจริง 7 ชั่วโมง ส่วน `ReceivedAt`, Approval, ADO และ Last sync เก็บ UTC ถูกต้องอยู่แล้ว

## รายการที่ตรวจพบและแก้ได้อย่างชัดเจน

| SharePoint ID | Incident | ค่าเดิม FirstSeenAt | ค่าใหม่ FirstSeenAt | ค่าเดิม ResolvedAt | ค่าใหม่ ResolvedAt |
|---:|---|---|---|---|---|
| 1 | AzureAppServicePlanMemoryHighWarning | `2026-09-17T08:23:00Z` | `2026-09-17T15:23:00Z` | `2026-09-17T08:38:00Z` | `2026-09-17T15:38:00Z` |
| 3 | AzureAppServiceVerySlowCritical | `2026-09-17T17:38:00Z` | `2026-09-18T00:38:00Z` | `2026-09-17T17:53:00Z` | `2026-09-18T00:53:00Z` |
| 5 | AzureAppServiceVerySlowCritical | `2026-09-17T18:58:00Z` | `2026-09-18T01:58:00Z` | `2026-09-17T19:08:00Z` | `2026-09-18T02:08:00Z` |
| 6 | AzureAppServiceMemoryWorkingSetHighWarning | `2026-09-17T19:00:00Z` | `2026-09-18T02:00:00Z` | `2026-09-17T19:10:00Z` | `2026-09-18T02:10:00Z` |

ค่าใหม่ด้านบนเป็น UTC และจะแสดงใน Operations Hub เป็นเวลา Asia/Bangkok ที่ตรงกับอีเมลต้นทาง

## รายการที่ไม่ควรแก้อัตโนมัติ

- ID 2 มีลำดับเวลาต้นทางผิดปกติ: เมื่อชดเชย timezone แล้ว First Seen จะอยู่หลังเวลารับอีเมล และข้อมูลทดสอบเดิมมี Resolved At ไม่สอดคล้องกับ First Seen จึงต้องตรวจอีเมลต้นทางก่อน
- ID 4, 7 และ 8 เป็น FAILED records และไม่มี `FirstSeenAt/ResolvedAt`

## ขอบเขตการแก้

แก้เฉพาะ `FirstSeenAt` และ `ResolvedAt` ของ ID 1, 3, 5 และ 6 เท่านั้น ห้ามเปลี่ยน `IncidentId`, `ReceivedAt`, `ApprovalRequestedAt`, `ApprovalCompletedAt`, `AdoCreatedAt`, `LastSyncedAt` หรือข้อมูล ADO
