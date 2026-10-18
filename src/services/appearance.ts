// Applies the native Windows look: the Mica flag and the user's Windows accent colour.
import { getWindowAppearance } from "./native";

const ACCENT_VARIABLES = {
  dark1: "--win-accent-dark1",
  dark2: "--win-accent-dark2",
  light1: "--win-accent-light1",
  light2: "--win-accent-light2",
} as const;

async function refresh(): Promise<void> {
  const root = document.documentElement;
  try {
    const appearance = await getWindowAppearance();
    root.classList.toggle("mica", appearance.mica);
    for (const [key, variable] of Object.entries(ACCENT_VARIABLES)) {
      const colour = appearance.accent?.[key as keyof typeof ACCENT_VARIABLES];
      if (colour) root.style.setProperty(variable, colour);
      else root.style.removeProperty(variable);
    }
  } catch {
    // Not running in the desktop shell, or the setting is unavailable: keep the built-in colours.
  }
}

/** Applies the native look now and again whenever the window regains focus (the accent may have changed). */
export function applyNativeAppearance(): void {
  void refresh();
  window.addEventListener("focus", () => void refresh());
}
