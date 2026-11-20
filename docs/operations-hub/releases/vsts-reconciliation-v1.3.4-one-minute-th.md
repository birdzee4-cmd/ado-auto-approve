# Operations Hub VSTS Reconciliation v1.3.4 — One-minute Auto-Restart check

แพ็กเกจ: `artifacts/power-automate/OperationsHub-VSTS-Reconciliationv1.3.4-AutoRestart-1Min-Import.zip`

ปรับ Recurrence ของ v1.3.3 จากทุก 10 นาทีเป็นทุก 1 นาที และคง Concurrency เป็น 1 เพื่อให้เรียก `/api/operations-reconcile` ใกล้เวลาครบ 5 นาทีมากขึ้น โดยลดโอกาสที่ P1 จะ Resolved ก่อนรอบตรวจ

หลัง Import ให้ปิด v1.3.3 ก่อนเปิด v1.3.4 และคงค่าเดิมของ:

- `operationsReconcileEndpoint`
- `operationsAutomationKey`

ห้ามเปิด v1.3.3 และ v1.3.4 พร้อมกัน เพราะจะทำให้ Reconciliation ทำงานซ้ำ
