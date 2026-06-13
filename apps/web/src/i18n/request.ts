import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { defaultLocale, locales, type Locale } from './config';
import { routing } from './routing';

async function loadMessages(locale: Locale) {
  return (await import(`../../messages/${locale}.json`)).default;
}

export default getRequestConfig(async ({ requestLocale }) => {
  // 1. Périmètre public sous [locale] : la locale du segment d'URL prime.
  //    `requestLocale` est résolu via setRequestLocale() (rendu statique) ou
  //    via le header X-NEXT-INTL-LOCALE posé par le proxy next-intl (runtime).
  const requested = await requestLocale;
  if (requested && hasLocale(routing.locales, requested)) {
    return {
      locale: requested,
      messages: await loadMessages(requested),
    };
  }

  // 2. Hors périmètre [locale] (dashboard, editor, embed…) : résolution
  //    historique par cookie, inchangée.
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get('locale')?.value;

  if (localeCookie && locales.includes(localeCookie as Locale)) {
    return {
      locale: localeCookie as Locale,
      messages: await loadMessages(localeCookie as Locale),
    };
  }

  // 3. Puis l'en-tête Accept-Language.
  const headersList = await headers();
  const acceptLanguage = headersList.get('Accept-Language');

  if (acceptLanguage) {
    const langs = acceptLanguage.split(',');
    for (const lang of langs) {
      const code = lang.split(';')[0]?.trim().substring(0, 2);
      if (code && locales.includes(code as Locale)) {
        return {
          locale: code as Locale,
          messages: await loadMessages(code as Locale),
        };
      }
    }
  }

  // 4. Fallback sur la locale par défaut.
  return {
    locale: defaultLocale,
    messages: await loadMessages(defaultLocale),
  };
});
