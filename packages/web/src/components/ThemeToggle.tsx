import { useState } from "react";
import { getTheme, setTheme, type Theme } from "../theme.js";

/** Fixed top-right color-theme selector (system / light / dark), persisted to localStorage. */
export function ThemeToggle() {
  const [theme, set] = useState<Theme>(getTheme());
  return (
    <select
      aria-label="Color theme"
      value={theme}
      onChange={(e) => { const t = e.target.value as Theme; set(t); setTheme(t); }}
      style={{ position: "fixed", top: 8, right: 8, fontSize: 12, zIndex: 10 }}
    >
      <option value="system">🖥 System</option>
      <option value="light">☀ Light</option>
      <option value="dark">🌙 Dark</option>
    </select>
  );
}
