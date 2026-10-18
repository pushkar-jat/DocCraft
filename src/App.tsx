import { useState, type ReactNode } from "react";
import "./App.css";
import { Dashboard } from "./components/Dashboard";
import { LogoMark } from "./components/Icons";
import { MergeView } from "./components/MergeView";
import { BatchView } from "./components/tools/BatchView";
import { CompressView } from "./components/tools/CompressView";
import { PdfToImagesView, PdfToMarkdownView } from "./components/tools/ConvertFromPdfViews";
import { CompareView, FormsView, PdfToExcelView } from "./components/tools/DataViews";
import { EditPdfView, RedactView, SignView } from "./components/tools/EditViews";
import { ImagesToPdfView } from "./components/tools/ImagesToPdfView";
import { OcrView } from "./components/tools/OcrView";
import { OrganizeView } from "./components/tools/OrganizeView";
import { CropView, PageNumbersView, RemovePagesView, RotateView, WatermarkView } from "./components/tools/PageEditViews";
import { PdfToWordView } from "./components/tools/PdfToWordView";
import { ProtectView, RepairView, UnlockView } from "./components/tools/SecurityViews";
import { ScanView } from "./components/tools/ScanView";
import { SplitView } from "./components/tools/SplitView";
import { PdfLibreOfficeView, WordToPdfView } from "./components/tools/WordToPdfView";
import { EnginesProvider } from "./state/EnginesContext";
import { useMergeTool } from "./state/useMergeTool";
import type { ToolId } from "./tools";

type View = "dashboard" | ToolId;

function App() {
  const [view, setView] = useState<View>("dashboard");
  // Lives here so the merge selection survives a trip back to the dashboard.
  const mergeTool = useMergeTool();
  const back = () => setView("dashboard");

  const screens: Partial<Record<ToolId, () => ReactNode>> = {
    merge: () => <MergeView tool={mergeTool} onBack={back} />,
    split: () => <SplitView key="split" mode="split" onBack={back} />,
    extract: () => <SplitView key="extract" mode="extract" onBack={back} />,
    "remove-pages": () => <RemovePagesView onBack={back} />,
    organize: () => <OrganizeView onBack={back} />,
    scan: () => <ScanView onBack={back} />,
    compress: () => <CompressView onBack={back} />,
    ocr: () => <OcrView onBack={back} />,
    batch: () => <BatchView onBack={back} />,
    "images-to-pdf": () => <ImagesToPdfView onBack={back} />,
    "word-to-pdf": () => <WordToPdfView key="word" kind="word" onBack={back} />,
    "powerpoint-to-pdf": () => <WordToPdfView key="powerpoint" kind="powerpoint" onBack={back} />,
    "excel-to-pdf": () => <WordToPdfView key="excel" kind="excel" onBack={back} />,
    "html-to-pdf": () => <WordToPdfView key="html" kind="html" onBack={back} />,
    "pdf-to-powerpoint": () => <PdfLibreOfficeView key="pptx" target="pptx" onBack={back} />,
    "pdf-to-pdfa": () => <PdfLibreOfficeView key="pdfa" target="pdfa" onBack={back} />,
    "pdf-to-images": () => <PdfToImagesView onBack={back} />,
    "pdf-to-word": () => <PdfToWordView onBack={back} />,
    rotate: () => <RotateView onBack={back} />,
    "page-numbers": () => <PageNumbersView onBack={back} />,
    watermark: () => <WatermarkView onBack={back} />,
    crop: () => <CropView onBack={back} />,
    "pdf-to-markdown": () => <PdfToMarkdownView onBack={back} />,
    repair: () => <RepairView onBack={back} />,
    "pdf-to-excel": () => <PdfToExcelView onBack={back} />,
    compare: () => <CompareView onBack={back} />,
    forms: () => <FormsView onBack={back} />,
    edit: () => <EditPdfView onBack={back} />,
    redact: () => <RedactView onBack={back} />,
    sign: () => <SignView onBack={back} />,
    protect: () => <ProtectView onBack={back} />,
    unlock: () => <UnlockView onBack={back} />,
  };

  const screen = view === "dashboard" ? undefined : screens[view];
  const content = screen ? screen() : <Dashboard onOpen={setView} mergeCount={mergeTool.state.files.length} />;

  return (
    <EnginesProvider>
      <div className="app">
        <header className="app-header">
          <span className="brand">
            <LogoMark />
            <span className="brand-name">DocCraft</span>
          </span>
          <span className="header-note">Offline · files stay on this device</span>
        </header>
        <main className="app-main">{content}</main>
      </div>
    </EnginesProvider>
  );
}

export default App;
