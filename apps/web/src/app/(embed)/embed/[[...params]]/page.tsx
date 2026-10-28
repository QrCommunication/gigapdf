import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { locales } from "@/i18n/config";
import { EmbedEditor } from "./embed-editor";

interface EmbedPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Embeddable editor, rendered inside third-party iframes.
 *
 * Locale precedence: the `?locale=` query param set by the embed SDK
 * (`GigaPdfOptions.locale`) wins, because the host page knows its users'
 * language. Without it (or with an unsupported value) the request locale
 * resolved by src/i18n/request.ts applies (cookie, then Accept-Language —
 * the cookie is usually absent in a cross-site iframe).
 *
 * The embed root layout ((embed)/layout.tsx) already provides messages for
 * the request locale and sets `<html lang>` to it; it cannot read
 * searchParams. When the SDK asks for another locale, this subtree gets its
 * own provider so the editor chrome (toolbar, sidebar…) switches language too.
 * In both cases the editor is wrapped in an element carrying the effective
 * `lang`, so assistive technologies and hyphenation follow the language
 * actually displayed. `display: contents` keeps that wrapper out of the
 * layout (the editor sizes itself with `h-screen`).
 */
export default async function EmbedPage({ searchParams }: EmbedPageProps) {
  const { locale: requestedLocale } = await searchParams;
  const sdkLocale =
    typeof requestedLocale === "string" && hasLocale(locales, requestedLocale)
      ? requestedLocale
      : null;

  const requestLocale = await getLocale();

  if (sdkLocale === null || sdkLocale === requestLocale) {
    return (
      <div lang={requestLocale} className="contents">
        <EmbedEditor />
      </div>
    );
  }

  const messages = await getMessages({ locale: sdkLocale });

  return (
    <NextIntlClientProvider locale={sdkLocale} messages={messages}>
      <div lang={sdkLocale} className="contents">
        <EmbedEditor />
      </div>
    </NextIntlClientProvider>
  );
}
