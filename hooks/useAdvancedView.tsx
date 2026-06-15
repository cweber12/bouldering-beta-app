"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "advancedView";

interface AdvancedViewContextValue {
  /** When true, diagnostic / power-user surfaces are revealed across the app. */
  advanced: boolean;
  setAdvanced: (on: boolean) => void;
  toggle: () => void;
}

const AdvancedViewContext = createContext<AdvancedViewContextValue | null>(null);

/** Reads the persisted preference; defaults to OFF for everyone. */
function readStored(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * "Developer view" preference — one persisted, app-wide boolean that gates
 * engineering-grade surfaces (ORB feature dots, match statistics, model/ORB
 * internals, raw algorithm copy) so the default experience stays clean.
 *
 * Mirrors the ThemeProvider pattern but needs no FOUC/<html>-class handling:
 * it carries no visual class, so there is no hydration flash to avoid. State
 * starts OFF (SSR-safe) and syncs to the stored value on mount.
 */
export function AdvancedViewProvider({ children }: { children: ReactNode }) {
  const [advanced, setAdvancedState] = useState(false);

  // Sync to the persisted value on first client render (external-store read).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAdvancedState(readStored()); }, []);

  const persist = useCallback((on: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      // ignore — localStorage may be unavailable
    }
  }, []);

  const setAdvanced = useCallback((on: boolean) => {
    setAdvancedState(on);
    persist(on);
  }, [persist]);

  const toggle = useCallback(() => {
    setAdvancedState(prev => {
      const next = !prev;
      persist(next);
      return next;
    });
  }, [persist]);

  return (
    <AdvancedViewContext.Provider value={{ advanced, setAdvanced, toggle }}>
      {children}
    </AdvancedViewContext.Provider>
  );
}

export function useAdvancedView(): AdvancedViewContextValue {
  const ctx = useContext(AdvancedViewContext);
  if (!ctx) throw new Error("useAdvancedView must be used inside <AdvancedViewProvider>");
  return ctx;
}
