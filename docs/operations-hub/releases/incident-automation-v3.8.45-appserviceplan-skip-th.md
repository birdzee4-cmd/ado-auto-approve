# Incident Automation v3.8.45 — ข้าม AppServicePlan

## สาเหตุของ INC-2026-000298

อีเมลวันที่ 9 ตุลาคม 2026 เวลา 18:31 มีชื่อ alert `AzureAppServicePlanCpuVeryHighCritical` แต่ค่า `Resource` เป็น `sea15-linux` เงื่อนไขข้าม AppServicePlan ใน package เดิมตรวจเฉพาะ `Compose_Resource` ว่ามีคำว่า `appserviceplan` จึงประเมินเป็น false และเดินเข้าเส้นทาง P1 ที่สร้าง Incident, Azure DevOps work item #889025 และ approval ตามปกติ

## การแก้ไข

Package `OperationsHub-IncidentAutomationv3.8.45-AppServicePlanSkip-Import.zip` ตรวจคำว่า `appserviceplan` (ไม่สนตัวพิมพ์ใหญ่เล็ก) ในชื่อ alert, resource และ subject ก่อนเข้าเส้นทาง P1 ทั้ง FIRING และ RESOLVED กรณีนี้จะออกทาง terminate โดยไม่สร้าง incident, work item หรือ approval ใหม่ ส่วน alert ของ App Service ประเภทอื่นยังเดินตามเส้นทางเดิม

Package v3.8.44 ที่ได้รับมีชื่อไฟล์ v3.8.44 แต่ metadata ภายในระบุ v3.8.43 (ทั้ง package display name, flow display name และ contentVersion) เก็บ ZIP ต้นฉบับไว้ตามที่ได้รับ และแก้ metadata ให้ตรงกันใน package ใหม่ v3.8.45

## ตรวจสอบก่อนนำเข้า

- ZIP ใหม่มี 5 รายการตามโครงสร้าง package เดิม
- Package display name, flow display name, resource display name และ `contentVersion` เป็น v3.8.45 ทั้งหมด
- ทดสอบเงื่อนไขกับ alert `AzureAppServicePlanCpuVeryHighCritical` / resource `sea15-linux` แล้วได้ผล skip และกับ `AzureAppServiceHttp5xxCritical` แล้วไม่ skip

ยังไม่ได้ยืนยันว่า v3.8.44 เป็นเวอร์ชันที่เปิดใช้งานจริงใน Power Automate ควรเทียบ run history ของเมลนี้กับ flow ที่เปิดใช้งาน และทดสอบ package ใหม่ก่อนแทนที่ flow เดิม ใบงาน INC-2026-000298 และ #889025 ไม่ได้ถูกแก้ไข
