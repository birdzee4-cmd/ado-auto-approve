# ตั้งค่า Azure DevOps Deployment Webhook (UAT)

เอกสารนี้ใช้สำหรับเชื่อม Azure DevOps Service Hooks เข้ากับ ADO Auto Approve เพื่อเก็บสถานะ deployment โดยไม่แก้ไข Deployment Planning และไม่เรียกเปลี่ยนสถานะ pipeline กลับไปยัง Azure DevOps

## ความปลอดภัยก่อนเปิดใช้งาน

- ทดสอบใน UAT ก่อน Production
- endpoint รับ event คือ `POST https://<uat-host>/api/webhook`
- endpoint อ่านสถานะคือ `GET https://<uat-host>/api/ado-deployment-status` และจำกัด role เป็น `it_support_approve` หรือ `admin`
- ห้ามใส่ username, password, connection string หรือ payload จริงลง repository
- ค่าเริ่มต้น `ADO_DEPLOYMENT_EVENTS_ENABLED` ไม่ใช่ `true` ระบบจะรับ event และตอบ 200 แต่ไม่บันทึกข้อมูล
- การบันทึกเป็นตาราง event แยก ไม่ update ตาราง Deployment Planning

## Application settings สำหรับ UAT

| Setting | ค่า/วัตถุประสงค์ |
|---|---|
| `WEBHOOK_USERNAME` | username สำหรับ HTTP Basic Auth |
| `WEBHOOK_PASSWORD` | password สำหรับ HTTP Basic Auth |
| `ADO_DEPLOYMENT_EVENTS_ENABLED` | ตั้ง `true` เฉพาะเมื่อ UAT storage พร้อม |
| `ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING` | connection string ของ UAT Storage; หากไม่ตั้งจะใช้ `AzureWebJobsStorage` |
| `ADO_DEPLOYMENT_EVENT_TABLE` | ชื่อตาราง เช่น `AdoDeploymentEventsUat`; ค่าเริ่มต้นคือ `AdoDeploymentEvents` |

ต้องสร้างตารางไว้ล่วงหน้า ระบบไม่สร้างตารางให้อัตโนมัติ เพื่อป้องกันการสร้าง resource ผิด environment

### UAT resource ที่สร้างแล้ว

- วันที่สร้าง: 3 พฤศจิกายน 2026
- Subscription: `Buzzebees Staging` (`f9bca0f4-1e5b-487f-a2ef-a6578a936ef1`)
- Resource group: `rg-ado-auto-approve`
- Storage account: `rgadoautoapprove9ae0`
- Table: `AdoDeploymentEventsUat`
- Region: `southeastasia`

การสร้าง Table นี้ไม่ได้เปิด `ADO_DEPLOYMENT_EVENTS_ENABLED` และไม่ได้เปลี่ยน Static Web App settings หรือ Service Hook

## Service Hook ที่แนะนำ

สร้าง Web Hook แยกตามชนิด pipeline และจำกัด project/pipeline/environment ให้แคบที่สุด:

- Classic Release: `Release deployment started` และ `Release deployment completed`
- YAML multi-stage: `Run stage state changed`

ในหน้า Action ให้ตั้ง URL เป็น `/api/webhook` และใส่ Basic authentication username/password ให้ตรงกับ Application settings ของ UAT จากนั้นกด Test ผลที่ถูกต้องควรเป็น HTTP 200

หากได้ HTTP 401 ให้ตรวจ Application Insights log:

- พบ `webhook: 401 - Basic Auth ไม่ถูกต้อง` หมายถึง request ถึง function แล้ว แต่ username/password ที่ Service Hook ส่งมาไม่ตรง
- ไม่พบ log ดังกล่าว ให้ตรวจ hostname, path `/api/webhook`, access restriction และ authentication ของ hosting layer

อย่าคัดลอกค่า Authorization header หรือ password ลง ticket, chat หรือ commit

## การตรวจผลแบบ read-only

เปิด `GET /api/ado-deployment-status?limit=100` ด้วยบัญชีที่มี role ที่กำหนด หรือกรอง project ด้วย `projectId`:

```text
/api/ado-deployment-status?projectId=<azure-devops-project-id>&limit=100
```

ข้อมูลที่เก็บประกอบด้วย event ID/type, project, pipeline/release, run, stage/environment, status/result, timestamps และ URL กลับไป Azure DevOps ระบบใช้ event ID เป็น idempotency key จึงไม่สร้างรายการซ้ำเมื่อ Azure DevOps retry event เดิม

## ลำดับเปิด UAT

1. สร้าง UAT table และตั้ง connection string
2. ตั้ง Basic Auth โดยใช้ secret ของ UAT
3. ตั้ง `ADO_DEPLOYMENT_EVENTS_ENABLED=true`
4. สร้าง Service Hook ที่ชี้ UAT URL และกด Test
5. ทำ deployment ทดสอบหนึ่งรายการ
6. ตรวจ endpoint สถานะแบบ read-only และตรวจว่าไม่มี Deployment Planning record ถูกแก้ไข
7. ปิด feature flag หากผลไม่ตรงตามคาด

การเปิด Production, การตั้งค่า Production Service Hook และการย้ายข้อมูลไม่อยู่ในขั้นตอนนี้
