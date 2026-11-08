import { useEffect, useState } from "react";
import { defaultSettings, normalizeSettings, type AppSettings, gravityValue, gravityLabel, unitValue } from "./settings-model";

export const SETTINGS_KEY = "brewfather-settings";
export const SETTINGS_EVENT = "brewfather-settings-change";
export function readSettings(): AppSettings {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null")); } catch { return { ...defaultSettings }; }
}
export function saveSettings(patch: Partial<AppSettings>) {
  const next = normalizeSettings({ ...readSettings(), ...patch });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(SETTINGS_EVENT));
  return next;
}
export function useSettings() {
  const [settings, setSettings] = useState(readSettings);
  useEffect(() => {
    const sync = () => setSettings(readSettings());
    window.addEventListener(SETTINGS_EVENT, sync); window.addEventListener("storage", sync);
    return () => { window.removeEventListener(SETTINGS_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return [settings, saveSettings] as const;
}
export const getLocale = (s: AppSettings = readSettings()) => s.language || navigator.language || "pt-BR";
export function SettingsTheme() {
  const [s] = useSettings();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const darkMode = s.theme === "dark" || (s.theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", darkMode);
      document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
      document.documentElement.lang = getLocale(s);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [s]);
  return null;
}
const number = (v: number, d = 1, locale = getLocale()) => Number(v).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
export const displayGravity = (v: number, s = readSettings()) => `${number(gravityValue(v, s), s.gravity === "sg" && s.sgFormat === "decimal" ? 3 : 1, getLocale(s))}${s.gravity === "sg" && s.sgFormat === "decimal" ? "" : ` ${gravityLabel(s)}`}`;
export const displayColor = (v: number, s = readSettings()) => `${number(s.color === "ebc" ? v * 1.97 : v, 1, getLocale(s))} ${s.color.toUpperCase()}`;
export const displayUnit = (v: number, kind: Parameters<typeof unitValue>[1], s = readSettings(), d = 1) => `${number(unitValue(v, kind, s), d, getLocale(s))} ${s[kind]}`;
export function displayDate(value: string | Date, s = readSettings(), withTime = false) {
  const d = new Date(value);
  const locale = s.dateFormat === "mdy" ? "en-US" : s.dateFormat === "dmy" ? "pt-BR" : getLocale(s);
  const date = s.dateFormat === "iso" ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d.toLocaleDateString(locale);
  return withTime ? `${date} ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: s.timeFormat === "auto" ? undefined : s.timeFormat === "12" })}` : date;
}