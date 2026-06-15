/**
 * ============================================
 * Build Diagnostics Catalog
 * ============================================
 * 
 * คลังข้อมูลรหัสปัญหาและแนวทางการแก้ไขสำหรับกรณี Build Error
 */

const catalog = {
  "NU3012": {
    title: "NuGet Package Signature Verification Failed (Certificate Revoked)",
    description: "แพ็กเกจ NuGet ถูกเพิกถอนใบรับรองดิจิทัลความปลอดภัย (Certificate Revoked) ทำให้ NuGet Client ปฏิเสธการดาวน์โหลดในขณะรัน `dotnet restore` ตามมาตรฐาน NuGet Signature Verification",
    solutions: [
      {
        title: "วิธีที่ 1: อัปเกรดเวอร์ชันของแพ็กเกจ (แนะนำ)",
        details: "แก้ไขไฟล์โปรเจกต์ `.csproj` อัปเดตเวอร์ชันของแพ็กเกจที่มีปัญหา (เช่น `Refit`) ไปใช้เวอร์ชันใหม่กว่าที่ใบรับรองดิจิทัลยังไม่หมดอายุหรือถูกเพิกถอน"
      },
      {
        title: "วิธีที่ 2: ปรับระดับความเข้มงวดการตรวจสอบใน Nuget.config (แก้ไขชั่วคราว)",
        details: "แก้ไขไฟล์ `Nuget.config` ในรูทโปรเจกต์ ปรับโหมด `signatureValidationMode` ให้ยอมรับใบรับรองที่หมดอายุ:\n```xml\n<configuration>\n  <config>\n    <add key=\"signatureValidationMode\" value=\"accept\" />\n  </config>\n</configuration>\n```"
      }
    ]
  },
  "NETSDK1045": {
    title: "Unsupported Target Framework (.NET SDK Version Mismatch)",
    description: "เวอร์ชันของ .NET SDK ที่ติดตั้งอยู่บน Build Agent ของระบบรัน มีเวอร์ชันต่ำกว่า Target Framework ที่ระบุในไฟล์โปรเจกต์ จึงไม่สามารถทำการคอมไพล์โค้ดได้",
    solutions: [
      {
        title: "วิธีที่ 1: ติดตั้ง .NET SDK เวอร์ชันที่เหมาะสมใน YAML Pipeline (แนะนำ)",
        details: "แก้ไขไฟล์ YAML Pipeline เพิ่ม Task `UseDotNet@2` ก่อนขั้นตอน Restore/Build เพื่อบังคับติดตั้ง SDK เวอร์ชันที่ตรงกับโค้ด:\n```yaml\n- task: UseDotNet@2\n  displayName: 'Use .NET SDK 10.x'\n  inputs:\n    packageType: 'sdk'\n    version: '10.x'\n```"
      },
      {
        title: "วิธีที่ 2: ลดเวอร์ชัน Target Framework ในไฟล์โปรเจกต์",
        details: "แก้ไขไฟล์โปรเจกต์ `.csproj` ปรับแท็ก `<TargetFramework>` ลงมาเป็นเวอร์ชันที่เซิร์ฟเวอร์รันมีอยู่แล้ว (เช่น `net8.0`):\n```xml\n<!-- เปลี่ยนจาก net10.0 เป็น net8.0 -->\n- <TargetFramework>net10.0</TargetFramework>\n+ <TargetFramework>net8.0</TargetFramework>\n```"
      }
    ]
  },
  "NPM_CONFLICT": {
    title: "npm dependency resolution conflict (ERESOLVE)",
    description: "เกิดปัญหาเวอรชันของไลบรารีชนกันในขณะรัน `npm install` เนื่องจากโมดูลบางตัวต้องการแพ็กเกจในเวอร์ชันที่ไม่ตรงกันตามกฎ Semantic Versioning",
    solutions: [
      {
        title: "วิธีที่ 1: ใช้สวิตช์ --legacy-peer-deps",
        details: "แก้ไขในคำสั่ง YAML Pipeline ขั้นตอนติดตั้งให้ข้ามการตรวจเวอร์ชันย่อยที่ไม่เข้ากัน:\n```bash\nnpm install --legacy-peer-deps\n```"
      },
      {
        title: "วิธีที่ 2: ทำความสะอาด npm cache หรือระบุเวอร์ชันแบบเฉพาะเจาะจง",
        details: "ตรวจสอบและแก้ไขไฟล์ `package.json` ให้ดึงโมดูลที่ขัดแย้งกันออก หรือบังคับเวอร์ชันให้เข้ากันได้"
      }
    ]
  }
};

/**
 * ทำการวิเคราะห์ข้อความ Log และส่งคำวินิจฉัยกลับ
 * @param {string} logText - ข้อความใน Log ทั้งหมด
 * @returns {object} ผลการวินิจฉัย
 */
function diagnoseLog(logText) {
  const text = String(logText || '');
  const lines = text.split(/\r?\n/);
  
  // 1. ค้นหาคีย์เวิร์ดของความผิดพลาดใน Catalog
  let matchedKey = null;
  for (const key of Object.keys(catalog)) {
    if (text.includes(key)) {
      matchedKey = key;
      break;
    }
  }

  // 2. ถ้าเจอ npm conflict แต่ไม่มีรหัสตรงๆ
  if (!matchedKey && (text.includes("npm ERR! code ERESOLVE") || text.includes("npm ERR! peer"))) {
    matchedKey = "NPM_CONFLICT";
  }

  // 3. ดึง Log Snippet ตรงจุดพัง (Fallback scan)
  // สแกนหาบรรทัดที่มีข้อผิดพลาด เช่น error, fail, fatal, exception
  const errorLineIndices = [];
  lines.forEach((line, idx) => {
    const l = line.toLowerCase();
    if (
      (l.includes('error ') || l.includes('error:') || l.includes('failed') || l.includes('exception') || l.includes('fatal')) &&
      !l.includes('npm warn') && !l.includes('warning')
    ) {
      errorLineIndices.push(idx);
    }
  });

  let snippet = '';
  let startLineNumber = 1;
  if (errorLineIndices.length > 0) {
    // ดึงช่วงรอบๆ บรรทัดที่พังบรรทัดแรกมาแสดง (ก่อนหน้า 2 บรรทัด, ถัดไป 8 บรรทัด)
    const firstErrIdx = errorLineIndices[0];
    const start = Math.max(0, firstErrIdx - 2);
    const end = Math.min(lines.length, firstErrIdx + 8);
    snippet = lines.slice(start, end).join('\n');
    startLineNumber = start + 1;
  } else {
    // หากสแกนไม่เจอบรรทัดที่มีคีย์เวิร์ดพัง ให้ตัดเอา 15 บรรทัดสุดท้ายมาแสดง
    const start = Math.max(0, lines.length - 15);
    snippet = lines.slice(start).join('\n');
    startLineNumber = start + 1;
  }

  // 4. ผูกผลลัพธ์
  if (matchedKey && catalog[matchedKey]) {
    const info = catalog[matchedKey];
    return {
      matched: true,
      errorKey: matchedKey,
      title: info.title,
      description: info.description,
      solutions: info.solutions,
      snippet: snippet,
      startLineNumber: startLineNumber
    };
  }

  // กรณีไม่แมตช์รหัสปัญหาใดๆ ในสารบบ (Fallback Response)
  return {
    matched: false,
    errorKey: "GENERIC_ERROR",
    title: "Unclassified Build Error (พบจุดข้อผิดพลาดของระบบ)",
    description: "ระบบบิลด์ล้มเหลวระหว่างขั้นตอนรันคำสั่ง กรุณาตรวจรายละเอียดข้อผิดพลาดจากบรรทัด Log ดิบด้านล่างเพื่อหาสาเหตุ",
    solutions: [
      {
        title: "แนวทางแก้ไข",
        details: "1. ตรวจสอบข้อความแจ้งเตือนสีแดงในส่วนของ Log ดิบด้านล่าง\n2. เปิดดูรายละเอียดบิลด์ตัวเต็มที่ Azure DevOps เพื่อตรวจสอบขั้นตอนก่อนหน้า"
      }
    ],
    snippet: snippet,
    startLineNumber: startLineNumber
  };
}

module.exports = {
  catalog,
  diagnoseLog
};
