"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "theme";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Reads the applied theme from the <html> element class list. */
function readAppliedTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("theme-light") ? "light" : "dark";
}

/** Applies the theme class to <html> and persists to localStorage. */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light") {
    root.classList.add("theme-light");
    root.classList.remove("theme-dark");
  } else {
    root.classList.remove("theme-light");
    root.classList.add("theme-dark");
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore — localStorage may be unavailable
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR-safe initial state. The FOUC inline script in layout.tsx applies the
  // correct class before React hydrates, but readAppliedTheme() returns "dark"
  // during SSR (document is undefined), so React preserves "dark" through
  // hydration. The mount effect below corrects the mismatch without overwriting
  // the FOUC-applied class in the meantime.
  const [theme, setTheme] = useState<Theme>("dark");

  // On first client render, sync React state to whatever the FOUC script
  // applied (localStorage value → system preference → dark). This is the
  // standard React pattern for reading from an external store on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTheme(readAppliedTheme()); }, []);

  // Propagate state changes to the DOM. Skip the very first run produced by
  // the initial render (theme="dark" from SSR) so we don't overwrite the class
  // that FOUC correctly set before React hydrated. After the mount sync above
  // updates state, subsequent runs are user-initiated and should apply normally.
  const syncDone = useRef(false);
  useEffect(() => {
    if (!syncDone.current) { syncDone.current = true; return; }
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(prev => (prev === "dark" ? "light" : "dark"));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
