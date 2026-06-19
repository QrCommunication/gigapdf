import { AppErrorState } from "@/components/dashboard/app-error-state";

// ---------------------------------------------------------------------------
// 403 SPA — « accès refusé » du périmètre applicatif, URL /forbidden.
//
// Vit dans le groupe (dashboard) → hérite du chrome (sidebar + AuthGuard) :
// l'utilisateur est authentifié (il a une session) mais n'est NI propriétaire
// NI destinataire d'un partage de la ressource visée. Brancher ici un refus
// d'API owner-or-shared : `router.replace("/forbidden")` après un fetch 403.
//
// AuthGuard ne contrôle que la présence d'une session → laisse passer un user
// connecté (≠ login). Le rendu est dynamique (force-dynamic du layout dashboard
// + noindex hérité du root layout (app)).
//
// URL distincte de la page MARKETING (site)/[locale]/403 (servie à /fr/403 et
// /en/403) : `/forbidden` est routé vers le périmètre APP (non préfixé, locale
// par cookie) grâce à l'exclusion `forbidden` du matcher de proxy.ts. Pas de
// collision avec le bare `/403` (qui, en as-needed, irait au marketing fr).
// ---------------------------------------------------------------------------

export default function DashboardForbiddenPage() {
  return <AppErrorState variant="forbidden" />;
}
