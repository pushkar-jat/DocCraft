import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getEngineStatus, type EngineStatus } from "../services/native";

interface EnginesValue {
  status: EngineStatus | null;
  checking: boolean;
  refresh: () => void;
}

const EnginesContext = createContext<EnginesValue>({ status: null, checking: false, refresh: () => undefined });

/** Detects LibreOffice and Tesseract once at start-up; tools can ask to check again. */
export function EnginesProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(() => {
    setChecking(true);
    getEngineStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(refresh, [refresh]);

  return <EnginesContext.Provider value={{ status, checking, refresh }}>{children}</EnginesContext.Provider>;
}

export function useEngines(): EnginesValue {
  return useContext(EnginesContext);
}
