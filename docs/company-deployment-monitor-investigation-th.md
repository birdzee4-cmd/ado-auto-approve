# ผลตรวจ Company Deployment Monitor

ตรวจวันที่ 5 พฤศจิกายน 2026 ผ่าน Edge session ของผู้ใช้, DevTools Network/Sources และ GET API แบบอ่านอย่างเดียว

## แหล่งข้อมูลที่ยืนยันแล้ว

- หน้าเว็บ: https://tv.buzzebees-dev.com/deploymentstatus_.aspx?Role=Support
- Initial data: `GET https://statoffice.buzzebees-dev.com/monitordeployment/getDeploymentStatus`
- Network request มี query `bzbTime` แบบ timestamp; ทดลองไม่มี query ก็ได้ HTTP 200 และ JSON
- หน้าเว็บเรียกผ่าน `connectExternal('GET', ..., null, callback)` ใน `fetchInitial()`
- มี SignalR hub `deploymentmonitorhub` ที่ `/signalr/hubs`; พบ negotiate/start และ transport `serverSentEvents` ใน Network ยังไม่ได้ตรวจชื่อ callback/message schema
- การอ่าน API จากเครื่องพัฒนาโดยไม่ส่ง credentials ได้ HTTP 200 ณ เวลาตรวจ ไม่ควรสรุปว่าเงื่อนไขการเข้าถึงจะเหมือนกันทุกเครือข่ายหรือ environment

## Schema

JSON array มี `BuildId`, `CiName`, `RequestBy`, `Status`, `Branch`, `ProjectType`, `LastUpdate`, `StartTime`, `TotalTime`, `BranchName`

- `Branch` คือกลุ่ม environment เช่น staging; `BranchName` คือ Git ref จริง เช่น refs/heads/main จึงห้ามใช้แทนกัน
- `LastUpdate`: ตัวอย่าง `05/11/2026 20:06:13` ไม่มี timezone offset
- `StartTime`: ตัวอย่าง `11/5/2026 8:05:06 PM` ไม่มี timezone offsetและรูปแบบต่างจาก LastUpdate
- ไม่พบ commit SHA, repository ID, release ID หรือ artifact digest ใน schema ที่อ่าน ต้องเสริมจาก Azure DevOps และแสดงกรณียังจับคู่ไม่ได้

## วิธีนับที่ยืนยันจาก source และเทียบ JSON

Source แปลง Status เป็น lowercase แล้วแยก terminal statuses `complete`, `build fail`, `deploy fail`, `cancel deploy` เข้ารายการ Complete ส่วนสถานะอื่นเข้ารายการ in process

Source แยก staging ด้วย `item.Branch.toLowerCase() == 'staging'`; development เป็นอีกกลุ่ม และค่าที่เหลือเป็น production fallback ควรใช้ explicit environment mapping ในระบบใหม่เพื่อไม่จัดค่าที่ไม่รู้จักเป็น production

Snapshot 564 รายการ ทุก LastUpdate เป็น 05/11/2026:

| Environment | Complete | Build fail | Deploy fail | Cancel deploy | Building | จบทั้งหมด |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Development | 324 | 24 | 5 | 1 | 1 | 354 |
| Staging | 132 | 7 | 1 | 0 | 0 | 140 |
| Production | 61 | 3 | 0 | 5 | 0 | 69 |

ยังไม่ยืนยันสูตรตัดวัน/เขตเวลาฝั่ง server หรือ API สำหรับย้อนหลัง การได้ข้อมูลวันนี้ทั้งหมดครั้งเดียวไม่ใช่หลักฐานว่ารองรับ query วันที่

## หลักฐานการเชื่อม Build

- DealShop staging: BuildId 615309 = Build fail; 615273 = Complete ตรงกับ Azure CI run .57 และ .56 ที่ตรวจในงานก่อน
- Monitor LastUpdate ของ 615309 คือ 20:06:13 ขณะที่ Azure completedAt คือ 20:06:45.991 เวลาไทย จึงต้องแสดงว่าเป็นเวลา update ของคนละระบบ ห้ามถือว่า timestamp ต้องตรงกัน
- BuildId บางรายการมี suffix `_M` / `_P` เช่น `615209_M` Module กับ `615209_P` Plugin ของ service-burgerking
- Source ตัด `_M` และ `_P` เพื่อสร้าง BuildURLs; snapshot มี `_M` 13 และ `_P` 10 รายการ
- ต้องเก็บ raw BuildId เป็น identity ของรายการ Monitor และเก็บ numeric Azure BuildId แยกสำหรับ enrichment ห้าม deduplicate สองรายการนี้ด้วย numeric BuildId อย่างเดียว
- Snapshot ไม่พบ raw BuildId ซ้ำ; ควรตรวจ uniqueness ซ้ำกับข้อมูลเพิ่มเติมก่อนกำหนด database key ถาวร

## แนวทางเมนูใหม่

ใช้ API นี้เป็น source ของยอด/การ์ด แสดงสาม environment พร้อมจบทั้งหมด/สำเร็จ/Build fail/Deploy fail/ยกเลิก/กำลังทำ และเวลาอ่านข้อมูล ไม่รวมกับยอด Hook Events เดิม เสริม commit/PR จาก Azure Build API ด้วย scope organization/project ที่ตรวจสอบแล้ว และเก็บสถานะการจับคู่แยกจากผล Monitor

เรียกผ่าน backend adapter ของระบบเราเพื่อกำหนด timeout, ตรวจ schema, จำกัด destination คงที่ และบังคับสิทธิ์เดิมของ deployment dashboard อย่าส่ง browser cookies หรือ SignalR connection tokens ไปเก็บหรือ reuse

คงการ refresh แบบผู้ใช้กดเองตามคำขอล่าสุด ไม่เชื่อม SignalR/ตั้ง polling อัตโนมัติในเมนูใหม่ และอย่าแสดง snapshot เก่าว่าเป็นข้อมูลปัจจุบันหาก upstream ล้มเหลว
