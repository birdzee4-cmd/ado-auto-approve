'use strict';

module.exports = {
  buildKitSecret: [
    '#12 [build 6/10] RUN --mount=type=secret,id=build_pat dotnet restore',
    '#12 0.201 cat: /run/secrets/build_pat: No such file or directory',
    '#12 0.310 /src/App.csproj : error : Value cannot be null or empty string. (Parameter \'password\')',
    '#12 ERROR: process "/bin/sh -c dotnet restore" did not complete successfully: exit code: 1',
    '##[error]The process \'/usr/bin/docker\' failed with exit code 1'
  ].join('\n'),
  nuget: "App.csproj : error NU3012: Package 'Refit 7.0.0' from source 'https://feed.example/v3/index.json': certificate revoked",
  typescript: 'src/app.ts:12:4 error TS2307: Cannot find module ./missing',
  csharp: 'src/Program.cs(10,4): error CS0103: The name value does not exist',
  npmConflict: 'npm ERR! code ERESOLVE\nnpm ERR! peer dependency conflict',
  eslint: '✖ 4 problems (2 errors, 2 warnings)',
  timeout: '##[error]The operation was canceled because the task timed out',
  unitTest: 'Test failure: expected 200 but actual 500',
  dockerWrapper: 'ERROR: failed to solve: process "/bin/sh -c npm run build" did not complete successfully: exit code: 1',
  generic: 'The task stopped for an unknown reason without an error signature'
};
