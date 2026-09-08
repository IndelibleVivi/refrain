import { useState } from "react";
import { resolveRefrainLocale, uiCopy, type RefrainLocale } from "./ui-copy.js";

export function useRefrainLocale(initial?: RefrainLocale) {
  return useState<RefrainLocale>(
    () =>
      initial ??
      resolveRefrainLocale(
        typeof navigator === "undefined" ? "en" : navigator.language,
      ),
  );
}

export function LanguageSwitch({
  locale,
  onChange,
}: {
  locale: RefrainLocale;
  onChange: (locale: RefrainLocale) => void;
}) {
  return (
    <button
      type="button"
      className="refrain-language"
      aria-label={uiCopy(locale).language}
      onClick={() => onChange(locale === "en" ? "zh-CN" : "en")}
    >
      <span lang="en" data-active={locale === "en"}>
        EN
      </span>
      <span aria-hidden="true"> / </span>
      <span lang="zh-CN" data-active={locale === "zh-CN"}>
        中文
      </span>
    </button>
  );
}
