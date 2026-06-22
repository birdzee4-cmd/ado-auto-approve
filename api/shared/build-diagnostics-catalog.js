/**
 * ============================================
 * Build Diagnostics Catalog
 * ============================================
 * 
 * คลังข้อมูลรหัสปัญหาและแนวทางการแก้ไขสำหรับกรณี Build Error
 */

const catalog = {
  "NEXT_TURBOPACK_DUPLICATE_IDENTIFIER": {
    title: "Next.js/Turbopack build failed inside Docker",
    description: "Next.js/Turbopack compile ไม่ผ่านระหว่างรันคำสั่ง build ภายใน Docker เนื่องจากพบชื่อ function/export หรือ identifier ซ้ำในซอร์สโค้ด",
    solutions: [
      {
        title: "วิธีแก้ไข: ลบหรือเปลี่ยนชื่อ identifier ที่ซ้ำ",
        details: "เปิดไฟล์ที่ระบุใน Failure Location แล้วตรวจสอบ function/export/import ที่ชื่อซ้ำกัน จากนั้นลบรายการที่ซ้ำหรือเปลี่ยนชื่อให้ไม่ชนกัน"
      },
      {
        title: "ตรวจสอบ export ซ้ำในไฟล์เดียวกัน",
        details: "กรณี Turbopack แจ้ง `the name ... is defined multiple times` มักเกิดจากการประกาศ function/const หรือ export ชื่อเดียวกันมากกว่าหนึ่งครั้งในไฟล์เดียวกัน"
      }
    ]
  },
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

function sanitizeLog(logText) {
  const text = String(logText || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');

  const seenDockerNoise = new Set();
  const dockerNoisePattern = /(failed to solve|executor failed running|The process '\/usr\/bin\/docker' failed|docker failed with exit code|ERROR: failed to build|##\[error\]Dockerfile:)/i;

  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (!dockerNoisePattern.test(trimmed)) return true;
      const key = trimmed.replace(/\s+/g, ' ');
      if (seenDockerNoise.has(key)) return false;
      seenDockerNoise.add(key);
      return true;
    })
    .join('\n');
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/^["']|["']$/g, '');
}

function stripLeadingDotSlash(filePath) {
  return normalizePath(filePath).replace(/^\.\//, '');
}

function findFailedCommand(text) {
  const dockerRunMatches = Array.from(text.matchAll(/(?:^|\n)(?:#\d+\s+\d+\.\d+\s+)?(?:RUN\s+|>\s+\[.*?\]\s+RUN\s+)([^\r\n]+)/gi));
  if (dockerRunMatches.length) {
    const command = dockerRunMatches[dockerRunMatches.length - 1][1].trim();
    return command.replace(/\\\s*$/g, '').trim();
  }

  const commandMatches = [
    /The command ['"]([^'"]+)['"] returned a non-zero code/i,
    /process "\/bin\/sh -c ([^"]+)" did not complete successfully/i,
    /executor failed running \[\/bin\/sh -c ([^\]]+)\]/i
  ];

  for (const pattern of commandMatches) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }

  return '';
}

function collectWarnings(text) {
  const warnings = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/npm audit|vulnerabilit(?:y|ies)|npm WARN|warning/i.test(trimmed)) {
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        warnings.push(trimmed);
      }
    }
  });
  return warnings.slice(0, 8);
}

function findActionableLineIndex(lines) {
  const priorityPatterns = [
    /(?:^|\s)\.?[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|cs|csproj|fs|vb|json|config|props|targets):\d+:\d+/i,
    /error NU3012/i,
    /error TS\d{4}/i,
    /error CS\d{4}/i,
    /Build error occurred/i,
    /Turbopack build failed/i,
    /the name `[^`]+` is defined multiple times/i
  ];

  for (const pattern of priorityPatterns) {
    const idx = lines.findIndex((line) => pattern.test(line));
    if (idx >= 0) return idx;
  }

  const wrapperOnly = /(The process '\/usr\/bin\/docker' failed|failed to solve|executor failed running|docker failed with exit code|##\[error\]Dockerfile:)/i;
  const idx = lines.findIndex((line) => {
    const l = line.toLowerCase();
    return (
      (l.includes('error') || l.includes('failed') || l.includes('exception') || l.includes('fatal') || l.includes('##[error]')) &&
      !l.includes('npm warn') &&
      !l.includes('warning') &&
      !wrapperOnly.test(line)
    );
  });

  return idx;
}

function selectSnippet(text) {
  const lines = String(text || '').split(/\r?\n/);
  const actionableIdx = findActionableLineIndex(lines);

  if (actionableIdx >= 0) {
    const start = Math.max(0, actionableIdx - 3);
    const end = Math.min(lines.length, actionableIdx + 10);
    return {
      snippet: lines.slice(start, end).join('\n'),
      startLineNumber: start + 1
    };
  }

  const start = Math.max(0, lines.length - 15);
  return {
    snippet: lines.slice(start).join('\n'),
    startLineNumber: start + 1
  };
}

function buildResult(errorKey, overrides, text, warnings) {
  const info = catalog[errorKey] || {};
  const snippetResult = selectSnippet(text);
  return Object.assign({
    matched: true,
    errorKey: errorKey,
    failureLayer: overrides.failureLayer || 'build',
    title: info.title || overrides.title || 'Build Error',
    description: info.description || overrides.description || '',
    rootCauseSummary: overrides.rootCauseSummary || info.description || '',
    exactError: overrides.exactError || null,
    impactChain: overrides.impactChain || [],
    warnings: warnings || [],
    solutions: info.solutions || [],
    snippet: snippetResult.snippet,
    startLineNumber: snippetResult.startLineNumber
  }, overrides);
}

function diagnoseTurbopackDuplicateIdentifier(text, warnings) {
  if (!/Turbopack build failed/i.test(text) || !/the name `[^`]+` is defined multiple times/i.test(text)) {
    return null;
  }

  const nameMatch = text.match(/the name `([^`]+)` is defined multiple times/i);
  const fileMatch = text.match(/(\.?\/?[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)/);
  const identifier = nameMatch ? nameMatch[1] : '';
  const file = fileMatch ? normalizePath(fileMatch[1]) : '';
  const line = fileMatch ? Number(fileMatch[2]) : null;
  const column = fileMatch ? Number(fileMatch[3]) : null;
  const command = findFailedCommand(text) || 'npm run build';
  const location = file ? `${stripLeadingDotSlash(file)}${line ? `:${line}${column ? `:${column}` : ''}` : ''}` : '';

  return buildResult('NEXT_TURBOPACK_DUPLICATE_IDENTIFIER', {
    failureLayer: 'nextjs',
    rootCauseSummary: location && identifier
      ? `Build fail เพราะ Next.js/Turbopack compile ไม่ผ่าน เนื่องจากไฟล์ ${location} มี function/export ชื่อ ${identifier} ซ้ำ`
      : 'Build fail เพราะ Next.js/Turbopack compile ไม่ผ่าน เนื่องจากพบชื่อ identifier ซ้ำในซอร์สโค้ด',
    exactError: {
      file: file || null,
      line: line,
      column: column,
      command: command,
      message: nameMatch ? nameMatch[0] : 'the same name is defined multiple times'
    },
    impactChain: [
      `${command} failed`,
      'Docker build failed',
      'Push image skipped'
    ]
  }, text, warnings);
}

function diagnoseNu3012(text, warnings) {
  if (!/error NU3012/i.test(text)) return null;

  const packageMatches = Array.from(text.matchAll(/Package ['"]([^'"]+)\s+([^'"]+)['"]/gi));
  const packages = [];
  const seen = new Set();
  packageMatches.forEach((match) => {
    const label = `${match[1]} ${match[2]}`;
    if (!seen.has(label)) {
      seen.add(label);
      packages.push({ name: match[1], version: match[2] });
    }
  });

  const sourceMatch = text.match(/NU3012:[^\n]*(https?:\/\/\S+)/i) || text.match(/from source ['"]([^'"]+)['"]/i);
  const projectMatch = text.match(/([A-Za-z0-9_./\\-]+\.csproj)(?:\s*:|\])/i);
  const revokedMatch = text.match(/(Revoked:[^\r\n]+|certificate revoked|A certificate chain processed.*revoked[^\r\n]*)/i);
  const rawCommand = findFailedCommand(text) || 'dotnet restore';
  const command = /dotnet\s+restore/i.test(rawCommand) ? 'dotnet restore' : rawCommand;
  const packageText = packages.length
    ? packages.map((pkg) => `${pkg.name} ${pkg.version}`).join(' / ')
    : 'NuGet package';

  return buildResult('NU3012', {
    failureLayer: 'nuget',
    rootCauseSummary: `Build fail ตอน dotnet restore เพราะ NuGet package signature validation ไม่ผ่าน โดย package ${packageText} ใช้ certificate ที่ถูก revoke`,
    exactError: {
      file: projectMatch ? normalizePath(projectMatch[1]) : null,
      line: null,
      column: null,
      command: command,
      message: revokedMatch ? revokedMatch[1].trim() : 'NuGet package signature validation failed because a certificate was revoked',
      packages: packages,
      sourceUrl: sourceMatch ? sourceMatch[1].replace(/[),.;]+$/, '') : null
    },
    impactChain: [
      `${command} failed`,
      'Docker build failed',
      'Push image skipped'
    ]
  }, text, warnings);
}

function diagnoseSpecificCompiler(text, warnings) {
  const turbopack = diagnoseTurbopackDuplicateIdentifier(text, warnings);
  if (turbopack) return turbopack;

  const nu3012 = diagnoseNu3012(text, warnings);
  if (nu3012) return nu3012;

  if (/error CS\d{4}:/i.test(text)) {
    return buildResult('CS_COMPILE_ERROR', {
      failureLayer: 'dotnet',
      rootCauseSummary: 'Build fail เพราะ C# compiler ตรวจพบ compile error ในซอร์สโค้ด'
    }, text, warnings);
  }

  if (/error TS\d{4}:|failed to type check|type error:/i.test(text)) {
    return buildResult('TS_COMPILE_ERROR', {
      failureLayer: 'typescript',
      rootCauseSummary: 'Build fail เพราะ TypeScript compiler ตรวจพบ type หรือ compile error ในซอร์สโค้ด'
    }, text, warnings);
  }

  if (text.includes("npm ERR! code ERESOLVE") || text.includes("npm ERR! peer")) {
    return buildResult('NPM_CONFLICT', {
      failureLayer: 'npm',
      rootCauseSummary: 'Build fail เพราะ npm dependency resolution พบ package peer dependency ที่ชนกัน'
    }, text, warnings);
  }

  if (/\d+\s+problems?\s+\(\d+\s+errors?/i.test(text)) {
    return buildResult('ESLINT_ERROR', {
      failureLayer: 'lint',
      rootCauseSummary: 'Build fail เพราะ linter ตรวจพบ error ในซอร์สโค้ด'
    }, text, warnings);
  }

  return null;
}

function diagnoseFailedCommand(text, warnings) {
  const command = findFailedCommand(text);
  if (!command) return null;

  if (/npm\s+run\s+build/i.test(command)) {
    return buildResult('DOCKER_BUILD_ERROR', {
      failureLayer: 'docker',
      rootCauseSummary: `Docker build failed เพราะคำสั่งภายใน Dockerfile รันไม่สำเร็จ: ${command}`,
      exactError: {
        file: null,
        line: null,
        column: null,
        command: command,
        message: 'Dockerfile RUN command failed'
      },
      impactChain: [
        `${command} failed`,
        'Docker build failed',
        'Push image skipped'
      ]
    }, text, warnings);
  }

  return null;
}

function diagnoseDockerWrapper(text, warnings) {
  if (/failed to build|failed to solve: process|docker failed with exit code|The process '\/usr\/bin\/docker' failed/i.test(text)) {
    return buildResult('DOCKER_BUILD_ERROR', {
      failureLayer: 'docker',
      rootCauseSummary: 'Docker build failed ระหว่างสร้าง container image แต่ log ไม่พบ compiler error ที่เฉพาะเจาะจงกว่า',
      impactChain: [
        'Docker build failed',
        'Push image skipped'
      ]
    }, text, warnings);
  }
  return null;
}

/**
 * ทำการวิเคราะห์ข้อความ Log และส่งคำวินิจฉัยกลับ
 * @param {string} logText - ข้อความใน Log ทั้งหมด
 * @returns {object} ผลการวินิจฉัย
 */
function diagnoseLog(logText) {
  const text = sanitizeLog(logText);
  const warnings = collectWarnings(text);

  const prioritizedResult =
    diagnoseSpecificCompiler(text, warnings) ||
    diagnoseFailedCommand(text, warnings) ||
    diagnoseDockerWrapper(text, warnings);

  if (prioritizedResult) return prioritizedResult;

  let matchedKey = null;
  if (/automatic merge failed|merge conflict/i.test(text)) {
    matchedKey = "GIT_MERGE_CONFLICT";
  } else if (/timed out|timeout|operation was canceled/i.test(text)) {
    matchedKey = "TIMEOUT";
  } else if (/(failed|failure)\s+:[^\n]*test|assert\.fail|expected[^\n]*actual/i.test(text)) {
    matchedKey = "UNIT_TEST_FAILURE";
  }

  if (matchedKey && catalog[matchedKey]) {
    return buildResult(matchedKey, {
      failureLayer: 'build',
      rootCauseSummary: catalog[matchedKey].description
    }, text, warnings);
  }

  const snippetResult = selectSnippet(text);

  // กรณีไม่แมตช์รหัสปัญหาใดๆ ในสารบบ (Fallback Response)
  return {
    matched: false,
    errorKey: "GENERIC_ERROR",
    failureLayer: "generic",
    title: "Unclassified Build Error (พบจุดข้อผิดพลาดของระบบ)",
    description: "ระบบบิลด์ล้มเหลวระหว่างขั้นตอนรันคำสั่ง กรุณาตรวจรายละเอียดข้อผิดพลาดจากบรรทัด Log ดิบด้านล่างเพื่อหาสาเหตุ",
    rootCauseSummary: "ระบบบิลด์ล้มเหลว แต่ยังไม่พบ pattern ที่จำแนกสาเหตุหลักได้ชัดเจน",
    exactError: null,
    impactChain: [],
    warnings: warnings,
    solutions: [
      {
        title: "แนวทางแก้ไข",
        details: "1. ตรวจสอบข้อความแจ้งเตือนสีแดงในส่วนของ Log ดิบด้านล่าง\n2. เปิดดูรายละเอียดบิลด์ตัวเต็มที่ Azure DevOps เพื่อตรวจสอบขั้นตอนก่อนหน้า"
      }
    ],
    snippet: snippetResult.snippet,
    startLineNumber: snippetResult.startLineNumber
  };
}

module.exports = {
  catalog,
  diagnoseLog,
  sanitizeLog
};
