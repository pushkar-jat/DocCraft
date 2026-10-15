# Windows Development Setup

This guide assumes Windows 10/11 x64. The original handoff used `C:\dev\doccraft`; the project currently lives at `D:\Work Profile\Projects\DocCraft`. Any folder works, including paths with spaces.

## 1. Install Git and Node.js

Open PowerShell. If `winget` is available:

```powershell
winget install --id Git.Git
winget install --id OpenJS.NodeJS.LTS
```

Close and reopen PowerShell, then verify:

```powershell
git --version
node --version
npm --version
```

Use a currently supported Node.js LTS release. If `winget` is unavailable, install from the official Git and Node.js websites.

## 2. Install Rust

```powershell
winget install --id Rustlang.Rustup
```

Close and reopen PowerShell. Then:

```powershell
rustup default stable-msvc
rustc --version
cargo --version
rustup show
```

If Rust is already installed, do not install it again unnecessarily. Confirm the active toolchain is stable MSVC.

If `cargo` is "not recognized" although Rust is installed, `%USERPROFILE%\.cargo\bin` is missing from `PATH`. Reopen the terminal after installing rustup, or add that folder to your user `PATH`.

## 3. Install Microsoft C++ Build Tools (required)

Rust on Windows (MSVC toolchain) needs Microsoft's linker (`link.exe`) and the Windows SDK. Without them every Rust build fails with `linking with link.exe failed`.

Option A — winget (run from an **elevated** PowerShell; large download):

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

(The newer `Microsoft.VisualStudio.BuildTools` package, Build Tools 2026, should also work with the same workload ID; 2022 is the version Tauri's guide has long documented. Both IDs were confirmed in the winget catalog on 2026-10-15.)

Option B — download Visual Studio Build Tools from Microsoft's official site, run the installer, select the **Desktop development with C++** workload (keep the default MSVC and Windows 11 SDK components) and install.

Restart the terminal after installation. Official Tauri prerequisite guide:
https://v2.tauri.app/start/prerequisites/

## 4. Verify WebView2

Tauri uses Microsoft Edge WebView2 to render the UI on Windows. It is present on most supported modern Windows systems. If the app reports it missing, install the WebView2 Evergreen Runtime from Microsoft's official download page.

## 5. Install Claude Code

Use the official Claude Code installation instructions for Windows. The current official guide provides a PowerShell installer command:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Review the official instructions before running an installer:
https://support.claude.com/en/articles/14552382-your-first-day-in-claude-code

Verify:

```powershell
claude --version
claude doctor
```

Start Claude Code and complete sign-in as prompted:

```powershell
claude
```

If you use the npm installation route instead, follow Anthropic's current official instructions. Do not use `sudo` on Windows or paste API keys into project files.

## 6. Project scaffold (already done)

The project was scaffolded with:

```powershell
npm create tauri-app@latest -- . --template react-ts --manager npm --identifier com.doccraft.app --tauri-version 2 -y
```

(create-tauri-app 4.8.0, React + TypeScript, npm, identifier `com.doccraft.app`.) You do not need to run this again.

## 7. Install dependencies

From the project root:

```powershell
npm install
```

Rust crates are downloaded automatically by the first `npm run tauri dev` / `npm run tauri build`.

## 7b. Optional runtime engines (Word to PDF, OCR)

DocCraft does not bundle these. It detects them at start-up and shows setup guidance in the tools that need them. Install whichever you need:

```powershell
winget install TheDocumentFoundation.LibreOffice   # Word/ODT/RTF to PDF (about 350 MB)
winget install UB-Mannheim.TesseractOCR            # OCR; includes English language data
```

Detection looks in the standard install locations (`%ProgramFiles%\LibreOffice\program\soffice.exe`, `%ProgramFiles%\Tesseract-OCR\tesseract.exe`, `%LOCALAPPDATA%\Programs\Tesseract-OCR`) and on `PATH`. More OCR languages: put the `<lang>.traineddata` files from the official tessdata repository into `C:\Program Files\Tesseract-OCR\tessdata`, then click **Check again** in the OCR tool.

Tested versions: LibreOffice 26.2.1.2, Tesseract 5.4.0.20240606.

## 8. Run and verify the app

See the README for the full command list. In short:

```powershell
npm test               # unit tests (no desktop window needed)
npm run build          # type-check + frontend production build
npm run tauri dev      # launch the desktop app in development mode
npm run tauri build    # Windows production build and installers
```

## Troubleshooting checklist

- `rustc` or `cargo` not found: reopen PowerShell; check Rust installation and PATH.
- `linking with link.exe failed` / "you may need to install Visual Studio build tools": install step 3. In Git Bash, a message like `link: extra operand` means Git's own `link` tool was found instead of Microsoft's, which also means the Build Tools are missing.
- WebView2 errors: install or repair WebView2 Runtime.
- npm package errors: check Node/npm versions and network connectivity.
- Tauri capability errors (e.g. "forbidden path" or "not allowed"): inspect `src-tauri/capabilities/default.json` and follow current Tauri 2 plugin permission documentation; do not solve the issue by granting unrestricted access.
- Port 1420 already in use when running `npm run tauri dev`: close the other dev server, since Tauri expects that fixed port.
- Any installer fails with **Windows Installer Error 1719** (Visual Studio Build Tools exit code 8012): check that `C:\Windows\SysWOW64\msiexec.exe` exists. On the development machine it was missing; an elevated `sfc /scannow` restored it. A reboot alone did not help.
- winget exit code 1602 while installing: the Windows administrator (UAC) prompt was declined or timed out.
- Word to PDF says LibreOffice was not found although it is installed: it must be in a standard location or on PATH; click **Check again** after installing.
- OCR says no language data is installed: add `.traineddata` files to the Tesseract `tessdata` folder.
- Build failures: copy the first meaningful error and ask Claude Code to diagnose it. Include the command run and the relevant error output.
