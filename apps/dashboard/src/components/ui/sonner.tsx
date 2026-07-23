"use client";

import { Toaster as Sonner } from "sonner";
import { useTheme } from "next-themes";

export function Toaster() {
  const { theme = "system" } = useTheme();
  return <Sonner theme={theme as "light" | "dark" | "system"} richColors closeButton />;
}
