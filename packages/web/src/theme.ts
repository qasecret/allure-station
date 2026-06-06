export type Theme = "system" | "light" | "dark";

const KEY = "allure-station-theme";

export function getTheme(): Theme {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem(KEY)) as Theme | null;
  return t === "light" || t === "dark" || t === "system" ? t : "system";
}

/** Apply the theme to <html>: "system" drops the attribute so prefers-color-scheme decides. */
export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (t === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
}

export function setTheme(t: Theme): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, t);
  applyTheme(t);
}
