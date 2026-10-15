// Copies pdf.js data files (character maps, standard fonts, WebAssembly image decoders, ICC
// profiles) into public/pdfjs so they are bundled with the app and loaded locally, never from a CDN.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "pdfjs-dist");
const target = join(root, "public", "pdfjs");

if (!existsSync(source)) {
  console.error("pdfjs-dist is not installed. Run `npm install` first.");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(source, folder), join(target, folder), {
    recursive: true,
    // The Liberation fonts are GPLv2 (with a font exception). They are left out so the installer
    // contains no GPL files; pdf.js falls back to system fonts for those standard fonts.
    filter: (path) => !/[\\/]Liberation[^\\/]*$/i.test(path) && !/LICENSE_LIBERATION$/i.test(path),
  });
}
console.log("Copied pdf.js assets to public/pdfjs");
