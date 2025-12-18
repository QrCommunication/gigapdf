import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { defaultLocale, locales, type Locale } from './config';

export default getRequestConfig(async () => {
  // Try to get locale from cookie first
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get('locale')?.value;

  if (localeCookie && locales.includes(localeCookie as Locale)) {
    return {
      locale: localeCookie as Locale,
      messages: (await import(`../../messages/${localeCookie}.json`)).default,
    };
  }

  // Then try to get from Accept-Language header
  const headersList = await headers();
  const acceptLanguage = headersList.get('Accept-Language');

  if (acceptLanguage) {
    const langs = acceptLanguage.split(',');
    for (const lang of langs) {
      const code = lang.split(';')[0]?.trim().substring(0, 2);
      if (code && locales.includes(code as Locale)) {
        return {
          locale: code as Locale,
          messages: (await import(`../../messages/${code}.json`)).default,
        };
      }
    }
  }

  // Fallback to default locale
  return {
    locale: defaultLocale,
    messages: (await import(`../../messages/${defaultLocale}.json`)).default,
  };
});
