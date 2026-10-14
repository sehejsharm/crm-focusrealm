import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";
const Ctx = createContext<{ theme: Theme; toggle: (e?: { clientX: number; clientY: number }) => void }>({ theme: "light", toggle: () => {} });

function read(): Theme {
  try {
    return localStorage.getItem("fr-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Light (blue & white) by default; dark on request, remembered per browser. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(read);

  const apply = useCallback((next: Theme) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("fr-theme", next);
    } catch {
      /* private mode: fine, it just won't persist */
    }
    setTheme(next);
  }, []);

  const toggle = useCallback(
    (e?: { clientX: number; clientY: number }) => {
      const next: Theme = theme === "dark" ? "light" : "dark";
      const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!doc.startViewTransition || reduce) return apply(next);
      // Circular reveal from the toggle button.
      const x = e?.clientX ?? window.innerWidth - 40;
      const y = e?.clientY ?? 40;
      const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const t = doc.startViewTransition(() => flushSync(() => apply(next)));
      t.ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 650, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      });
    },
    [theme, apply],
  );

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
