import { createContext, useContext, useEffect, useMemo, useState } from "react";

export const THEME_STORAGE_KEY = "header-theme";
export const THEME_MODES = ["auto", "light", "dark"];

export function getOsTheme() {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getStoredMode() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (THEME_MODES.includes(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "auto";
}

export function resolveTheme(mode) {
  return mode === "auto" ? getOsTheme() : mode;
}

export function applyTheme(mode) {
  const effective = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(`theme-${effective}`);
  root.setAttribute("data-theme", effective);
  root.setAttribute("data-theme-mode", mode);
  document.body?.setAttribute("data-theme", effective);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  return effective;
}

const ThemeContext = createContext({
  mode: "auto",
  theme: "dark",
  setMode: () => {},
});

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(getStoredMode);
  const [theme, setTheme] = useState(() => resolveTheme(getStoredMode()));

  useEffect(() => {
    setTheme(applyTheme(mode));
  }, [mode]);

  useEffect(() => {
    if (mode !== "auto") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(applyTheme("auto"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const value = useMemo(
    () => ({
      mode,
      theme,
      setMode: setModeState,
    }),
    [mode, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
