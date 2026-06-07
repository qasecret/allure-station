export type Theme = "system" | "light" | "dark";

const KEY = "allure-station-theme";

export function getTheme(): Theme {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem(KEY)) as Theme | null;
  return t === "light" || t === "dark" || t === "system" ? t : "system";
}

/** Apply the theme to <html>: toggles the `dark` class. "system" follows prefers-color-scheme. */
export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const dark = t === "dark" || (t === "system" &&
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  el.classList.toggle("dark", dark);
}

export function setTheme(t: Theme): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, t);
  applyTheme(t);
}
