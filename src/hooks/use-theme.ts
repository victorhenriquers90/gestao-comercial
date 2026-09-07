import { useEffect, useState } from "react";

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = localStorage.getItem("gc-theme");
    const dark = stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(dark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  function toggle() {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("gc-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return { theme, toggle };
}
