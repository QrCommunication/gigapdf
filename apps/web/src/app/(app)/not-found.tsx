import { AppErrorState } from "@/components/dashboard/app-error-state";

// ---------------------------------------------------------------------------
// 404 SPA — périmètre applicatif ((app)/*).
//
// Sobre, cohérent avec le dashboard. Rendu à l'intérieur du root layout (app)
// (force-dynamic) qui fournit NextIntlClientProvider (locale par cookie), donc
// AppErrorState (client) peut consommer useTranslations.
// ---------------------------------------------------------------------------

export default function AppNotFound() {
  return <AppErrorState variant="notFound" />;
}
