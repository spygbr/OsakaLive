"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createT, type Lang, type TranslationKey } from "./translations";

type ContextValue = {
  lang: Lang;
  toggle: () => void;
  t: (key: TranslationKey) => string;
};

const LangContext = createContext<ContextValue>({
  lang: "en",
  toggle: () => {},
  t: createT("en"),
});

export function LangProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  initialLang: Lang;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const router = useRouter();

  const toggle = useCallback(() => {
    const next: Lang = lang === "en" ? "ja" : "en";
    setLang(next);
    // Persist in cookie (1 year) — server components will pick this up on refresh
    document.cookie = `lang=${next};path=/;max-age=31536000;SameSite=Lax`;
    // Refresh server components without a full page navigation
    router.refresh();
  }, [lang, router]);

  const t = useCallback((key: TranslationKey) => createT(lang)(key), [lang]);

  return (
    <LangContext.Provider value={{ lang, toggle, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): ContextValue {
  return useContext(LangContext);
}
