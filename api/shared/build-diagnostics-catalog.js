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
  },
  "CS_COMPILE_ERROR": {
    title: "C# Compilation Error (.NET Compile Failure)",
    description: "เกิดข้อผิดพลาดในการคอมไพล์โค้ด C# (.NET) เนื่องจากโครงสร้างโค้ดไม่ถูกต้องตามหลักไวยากรณ์ (Syntax) หรือไม่พบเนมสเปซ/คลาส/ตัวแปรตามที่เรียกใช้",
    solutions: [
      {
        title: "วิธีที่ 1: ตรวจสอบ syntax และ namespace",
        details: "ตรวจสอบข้อความข้อผิดพลาด (เช่น `CS0246` หรือ `CS0103`) ในบรรทัด Log ด้านล่าง เพื่อค้นหาคลาสหรือตัวแปรที่มีปัญหาและเพิ่มการสะกดคำหรือการ `using` namespace ให้ถูกต้อง"
      },
      {
        title: "วิธีที่ 2: ตรวจเช็กการ Commit ไฟล์",
        details: "ตรวจสอบบน Git ว่ามีไฟล์โค้ดใหม่บางตัวที่สร้างขึ้นและเรียกใช้งาน แต่ลืมทำการ add หรือ commit ขึ้นมาพร้อมกันหรือไม่"
      }
    ]
  },
  "TS_COMPILE_ERROR": {
    title: "TypeScript Compilation Error (TS Compile Failure)",
    description: "ตัวแปลงคอมไพเลอร์ TypeScript ตรวจพบความไม่สอดคล้องของประเภทข้อมูล (Type Mismatch) หรือการเรียกใช้ไฟล์/โมดูลที่ไม่มีอยู่จริง",
    solutions: [
      {
        title: "วิธีที่ 1: แก้ไขไทป์ข้อมูลและโครงสร้างของ Object",
        details: "เปิดหน้าจอ Log ด้านล่างดูบรรทัดรหัสข้อผิดพลาดของ TS (เช่น `TS2307`) และปรับปรุงประเภทข้อมูลหรืออินเทอร์เฟซให้สอดคล้องกัน"
      },
      {
        title: "วิธีที่ 2: ตรวจสอบการสะกดชื่อไฟล์ (Case-sensitive)",
        details: "ตัวคอมไพเลอร์บน Linux Agent จะคัดกรองชื่อไฟล์แบบ Case-sensitive ตรวจสอบว่า `import` path สะกดตัวพิมพ์เล็ก-ใหญ่ตรงกับชื่อไฟล์จริงหรือไม่"
      }
    ]
  },
  "GIT_MERGE_CONFLICT": {
    title: "Git Merge Conflict (เกิดการชนกันของโค้ด)",
    description: "เกิดความขัดแย้งของโค้ดในการผสานสาขาอัตโนมัติ เนื่องจากไฟล์เดียวกันในบรรทัดเดียวกันมีการแก้ไขจากทั้งฝั่งต้นทางและปลายทาง",
    solutions: [
      {
        title: "วิธีแก้ไข: ดำเนินการ Resolve Conflict ด้วยตนเอง",
        details: "ดึงโค้ดสาขาปลายทางลงมาที่เครื่องตัวเอง (`git pull origin staging`) ทำการแก้ไขจุดชนกันของโค้ด (Resolve Conflict) จากนั้นจึงทำการ Commit และ Push ขึ้นไปใหม่อีกครั้ง"
      }
    ]
  },
  "TIMEOUT": {
    title: "Build Step Timeout (หมดเวลาการประมวลผลคำสั่ง)",
    description: "คำสั่งในขั้นตอนการรันบิลด์ค้างทำงานนานเกินกว่าเวลาจำกัด หรือมีกระบวนการที่หยุดค้างรออินพุตจากภายนอก",
    solutions: [
      {
        title: "วิธีที่ 1: ตรวจสอบกระบวนการ Unit Test / Server Start",
        details: "ตรวจสอบว่ามีสคริปต์ Unit Test บางตัวเข้าลูปอนันต์ (Infinite Loop) หรือมีคำสั่งจำพวก start server ที่ทำงานค้างและไม่ยอมปิดการรันตัวเองเมื่อทำงานเสร็จสิ้นหรือไม่"
      },
      {
        title: "วิธีที่ 2: เพิ่มระยะเวลารัน (Timeout Limit) ใน Pipeline YAML",
        details: "หากบิลด์มีขนาดใหญ่มาก สามารถเข้าไปเพิ่มคุณสมบัติ `timeoutInMinutes` ในขั้นตอนทำงานเพื่อขยายเวลาออกไปได้"
      }
    ]
  },
  "UNIT_TEST_FAILURE": {
    title: "Unit Test Execution Failed (การทดสอบโค้ดล้มเหลว)",
    description: "ฟังก์ชันหรือเคสทดสอบรันเสร็จสิ้นแต่ให้ผลลัพธ์ไม่ตรงตามเงื่อนไขที่คาดหวังไว้ (Assertion Failed)",
    solutions: [
      {
        title: "วิธีที่ 1: ตรวจสอบ Log และค่าผลลัพธ์ของข้อผิดพลาด",
        details: "เปิดดูความแตกต่างระหว่างผลลัพธ์ที่ได้รับจริง (Actual) และค่าที่คาดหวัง (Expected) เพื่อประเมินจุดบกพร่องของฟังก์ชันหลัก"
      },
      {
        title: "วิธีที่ 2: อัปเดตเคสทดสอบกรณีมีการแก้ไข Requirements",
        details: "หากเงื่อนไขการทำงานของโปรแกรมหลักเปลี่ยนไป ให้อัปเดตโค้ดในไฟล์ทดสอบเพื่อให้สอดรับกับผลลัพธ์รูปแบบใหม่"
      }
    ]
  },
  "ESLINT_ERROR": {
    title: "Linter Checks Failed (การจัดรูปแบบโค้ดผิดกฎมาตรฐาน)",
    description: "ซอร์สโค้ดที่อัปเดตไม่ผ่านการตรวจสอบมาตรฐานความสวยงามและระเบียบสไตล์ของโค้ด (Lint Rules)",
    solutions: [
      {
        title: "วิธีที่ 1: รันคำสั่งแก้ไขอัตโนมัติบนโลคอล",
        details: "รันคำสั่งแก้ไขฟอร์แมตในเครื่องคอมพิวเตอร์ของคุณเพื่อช่วยจัดการโค้ดให้สอดคล้องกับกฎส่วนใหญ่:\n```bash\nnpm run lint -- --fix\n```"
      },
      {
        title: "วิธีที่ 2: แก้ไขสไตล์ตามจุดที่ระบุใน Log",
        details: "ตรวจสอบบรรทัดและไฟล์ที่มีการระบุข้อผิดพลาดจากบรรทัด Log ดิบด้านล่าง และปรับปรุงแก้ไขตามแนวทางที่ระบุ"
      }
    ]
  },
  "DOCKER_BUILD_ERROR": {
    title: "Docker Build Failed (การสร้าง Container Image ล้มเหลว)",
    description: "คำสั่งรัน Docker Build ใน Container Image ล้มเหลวเนื่องจากมีขั้นตอนหรือคำสั่งภายใน Dockerfile ทำงานไม่สำเร็จ (เช่น ขั้นตอน compile, build, test หรือการติดตั้ง package)",
    solutions: [
      {
        title: "วิธีที่ 1: ตรวจสอบขั้นตอนที่ล้มเหลวใน Dockerfile",
        details: "ตรวจสอบบรรทัดคำสั่ง Dockerfile ใน Log ดิบด้านล่าง เช่น `RUN npm run build` หรือ `RUN dotnet build` เพื่อดูว่าล้มเหลวจากคำสั่งใดและมีรายละเอียดข้อผิดพลาดแจ้งอย่างไร"
      },
      {
        title: "วิธีที่ 2: ตรวจสอบข้อผิดพลาดของภาษาซอร์สโค้ด (TypeScript / .NET compile)",
        details: "เลื่อนดู Log ด้านล่างเพื่อค้นหาบรรทัดข้อผิดพลาดของซอร์สโค้ดที่เกิดขึ้นในขั้นสร้าง container (เช่น TypeScript type check fail, compilation error) แล้วดำเนินการแก้ไขซอร์สโค้ดและ commit ขึ้นไปใหม่"
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

  // 2. ค้นหาความผิดพลาดด้วย Regex Patterns
  if (!matchedKey) {
    if (/error CS\d{4}:/i.test(text)) {
      matchedKey = "CS_COMPILE_ERROR";
    } else if (/error TS\d{4}:|failed to type check|type error:/i.test(text)) {
      matchedKey = "TS_COMPILE_ERROR";
    } else if (/automatic merge failed|merge conflict/i.test(text)) {
      matchedKey = "GIT_MERGE_CONFLICT";
    } else if (/timed out|timeout|operation was canceled/i.test(text)) {
      matchedKey = "TIMEOUT";
    } else if (/(failed|failure)\s+:[^\n]*test|assert\.fail|expected[^\n]*actual/i.test(text)) {
      matchedKey = "UNIT_TEST_FAILURE";
    } else if (/\d+\s+problems?\s+\(\d+\s+errors?/i.test(text)) {
      matchedKey = "ESLINT_ERROR";
    } else if (/failed to build|failed to solve: process|docker failed with exit code/i.test(text)) {
      matchedKey = "DOCKER_BUILD_ERROR";
    } else if (text.includes("npm ERR! code ERESOLVE") || text.includes("npm ERR! peer")) {
      matchedKey = "NPM_CONFLICT";
    }
  }

  // 3. ดึง Log Snippet ตรงจุดพัง (Fallback scan)
  // สแกนหาบรรทัดที่มีข้อผิดพลาด เช่น error, fail, fatal, exception
  const errorLineIndices = [];
  lines.forEach((line, idx) => {
    const l = line.toLowerCase();
    if (
      (l.includes('error') || l.includes('failed') || l.includes('exception') || l.includes('fatal') || l.includes('##[error]')) &&
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
