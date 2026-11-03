# Outlook folder: NowAlert_AppService

วันที่ 9 ตุลาคม 2026 ผู้ดูแลเปลี่ยน Folder ใน Power Automate และบันทึก Flow ทั้งสองตัวแล้ว:

| Flow | ขั้นตอนที่อ่าน Outlook | ZIP export ที่เก็บไว้ |
| --- | --- | --- |
| Incident Automation | `When a new email arrives (V.B)` | `artifacts/power-automate/OperationsHub-IncidentAutomationv3.8.44.zip` |
| Alert Lifecycle Reconciliation | `Get RESOLVED Emails` | `artifacts/power-automate/OperationsHub-AlertLifecycleReconciliationv1.0.4.zip` |

ตรวจ `definition.json` ใน ZIP ทั้งสองแล้ว `folderPath` ใช้ Folder ID เดียวกัน (`Id::...AAZYUxveAAA=`) และ metadata ของ Folder นี้ระบุ `NowAlert_AppService` ทั้งคู่ Outlook connection ที่แสดงในหน้าจอเป็น `it-support@buzzebees.com` ค่า Search Query ของ Reconciliation ยังเป็น `RESOLVED`

ชื่อ ZIP เป็นเวอร์ชันที่ผู้ดูแลตั้งสำหรับเก็บ export แต่ชื่อ Flow และ `contentVersion` ภายใน ZIP ยังเป็น `v3.8.43` และ `v1.0.3` ตามลำดับ หากนำไป import ภายหลัง ให้ตรวจ Flow ที่เลือกอัปเดตและชื่อภายใน package ก่อนยืนยัน อย่าใช้ชื่อไฟล์ ZIP อย่างเดียวตัดสินเวอร์ชันภายใน

API รับข้อมูล alert ที่ Flow ส่งมาโดยไม่อ้างอิง Outlook folder จึงไม่ต้องเปลี่ยน endpoint หรือ request body สำหรับการย้ายโฟลเดอร์นี้ ชื่อ Teams channel และ alert name ที่มีคำว่า `AzureAppServiceHigh5xxRateCritical` เป็นคนละค่ากับชื่อ Outlook folder

หลังเปลี่ยน Folder ให้ตรวจ Run history จากเมล FIRING และ RESOLVED ใหม่อย่างละหนึ่งฉบับ เพื่อยืนยันการทำงานจริงของทั้งสอง Flow
