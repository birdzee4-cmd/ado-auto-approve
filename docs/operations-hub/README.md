# Operations Hub documentation

เอกสารของ Operations Hub แบ่งตามหน้าที่ เพื่อให้ค้นหาและดูแลได้ง่ายขึ้น

## Overview

- [ภาพรวมระบบ](overview/operations-hub.md)

## Plans

- [แผนปรับปรุงระบบ](plans/implementation-plan-th.md)
- [แผน Escalation](plans/escalation-plan-th.md)
- [แผน Workflow ใหม่](plans/new-workflows-th.md)

## Runbooks

- [Power Automate Flow 1](runbooks/power-automate-flow1-th.md)
- [Rollout และ Rollback](runbooks/rollout-runbook-th.md)
- [Cleanup](runbooks/cleanup-2026-09-18.md)
- [SharePoint time migration](runbooks/sharepoint-time-migration-2026-09-18.md)

## Releases and rollout evidence

- [Alert lifecycle reconciliation v1.0.0](releases/alert-lifecycle-reconciliation-v1.0.0-th.md)
- [v3.8.6 lifecycle repair](releases/v386-lifecycle-rollout.md)
- [v3.8.7 hotfix](releases/v387-hotfix-rollout-th.md)

## Documentation rules

- แผนและแนวคิดใหม่ให้อยู่ใน `plans/`
- ขั้นตอนปฏิบัติและ rollback ให้อยู่ใน `runbooks/`
- หลักฐานของ release ที่ deploy/import แล้วให้อยู่ใน `releases/`
- ห้ามเก็บไฟล์ `tmp-*`, preview หรือ generated output ในโฟลเดอร์เอกสาร
