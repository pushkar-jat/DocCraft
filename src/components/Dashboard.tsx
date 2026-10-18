import { useEngines } from "../state/EnginesContext";
import { CATEGORIES, TOOLS, type ToolId } from "../tools";
import { LockIcon } from "./Icons";

const ENGINE_NAMES = { libreOffice: "LibreOffice", tesseract: "Tesseract" } as const;

interface DashboardProps {
  onOpen: (tool: ToolId) => void;
  mergeCount: number;
}

export function Dashboard({ onOpen, mergeCount }: DashboardProps) {
  const { status, checking } = useEngines();

  return (
    <div className="dashboard">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">Your PDF tools, on your computer</h1>
        <p className="hero-text">DocCraft works offline. Your documents are processed on this device and are never uploaded.</p>
        <p className="privacy-pill">
          <LockIcon width={16} height={16} /> Local processing · No account · No tracking
        </p>
      </section>

      {CATEGORIES.map((category) => {
        const tools = TOOLS.filter((tool) => tool.category === category.id);
        if (tools.length === 0) return null;
        return (
          <section key={category.id} aria-labelledby={`cat-${category.id}`}>
            <h2 id={`cat-${category.id}`} className="section-title">
              {category.title}
            </h2>
            <ul className="tool-grid">
              {tools.map((tool) => {
                const missing = tool.engine !== undefined && !checking && !(status?.[tool.engine].available ?? false);
                if (tool.unavailable) {
                  return (
                    <li key={tool.id}>
                      <div className="tool-tile tool-tile--unavailable" aria-label={`${tool.title} — ${tool.unavailable}`}>
                        <span className="tool-icon tool-icon--muted">{tool.icon}</span>
                        <span className="tool-body">
                          <span className="tool-title">
                            {tool.title} <span className="badge">Not available yet</span>
                          </span>
                          <span className="tool-description">{tool.description}</span>
                        </span>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={tool.id}>
                    <button type="button" className="tool-tile" onClick={() => onOpen(tool.id)}>
                      <span className="tool-icon">{tool.icon}</span>
                      <span className="tool-body">
                        <span className="tool-title">
                          {tool.title}
                          {tool.id === "merge" && mergeCount > 0 && <span className="badge badge--accent">{mergeCount} selected</span>}
                        </span>
                        <span className="tool-description">{tool.description}</span>
                        {tool.engine && (
                          <span className={`engine-tag ${missing ? "engine-tag--missing" : ""}`}>
                            {missing ? `Needs ${ENGINE_NAMES[tool.engine]} (not found)` : `Uses ${ENGINE_NAMES[tool.engine]}`}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
