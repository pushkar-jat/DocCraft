import { useState } from "react";
import "./App.css";
import { Dashboard } from "./components/Dashboard";
import { LogoMark } from "./components/Icons";
import { MergeView } from "./components/MergeView";
import { useMergeTool } from "./state/useMergeTool";

type View = "dashboard" | "merge";

function App() {
  const [view, setView] = useState<View>("dashboard");
  // Lives here so the selection survives a trip back to the dashboard.
  const mergeTool = useMergeTool();

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="brand"
          onClick={() => setView("dashboard")}
          disabled={mergeTool.busy}
          aria-label="DocCraft dashboard"
        >
          <LogoMark />
          <span className="brand-name">DocCraft</span>
        </button>
        <span className="header-note">Offline · files stay on this device</span>
      </header>
      <main className="app-main">
        {view === "dashboard" ? (
          <Dashboard onOpenMerge={() => setView("merge")} selectedCount={mergeTool.state.files.length} />
        ) : (
          <MergeView tool={mergeTool} onBack={() => setView("dashboard")} />
        )}
      </main>
    </div>
  );
}

export default App;
