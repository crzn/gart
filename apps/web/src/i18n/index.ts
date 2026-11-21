import { useSyncExternalStore } from "react";
import uk from "./uk.json";
import en from "./en.json";

export type Lang = "uk" | "en";
export type MessageKey = keyof typeof uk;

const catalogs: Record<Lang, Record<MessageKey, string>> = { uk, en };
const STORAGE_KEY = "gart.lang";

function readStored(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "uk" || v === "en") return v;
  } catch {
    // Storage may be unavailable (private mode); fall back to the default.
  }
  return "uk"; // Ukrainian is the default language.
}

let current: Lang = readStored();
const listeners = new Set<() => void>();

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type Translate = (key: MessageKey) => string;
// One stable function per language: components list `t` in effect dependencies, so a fresh
// closure on every render would re-run those effects forever.
const translators: Record<Lang, Translate> = {
  uk: (key) => catalogs.uk[key],
  en: (key) => catalogs.en[key],
};

export function useLang(): { lang: Lang; t: Translate } {
  const lang = useSyncExternalStore(subscribe, () => current);
  return { lang, t: translators[lang] };
}

document.documentElement.lang = current;
