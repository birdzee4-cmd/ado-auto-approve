# Repository file-management rules

- Keep all Operations Hub / Power Automate artifacts under `artifacts/power-automate/`.
- This includes import/export ZIP files, unpacked flow packages, staging folders, and package-specific temporary work.
- Always publish Operations Hub packages as a new version; never overwrite an existing package.
- Use the naming format `OperationsHub-<Component>v<MAJOR>.<MINOR>.<PATCH>[-<Purpose>]-Import.zip` for import packages.
- Increment the patch version for each new revision, for example `v3.8.33` → `v3.8.34` → `v3.8.35`.
- Before creating any new Power Automate ZIP, scan all existing ZIP filenames for the same component under `artifacts/power-automate/`, including import and export archives. Use the highest existing `MAJOR.MINOR.PATCH` as the baseline and assign the next patch number; never reuse or skip back to an earlier number because an export's internal version is older.
- Apply the new version consistently to the ZIP filename, package manifest display name, flow display name, and flow definition `contentVersion`. Verify these values and the ZIP contents before handoff. If an externally exported ZIP already has a numbered filename but older internal metadata, preserve it as received and document the mismatch; correct it only in a separately numbered new package.
- Preserve the previous ZIP as an immutable historical artifact, even when the new version contains only a small fix.
- Do not create Operations Hub artifacts, ZIP files, or unpacked flow folders at the repository root.
- Use `artifacts/power-automate/_work/` for temporary extraction/build output and remove only disposable work folders after packaging.
- Keep reusable package-builder scripts under `scripts/`; do not place them in `artifacts/power-automate/`.
- Before handoff, run `git status --short` and remove task-generated temporary artifacts. Preserve unrelated user changes.
- Never delete tracked source, documentation, configuration, or deployment files as part of temporary cleanup.
