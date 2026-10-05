# Operations Hub Alert Events — Rollout Runbook

ระบบนี้เก็บ FIRING/RESOLVED event ก่อนทำ correlation และเริ่มใช้งานใน Shadow Mode โดย Flow เดิมยังเป็นผู้เขียน Incident ตามปกติ

## 1. Provision SharePoint

```powershell
.\scripts\provision-operations-alert-events.ps1
```

ตั้งค่า Static Web App:

```text
OPERATIONS_ALERT_EVENTS_LIST_NAME=Operations Hub Alert Events
OPERATIONS_ALERT_EVENT_WRITE_ENABLED=false
```

ใช้ `OPERATIONS_AUTOMATION_KEY` เดิมสำหรับ header `x-operations-automation-key`; ห้ามเก็บค่าจริงลง Git

## 2. Deploy และ Shadow Mode

1. Deploy API/UI โดยคง `OPERATIONS_ALERT_EVENT_WRITE_ENABLED=false`.
2. Import `OperationsHub-AlertLifecycleReconciliation-v1.0.7-Shadow.zip` เป็นสำเนา Flow.
3. ตั้ง parameter `operationsAutomationKey` และตรวจ endpoint ก่อนเปิด Flow.
4. ยืนยันว่า event ถูกสร้างใน List และ Incident ไม่ถูก API เขียน.
5. เปรียบเทียบ `MATCHED/UNMATCHED/AMBIGUOUS` กับผลของ Flow เดิมอย่างน้อย 7 วัน.

## 3. Live Mode

เมื่อ UAT ผ่าน ให้ตั้ง `OPERATIONS_ALERT_EVENT_WRITE_ENABLED=true`. Scheduled reconciliation จะนำ event `MATCHED` และ retryable events มาประมวลผล โดยจำกัด 20 รายการต่อรอบและสูงสุด 5 attempts.

หน้า `Alert Events` ใน Operations Hub ใช้สำหรับ Dry Run, Confirm Match, Reject และตรวจ error. Manual confirmation ไม่ปิด ADO Work Item หรือ Operations Incident อัตโนมัติ.

## Rollback

ตั้ง `OPERATIONS_ALERT_EVENT_WRITE_ENABLED=false` ทันทีและคง Event ingestion เปิดไว้ ข้อมูลที่รับแล้วจะยังอยู่ใน SharePoint และ Flow v1.0.6 เดิมยังทำงานต่อได้.
