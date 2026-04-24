import { z } from "zod";
import type { PageThemeSchema, THEME_PRESETS } from "./page-schema.js";

export type ThemePreset = (typeof THEME_PRESETS)[number];
export type PageTheme = z.infer<typeof PageThemeSchema>;

export type ResolvedTheme = {
  preset: ThemePreset;
  fontFamily: string;
  baseFontSize: number;
  lineHeight: number;
  bgColor: string;
  textColor: string;
  mutedTextColor: string;
  accentColor: string;
  spaceBase: number;
  radius: number;
};

const PRESETS: Record<ThemePreset, Omit<ResolvedTheme, "preset">> = {
  modern: {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    baseFontSize: 16,
    lineHeight: 1.5,
    bgColor: "#f4f6fb",
    textColor: "#0f172a",
    mutedTextColor: "#64748b",
    accentColor: "#2563eb",
    spaceBase: 8,
    radius: 18,
  },
  minimal: {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    baseFontSize: 16,
    lineHeight: 1.55,
    bgColor: "#ffffff",
    textColor: "#0b1220",
    mutedTextColor: "#526178",
    accentColor: "#0b1220",
    spaceBase: 8,
    radius: 16,
  },
  editorial: {
    fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    baseFontSize: 17,
    lineHeight: 1.65,
    bgColor: "#fbfbf8",
    textColor: "#111827",
    mutedTextColor: "#556070",
    accentColor: "#111827",
    spaceBase: 9,
    radius: 14,
  },
  playful: {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    baseFontSize: 16,
    lineHeight: 1.55,
    bgColor: "#f6f0ff",
    textColor: "#1f1147",
    mutedTextColor: "#5b4a8a",
    accentColor: "#7c3aed",
    spaceBase: 9,
    radius: 20,
  },
};

export function resolveTheme(theme: PageTheme | null | undefined): ResolvedTheme {
  const preset: ThemePreset = (theme?.preset ?? "modern") as ThemePreset;
  const base = PRESETS[preset];

  return {
    preset,
    fontFamily: theme?.fontFamily ?? base.fontFamily,
    baseFontSize: theme?.baseFontSize ?? base.baseFontSize,
    lineHeight: theme?.lineHeight ?? base.lineHeight,
    bgColor: theme?.bgColor ?? base.bgColor,
    textColor: theme?.textColor ?? base.textColor,
    mutedTextColor: theme?.mutedTextColor ?? base.mutedTextColor,
    accentColor: theme?.accentColor ?? base.accentColor,
    spaceBase: theme?.spaceBase ?? base.spaceBase,
    radius: theme?.radius ?? base.radius,
  };
}

export function resolvedThemeToCssVars(resolved: ResolvedTheme): Record<string, string> {
  const s1 = resolved.spaceBase;
  const s2 = Math.round(resolved.spaceBase * 1.5);
  const s3 = Math.round(resolved.spaceBase * 2);
  const s4 = Math.round(resolved.spaceBase * 3);

  const h1 = Math.round(resolved.baseFontSize * 2.75);
  const h3 = Math.round(resolved.baseFontSize * 1.25);

  return {
    "--site-bg": resolved.bgColor,
    "--site-text": resolved.textColor,
    "--site-muted": resolved.mutedTextColor,
    "--site-accent": resolved.accentColor,
    "--site-font-family": resolved.fontFamily,
    "--site-font-size": `${resolved.baseFontSize}px`,
    "--site-line-height": String(resolved.lineHeight),
    "--site-h1-size": `${h1}px`,
    "--site-h3-size": `${h3}px`,
    "--site-radius": `${resolved.radius}px`,
    "--site-space-1": `${s1}px`,
    "--site-space-2": `${s2}px`,
    "--site-space-3": `${s3}px`,
    "--site-space-4": `${s4}px`,
  };
}
