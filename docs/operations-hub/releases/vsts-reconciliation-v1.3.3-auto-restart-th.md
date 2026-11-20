# Operations Hub VSTS Reconciliation v1.3.3 — Auto-Restart API call

แพ็กเกจ: `artifacts/power-automate/OperationsHub-VSTS-Reconciliationv1.3.3-AutoRestart-Import.zip`

## สาเหตุที่แก้ไข

`Operations Hub - VSTS Reconciliation v1.3.2` ทำงานทุก 10 นาทีและซิงก์ Azure DevOps โดยตรง แต่ไม่ได้เรียก `/api/operations-reconcile` จึงไม่เข้าสู่เงื่อนไข Auto-Restart ของ P1 App Service

## การแก้ไข

v1.3.3 เรียก Operations Reconciliation API ก่อนเริ่ม VSTS sync ทุกครั้ง โดยถ้า API ล้มเหลว Flow จะยังทำ VSTS sync ต่อได้

หลัง Import ให้ตั้งค่า:

- `operationsReconcileEndpoint`: `https://mango-wave-09cff3700.7.azurestaticapps.net/api/operations-reconcile`
- `operationsAutomationKey`: ค่าเดียวกับ `OPERATIONS_AUTOMATION_KEY` ของ API

ห้ามเปิด v1.3.2 และ v1.3.3 พร้อมกัน เพราะจะทำให้ VSTS reconciliation ทำงานซ้ำ
