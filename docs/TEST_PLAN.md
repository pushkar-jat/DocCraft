# Phase 1 Test Plan

## Manual smoke tests

Use non-sensitive sample PDFs that you own or are allowed to test.

1. Launch the app and confirm the dashboard appears.
2. Open the file picker and cancel. Confirm no crash and no unintended state change.
3. Select two valid PDFs with different page counts.
4. Confirm filenames are displayed.
5. Select the same file again. Confirm it is not duplicated.
6. Move the second file above the first. Confirm the displayed order changes.
7. Remove one file. Confirm it disappears.
8. Try merging with fewer than two files. Confirm merge is disabled or a clear message appears.
9. Select two PDFs, start merge, then cancel the save dialog. Confirm no output is created.
10. Merge two PDFs and save to a new path.
11. Open the output in a separate PDF reader and confirm all pages are present in the chosen order.
12. Confirm the original files remain unchanged.
13. Try a malformed or non-PDF file renamed with a `.pdf` extension. Confirm a controlled error, not a crash.
14. Try a password-protected PDF if the chosen library supports detecting it. Confirm a useful error.
15. Test long filenames and paths containing spaces.
16. Test a moderately large PDF within the capabilities of the machine.
17. Close and relaunch the app. Confirm it starts cleanly.

### Additional DocCraft-specific checks

18. In the save dialog, pick one of the selected input files as the output. Confirm Windows asks to replace it and, if you accept, DocCraft refuses with "The output cannot replace one of the files being merged" and the input is unchanged.
19. In the save dialog, pick an existing unrelated PDF. Confirm Windows asks before replacing it.
20. Start a merge of several larger PDFs and press **Cancel** while it shows "Reading…" or "Merging…". Confirm "The merge was cancelled" and that no output file exists.
21. While a merge is running, confirm **Merge PDFs**, **Add PDFs**, reorder and remove buttons are disabled.
22. Navigate keyboard-only (Tab / Shift+Tab / Enter / Space) through the dashboard and merge view. Confirm visible focus and that all actions are reachable.
23. Confirm the "Planned for later versions" tools are not clickable and are labelled "Not available yet".

To check that inputs are unchanged (step 12), record hashes before and after:

```powershell
Get-FileHash .\a.pdf, .\b.pdf -Algorithm SHA256
```

## Automated test suggestions

Test pure functions separately where practical:
- filename extraction from Windows paths
- deduplication of selected paths
- ordering after move-up/move-down
- validation for fewer than two input files
- output path is not the same as any input path
- merge output page count equals the sum of input page counts
- output page order follows input order

All of the above are implemented in `src/**/*.test.ts` and run with `npm test`.

## Report format

For each test, record:
- Pass / Fail / Not run
- Input fixture names (not confidential paths)
- Expected result
- Actual result
- Error details if applicable

Never mark an unrun test as passed.
