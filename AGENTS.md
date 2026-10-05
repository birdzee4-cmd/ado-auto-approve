# Repository file-management rules

- Keep temporary inspection, unpacking, patching, and packaging output outside the repository, preferably under `$env:TEMP\ado-auto-approve`.
- If a temporary path must be created in the repository, use `.tmp/` only and remove it before finishing the task.
- Do not create Power Automate package ZIP files, unpacked flow folders, or one-off patch scripts at the repository root.
- Before handoff, run `git status --short` and remove task-generated temporary artifacts. Preserve unrelated user changes.
- Never delete tracked source, documentation, configuration, or deployment files as part of temporary cleanup.
