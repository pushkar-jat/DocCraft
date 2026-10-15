import { useState } from "react";
import "./App.css";
import { Dashboard, type ToolId } from "./components/Dashboard";
import { LogoMark } from "./components/Icons";
import { MergeView } from "./components/MergeView";
import { BatchView } from "./components/tools/BatchView";
import { CompressView } from "./components/tools/CompressView";
import { ImagesToPdfView } from "./components/tools/ImagesToPdfView";
import { OcrView } from "./components/tools/OcrView";
import { PdfToWordView } from "./components/tools/PdfToWordView";
import { SplitView } from "./components/tools/SplitView";
import { WordToPdfView } from "./components/tools/WordToPdfView";
import { EnginesProvider } from "./state/EnginesContext";
import { useMergeTool } from "./state/useMergeTool";

type View = "dashboard" | ToolId;

function App() {
  const [view, setView] = useState<View>("dashboard");
  // Lives here so the merge selection survives a trip back to the dashboard.
  const mergeTool = useMergeTool();
  const back = () => setView("dashboard");

  const content = (() => {
    switch (view) {
      case "dashboard":
        return <Dashboard onOpen={setView} mergeCount={mergeTool.state.files.length} />;
      case "merge":
        return <MergeView tool={mergeTool} onBack={back} />;
      case "split":
      case "extract":
        return <SplitView key={view} mode={view} onBack={back} />;
      case "compress":
        return <CompressView onBack={back} />;
      case "word-to-pdf":
        return <WordToPdfView onBack={back} />;
      case "pdf-to-word":
        return <PdfToWordView onBack={back} />;
      case "images-to-pdf":
        return <ImagesToPdfView onBack={back} />;
      case "ocr":
        return <OcrView onBack={back} />;
      case "batch":
        return <BatchView onBack={back} />;
    }
  })();

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
