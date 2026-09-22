# Repository process-safety rules

- Run Word COM acceptance only through `npm run accept:word -- <docx>`. The launcher owns a hard deadline and exact-PID cleanup.
- Never start hidden or background `powershell.exe`, `WINWORD.EXE`, or Word COM diagnostics directly from an agent command.
- Any bounded diagnostic exception must have an explicit wall-clock timeout, record every Windows PID it creates, wait for completion, and verify those exact PIDs are absent before deleting scripts or artifacts or ending the task.
- A yielded terminal/session is still a live process. Always resume it to completion or terminate its exact verified PID; never treat a tool yield or a missing `WINWORD.EXE` as cleanup proof.
