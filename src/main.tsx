import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyNativeAppearance } from "./services/appearance";

applyNativeAppearance();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
