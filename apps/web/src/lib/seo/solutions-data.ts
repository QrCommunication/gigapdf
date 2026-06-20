/**
 * Données SEO programmatique — pages solutions métiers (/solutions/[slug]).
 *
 * Contenu statique rédigé en français. Chaque page décrit des workflows
 * concrets du métier visé, appuyés exclusivement sur des capacités réelles
 * de GigaPDF (cf. tools-data.ts). Pas de gabarit à variables.
 */

import type { ToolFaqItem } from "./tools-data";

export interface SolutionWorkflow {
  title: string;
  description: string;
}

export interface SolutionData {
  slug: string;
  name: string;
  /** ≤ 60 caractères */
  metaTitle: string;
  /** ≤ 155 caractères */
  metaDescription: string;
  h1: string;
  /** 2-3 paragraphes rédigés, ancrés dans les douleurs du métier */
  intro: string[];
  workflows: SolutionWorkflow[];
  capabilities: string[];
  faq: ToolFaqItem[];
  relatedTools: string[];
  /** Nom d'icône lucide (mappé dans components/seo/tool-icon.tsx) */
  icon: string;
}

export const SOLUTIONS: SolutionData[] = [
  {
    slug: "avocats",
    name: "Avocats et juristes",
    metaTitle: "GigaPDF pour avocats : caviardage et signature",
    metaDescription:
      "Caviardage réel (texte supprimé du fichier), signature PKCS#7, PDF/A et chiffrement AES-256 : l'outil PDF des cabinets, open source et auto-hébergeable.",
    h1: "L'outil PDF des avocats : caviarder, signer, archiver en confiance",
    intro: [
      "Le scandale est documenté et récurrent : des conclusions et des pièces « caviardées » au rectangle noir dont le texte réapparaît d'un simple copier-coller, parce que l'outil a dessiné un masque par-dessus au lieu de supprimer le contenu. Pour un cabinet, c'est la violation du secret professionnel en un clic. La première exigence d'un outil PDF pour avocat est là : que la suppression soit une suppression.",
      "GigaPDF applique une redaction réelle, portée par le moteur PDF maison de GigaPDF : les opérateurs de texte situés dans la zone caviardée sont physiquement retirés du flux de contenu du fichier. Après traitement, le texte n'existe plus — ni au copier-coller, ni à l'extraction, ni dans les métadonnées de la zone. À cela s'ajoutent les trois autres piliers du document juridique : la signature numérique PKCS#7 avec votre propre certificat P12 (intégrité prouvable, identité vérifiable), l'archivage conforme PDF/A-1b et 2b, et le chiffrement AES-256 pour les pièces qui circulent.",
      "Reste la question que tout cabinet doit poser à son prestataire : où vont les documents ? GigaPDF y répond par construction — code open source auditable, et auto-hébergement complet : l'instance tourne sur le serveur du cabinet, les dossiers clients ne transitent par aucun cloud tiers. Le plan gratuit inclut l'intégralité des fonctions, 5 Go et 1000 documents.",
    ],
    workflows: [
      {
        title: "Caviarder une pièce avant communication",
        description:
          "Ouvrez la pièce dans l'éditeur, tracez les zones à occulter sur les passages couverts par le secret, appliquez : le moteur maison supprime le texte du fichier lui-même. Vérifiez en tentant un copier-coller sur la zone — il ne rend plus rien — puis communiquez la pièce caviardée, l'original restant intact dans votre espace avec son historique de versions.",
      },
      {
        title: "Signer des conclusions avec votre certificat",
        description:
          "Chargez votre certificat P12 délivré via votre écosystème professionnel, positionnez le champ de signature et validez : GigaPDF scelle le document en PKCS#7 (adbe.pkcs7.detached). Le destinataire vérifie dans sa visionneuse que le document est intègre et signé de votre main — toute altération postérieure casse la signature.",
      },
      {
        title: "Constituer un dossier de plaidoirie",
        description:
          "Fusionnez conclusions et pièces en une liasse unique, réordonnez les pages par glisser-déposer sur les miniatures, passez les pièces scannées à l'OCR pour les rendre cherchables, puis compressez l'ensemble pour les plateformes de dépôt. Le dossier est tagué par affaire et retrouvable en texte intégral dans la GED.",
      },
      {
        title: "Archiver un dossier clos en conformité",
        description:
          "Convertissez les documents définitifs en PDF/A-1b ou 2b — polices embarquées, affichage garanti dans le temps —, signez-les numériquement pour figer leur intégrité, et chiffrez en AES-256 ceux qui restent sensibles. L'archive est pérenne, vérifiable et confidentielle.",
      },
    ],
    capabilities: [
      "Caviardage réel du moteur maison : le texte est supprimé du fichier, pas masqué",
      "Signature numérique PKCS#7 avec certificat P12/PFX du cabinet",
      "Archivage conforme PDF/A-1b et PDF/A-2b (ISO 19005)",
      "Chiffrement AES-256 et permissions d'impression, copie, modification",
      "OCR français + anglais et recherche plein texte sur les pièces scannées",
      "Auto-hébergement source-available : les dossiers clients restent sur vos serveurs",
    ],
    faq: [
      {
        question: "Comment vérifier que le caviardage a réellement supprimé le texte ?",
        answer:
          "Faites le test qui piège les mauvais outils : sélectionnez la zone caviardée et tentez un copier-coller, ou lancez une recherche sur un mot occulté. Avec le caviardage réel du moteur maison de GigaPDF, rien ne ressort — les opérateurs de texte ont été retirés du flux de contenu, le mot n'existe plus dans le fichier.",
      },
      {
        question: "La signature PKCS#7 de GigaPDF a-t-elle une valeur probante ?",
        answer:
          "GigaPDF implémente le mécanisme standard (adbe.pkcs7.detached) vérifiable dans Adobe Reader et les visionneuses conformes. La portée juridique dépend du certificat utilisé : avec un certificat qualifié délivré par un prestataire de confiance, vous entrez dans le cadre eIDAS des signatures avancées ou qualifiées. L'outil fournit la technique, votre certificat fournit la qualification.",
      },
      {
        question: "Peut-on installer GigaPDF sur le serveur du cabinet ?",
        answer:
          "Oui, intégralement : GigaPDF est open source, source-available sous licence PolyForm Noncommercial, et conçu pour l'auto-hébergement. Édition, caviardage, signature, OCR et GED tournent alors sur votre infrastructure — aucune pièce ne quitte le cabinet, ce qui simplifie considérablement l'analyse de conformité au secret professionnel et au RGPD.",
      },
      {
        question: "Comment retrouver une pièce précise dans des centaines de documents ?",
        answer:
          "La GED de GigaPDF indexe le contenu des documents en texte intégral — y compris les scans passés à l'OCR. Recherchez un nom, une date ou une expression : les pièces qui la contiennent remontent, où qu'elles soient classées. Les dossiers et tags par affaire complètent ce filet de recherche.",
      },
    ],
    relatedTools: ["signer-pdf", "proteger-pdf", "pdf-a", "ocr-pdf", "editer-pdf"],
    icon: "scale",
  },
  {
    slug: "experts-comptables",
    name: "Experts-comptables",
    metaTitle: "GigaPDF pour experts-comptables : pièces et OCR",
    metaDescription:
      "Fusion de pièces, OCR de factures scannées, recherche plein texte et tags par dossier client : la GED PDF des cabinets comptables, gratuite et open source.",
    h1: "Experts-comptables : domptez le flux de pièces de vos clients",
    intro: [
      "Le quotidien d'un cabinet comptable, ce sont des pièces qui arrivent dans tous les états : factures photographiées au téléphone, relevés scannés de travers, liasses PDF de quarante pages mélangeant exercices et fournisseurs, tickets illisibles. Avant même la saisie, il y a un travail ingrat de tri, de découpe et de remise en ordre — et chaque pièce introuvable au moment du contrôle coûte des heures.",
      "GigaPDF outille précisément cette couche documentaire. L'OCR maison (français + anglais) rend les factures scannées exploitables : montants, numéros et mentions deviennent du texte cherchable, indexé par la recherche plein texte de la GED. La division découpe les liasses en pièces unitaires, la fusion reconstitue des dossiers par exercice ou par client, et les tags croisent les classements — un même document visible sous « Client X », « 2025 » et « TVA » sans duplication.",
      "Tout est inclus dans le plan gratuit — 5 Go, 1000 documents, 1 000 appels API mensuels pour automatiser les flux récurrents — et le cabinet qui veut garder les données comptables de ses clients hors de tout cloud tiers installe GigaPDF sur son propre serveur : le code est open source, source-available sous licence PolyForm Noncommercial.",
    ],
    workflows: [
      {
        title: "Traiter une liasse de pièces clients",
        description:
          "Importez la liasse scannée, découpez-la en pièces unitaires depuis la vue miniatures, redressez les pages numérisées de travers par rotation, puis passez l'ensemble à l'OCR : chaque facture devient cherchable par fournisseur, montant ou numéro. Taguez par client et par exercice — la pièce se retrouve en deux secondes au lieu de deux classeurs.",
      },
      {
        title: "Préparer un dossier de contrôle ou de révision",
        description:
          "Recherchez en texte intégral les pièces concernées, fusionnez-les en un dossier ordonné, compressez le résultat pour respecter les limites des plateformes de transmission, et protégez-le par chiffrement AES-256 avant envoi. L'historique de versions trace les états successifs du dossier.",
      },
      {
        title: "Figer les documents de synthèse",
        description:
          "Convertissez les états préparés au tableur en PDF — les valeurs remplacent les formules, la zone d'impression cadre la pagination —, apposez si besoin le filigrane du cabinet, puis archivez en PDF/A pour la conservation légale. La signature numérique PKCS#7 peut sceller les livrables définitifs.",
      },
      {
        title: "Automatiser la collecte récurrente",
        description:
          "Via l'API (1 000 appels mensuels inclus), branchez vos outils : conversion automatique des pièces reçues, OCR systématique des scans, classement dans les dossiers clients. La couche documentaire se met à jour sans intervention manuelle.",
      },
    ],
    capabilities: [
      "OCR maison des factures et relevés scannés, accents français compris",
      "Recherche plein texte sur le contenu des pièces, pas seulement les noms de fichiers",
      "Division des liasses et fusion de dossiers sans recompression",
      "Tags croisés par client, exercice et nature de pièce",
      "Conversion Excel/Word vers PDF et archivage PDF/A pour la conservation",
      "API incluse pour automatiser les flux récurrents du cabinet",
    ],
    faq: [
      {
        question: "L'OCR lit-il correctement les factures françaises ?",
        answer:
          "Oui : le moteur OCR maison de GigaPDF est configuré avec le modèle français (en plus de l'anglais), donc accents, cédilles et mentions légales sont correctement reconnus sur les documents imprimés nets. Les tickets froissés ou photographiés en biais restent le cas difficile de tout OCR — numérisez à plat quand l'enjeu le justifie.",
      },
      {
        question: "Comment organiser les pièces de dizaines de clients sans tout dupliquer ?",
        answer:
          "Par la combinaison dossiers + tags de la GED : un classement principal par client, et des tags transverses (exercice, TVA, immobilisations, à pointer…) qui croisent ce classement sans copier les fichiers. La recherche plein texte complète le dispositif pour les pièces mal nommées.",
      },
      {
        question: "Peut-on suivre les modifications apportées à un dossier ?",
        answer:
          "Oui. Chaque enregistrement crée une version dans l'historique du document : vous consultez les états antérieurs et restaurez celui qui précède une mauvaise manipulation. La corbeille conserve par ailleurs 30 jours les documents supprimés — un filet utile en période de clôture.",
      },
      {
        question: "Les données comptables de mes clients sont-elles en sécurité ?",
        answer:
          "Vous disposez de trois niveaux : le chiffrement AES-256 des documents sensibles, le partage par lien maîtrisé plutôt que les pièces jointes, et — niveau ultime — l'auto-hébergement de l'instance GigaPDF sur le serveur du cabinet, le code étant open source et auditable. Les données ne dépendent alors d'aucun prestataire tiers.",
      },
    ],
    relatedTools: ["ocr-pdf", "fusionner-pdf", "diviser-pdf", "excel-vers-pdf", "pdf-a"],
    icon: "calculator",
  },
  {
    slug: "ressources-humaines",
    name: "Ressources humaines",
    metaTitle: "GigaPDF pour les RH : contrats et signatures",
    metaDescription:
      "Contrats, formulaires d'embauche, signature numérique, diffusion chiffrée et rétention 30 jours : l'outil PDF des équipes RH, open source.",
    h1: "Ressources humaines : sécurisez le cycle documentaire salarié",
    intro: [
      "Les documents RH cumulent toutes les contraintes : ils sont contractuels (l'erreur se paie), confidentiels (salaires, données personnelles), volumineux (chaque salarié génère son dossier) et urgents (une embauche n'attend pas). Entre le contrat à faire signer, le formulaire à compléter, le bulletin à transmettre et l'avenant à archiver, l'équipe RH passe une part déraisonnable de son temps en manipulations de fichiers.",
      "GigaPDF rassemble ce cycle en un seul outil. Les contrats rédigés sous Word (.doc et .docx) se convertissent en PDF fidèles, se signent numériquement en PKCS#7 — signature vérifiable, document scellé contre toute modification — et se diffusent chiffrés en AES-256, le mot de passe transitant par un autre canal que la pièce jointe. Les formulaires d'embauche se remplissent dans le navigateur puis s'aplatissent pour figer les réponses avant archivage.",
      "La GED apporte la discipline documentaire que le RGPD attend : dossiers par salarié, tags par type de document, historique de versions sur les avenants successifs, et corbeille avec rétention de 30 jours qui rattrape les suppressions accidentelles sans contredire vos politiques de purge. En auto-hébergement, l'ensemble du dossier social reste sur l'infrastructure de l'entreprise.",
    ],
    workflows: [
      {
        title: "Faire signer un contrat de travail",
        description:
          "Convertissez le contrat Word en PDF, vérifiez la mise en page dans la visionneuse, signez en PKCS#7 avec le certificat de l'entreprise, puis transmettez par lien de partage. Chaque signature successive scelle l'état du document — toute modification postérieure est détectable dans n'importe quelle visionneuse conforme.",
      },
      {
        title: "Constituer un dossier d'embauche",
        description:
          "Envoyez les formulaires PDF à compléter ; le candidat les remplit dans le navigateur, sans imprimante. À réception, aplatissez les formulaires pour figer les réponses, fusionnez-les avec les justificatifs en un dossier unique, taguez par salarié et archivez. L'extraction des champs par API évite la ressaisie dans le SIRH.",
      },
      {
        title: "Diffuser des documents sensibles",
        description:
          "Bulletins, avenants ou courriers disciplinaires se chiffrent en AES-256 avant envoi : sans le mot de passe — communiqué par un canal séparé —, le fichier est illisible où qu'il atterrisse. Les permissions PDF bloquent en complément impression et copie sur les documents en consultation.",
      },
      {
        title: "Tenir le dossier salarié dans la durée",
        description:
          "Chaque avenant crée une version ; l'historique restitue l'état du dossier à toute date. Les départs déclenchent vos purges : la corbeille à rétention 30 jours sépare la suppression décidée de la perte accidentelle, et les documents à conservation longue passent en PDF/A.",
      },
    ],
    capabilities: [
      "Conversion Word (.doc, .docx) vers PDF fidèle pour les contrats et avenants",
      "Signature numérique PKCS#7 vérifiable, document scellé contre modification",
      "Formulaires remplissables dans le navigateur puis aplatis pour archivage",
      "Chiffrement AES-256 des documents salariés et permissions granulaires",
      "Dossiers, tags, versions et corbeille à rétention 30 jours",
      "Auto-hébergement : le dossier social reste sur les serveurs de l'entreprise",
    ],
    faq: [
      {
        question: "La signature électronique d'un contrat de travail est-elle valable ?",
        answer:
          "Le droit français admet la signature électronique des contrats de travail ; la solidité dépend du niveau de signature, donc du certificat employé. GigaPDF fournit le mécanisme standard PKCS#7 vérifiable : avec un certificat délivré par un prestataire qualifié, vous documentez l'intégrité du contrat et l'identité du signataire — les deux points contestés en pratique.",
      },
      {
        question: "Comment envoyer un document RH confidentiel par e-mail sans risque ?",
        answer:
          "Chiffrez le PDF en AES-256 dans GigaPDF avant l'envoi et communiquez le mot de passe par un canal distinct (SMS, téléphone). La pièce jointe peut alors être transférée, archivée ou interceptée : sans le mot de passe, son contenu est cryptographiquement illisible. Le partage par lien, révocable, est l'alternative aux pièces jointes.",
      },
      {
        question: "Que se passe-t-il si un dossier salarié est supprimé par erreur ?",
        answer:
          "La corbeille de la GED conserve les documents supprimés pendant 30 jours : la restauration est immédiate et complète, versions comprises. Passé ce délai, la suppression devient définitive — un comportement aligné avec les politiques de purge RGPD, qui exigent que « supprimé » finisse par vouloir dire supprimé.",
      },
      {
        question: "Peut-on éviter que les documents RH partent dans un cloud américain ?",
        answer:
          "Oui, radicalement : GigaPDF est open source (source-available) et s'installe sur vos propres serveurs. Conversion, signature, chiffrement et GED fonctionnent alors en circuit fermé sur votre infrastructure — un argument décisif dans les analyses d'impact et les échanges avec votre DPO.",
      },
    ],
    relatedTools: ["signer-pdf", "formulaires-pdf", "proteger-pdf", "word-vers-pdf", "editer-pdf"],
    icon: "users",
  },
  {
    slug: "immobilier",
    name: "Immobilier",
    metaTitle: "GigaPDF pour l'immobilier : baux et états des lieux",
    metaDescription:
      "Baux signés numériquement, états des lieux annotés, dossiers locataires fusionnés : l'outil PDF des agences et gestionnaires, gratuit et open source.",
    h1: "Immobilier : des baux signés aux états des lieux annotés",
    intro: [
      "Une location ou une vente, c'est une avalanche documentaire à délais courts : dossiers de candidature en pièces éparses, baux à signer vite avant que le candidat ne se rétracte, états des lieux qu'il faut documenter précisément sous peine de litige au départ, diagnostics et annexes à joindre sans rien oublier. Les agences et gestionnaires jonglent en permanence entre scans, photos et pièces jointes.",
      "GigaPDF structure ce flux. Les dossiers locataires se fusionnent en liasses uniques et ordonnées — pièce d'identité, justificatifs, garanties — au lieu de six pièces jointes. Le bail et ses annexes se signent numériquement en PKCS#7 : document scellé, intégrité vérifiable par toutes les parties, sans rendez-vous physique. L'état des lieux s'annote directement sur le PDF — remarques positionnées pièce par pièce, photos intégrées au dossier — et les versions d'entrée et de sortie se comparent dans l'historique.",
      "Le tout vit dans la GED : un dossier par bien, des tags par statut (en cours, signé, archivé), la recherche plein texte qui retrouve un nom de locataire dans des centaines de documents, et le partage par lien qui remplace les pièces jointes trop lourdes. Gratuit jusqu'à 5 Go et 1000 documents, toutes fonctions incluses.",
    ],
    workflows: [
      {
        title: "Monter un dossier de candidature locataire",
        description:
          "Rassemblez les pièces reçues en vrac — photos de téléphone, scans, PDF —, convertissez et fusionnez-les en un dossier unique ordonné, compressez-le sous la limite des messageries et transmettez-le au propriétaire par lien. Un dossier propre se décide plus vite qu'un fil d'e-mails à six pièces jointes.",
      },
      {
        title: "Signer un bail à distance",
        description:
          "Générez le bail en PDF depuis votre traitement de texte, fusionnez diagnostics et annexes obligatoires, puis faites signer numériquement chaque partie : les signatures PKCS#7 s'empilent, chacune scellant l'état du document. Plus de rendez-vous pour trois paraphes — et une intégrité vérifiable en cas de contestation.",
      },
      {
        title: "Documenter un état des lieux opposable",
        description:
          "Annotez le PDF d'état des lieux pièce par pièce : remarques positionnées, relevés de compteurs, photos jointes au dossier du bien. À la sortie, rééditez une copie du document d'entrée, annotez les écarts et comparez les deux versions — la discussion sur le dépôt de garantie s'appuie sur des documents datés et versionnés.",
      },
      {
        title: "Gérer un parc en copropriété ou en gestion locative",
        description:
          "Un dossier GED par lot, des tags par immeuble et par statut, les convocations et procès-verbaux convertis en PDF et archivés en PDF/A, les règlements diffusés par lien avec filigrane de l'agence. La recherche plein texte retrouve une clause ou un nom dans tout le parc.",
      },
    ],
    capabilities: [
      "Fusion des pièces de candidature en dossiers uniques ordonnés",
      "Signature numérique PKCS#7 multi-parties des baux et mandats",
      "Annotations natives sur les états des lieux, lisibles dans toute visionneuse",
      "Compression des dossiers scannés pour transmission et stockage",
      "GED par bien : dossiers, tags, versions, recherche plein texte, partage par lien",
      "Filigrane de l'agence sur les documents diffusés",
    ],
    faq: [
      {
        question: "La signature électronique d'un bail est-elle valable ?",
        answer:
          "Oui, le bail d'habitation peut être signé électroniquement. GigaPDF appose des signatures PKCS#7 standard : chaque partie signe avec son certificat, le document est scellé à chaque étape et toute modification ultérieure est détectable. Le niveau de reconnaissance dépend du certificat utilisé — avec un certificat qualifié, vous êtes dans le cadre eIDAS.",
      },
      {
        question: "Comment annoter un état des lieux sur place, sans imprimer ?",
        answer:
          "Ouvrez le PDF dans GigaPDF depuis un navigateur — l'éditeur fonctionne sans installation —, ajoutez vos remarques positionnées pièce par pièce, surlignez les points de vigilance, complétez les relevés. Le document annoté est enregistré avec sa version horodatée, et les annotations restent visibles dans toutes les visionneuses du marché.",
      },
      {
        question: "Les dossiers de candidature dépassent la taille acceptée par ma messagerie : que faire ?",
        answer:
          "Deux outils règlent le problème : la compression du moteur maison, qui nettoie les scans volumineux sans en dégrader la lisibilité, et surtout le partage par lien, qui remplace la pièce jointe — le destinataire consulte le dossier en ligne, vous gardez la main sur l'accès.",
      },
      {
        question: "Comment prouver qu'un document n'a pas été modifié après signature ?",
        answer:
          "C'est précisément ce que garantit la signature numérique : elle lie cryptographiquement le contenu exact du fichier à l'identité du signataire. Ouvrez le PDF dans une visionneuse conforme (Adobe Reader par exemple) : le panneau de signatures indique si le document est intact depuis chaque signature. En cas de litige locatif, cette vérifiabilité change le rapport de force.",
      },
    ],
    relatedTools: ["signer-pdf", "annoter-pdf", "fusionner-pdf", "compresser-pdf", "organiser-pages-pdf"],
    icon: "building",
  },
  {
    slug: "sante",
    name: "Professionnels de santé",
    metaTitle: "GigaPDF santé : PDF chiffrés et souveraineté",
    metaDescription:
      "Chiffrement AES-256 des documents médicaux et auto-hébergement souverain : la plateforme PDF open source pensée pour les données de santé.",
    h1: "Santé : des documents chiffrés, une plateforme souveraine",
    intro: [
      "Les données de santé sont les plus protégées du droit européen, et pour cause : un compte rendu, une ordonnance ou un résultat d'analyse qui fuite ne se « réinitialise » pas comme un mot de passe. Pour un cabinet, un centre de santé ou un établissement, chaque outil numérique qui touche un document patient est une question de conformité — et les services PDF grand public, qui font transiter les fichiers par des serveurs dont on ignore tout, sont précisément ce qu'il faut éviter.",
      "GigaPDF a deux réponses structurelles. La première : le chiffrement AES-256 au niveau du document — un compte rendu chiffré est illisible sans son mot de passe, sur la messagerie comme sur la clé USB égarée, et les permissions PDF restreignent en complément impression et copie. La seconde, plus radicale : l'auto-hébergement. Le code étant open source, source-available sous licence PolyForm Noncommercial, l'instance complète — édition, OCR, GED, partage — s'installe sur l'infrastructure de la structure de soins, et les documents patients ne quittent jamais son périmètre.",
      "Au quotidien, la plateforme fluidifie le travail documentaire : OCR des courriers et comptes rendus papier pour les rendre cherchables, fusion des pièces d'un dossier patient, formulaires de consentement remplis en ligne et aplatis, archivage PDF/A des documents à conservation longue. Toutes les fonctions sont incluses dans le plan gratuit.",
    ],
    workflows: [
      {
        title: "Transmettre un compte rendu en confiance",
        description:
          "Chiffrez le document en AES-256 avant l'envoi, communiquez le mot de passe au confrère ou au patient par un canal séparé, et restreignez si besoin l'impression et la copie. Même transférée ou archivée par un serveur de messagerie tiers, la pièce reste cryptographiquement illisible sans le mot de passe.",
      },
      {
        title: "Numériser l'historique papier d'un patient",
        description:
          "Scannez les courriers, comptes rendus et résultats anciens, importez-les, passez-les à l'OCR (français + anglais) puis en calque cherchable : chaque document garde son apparence d'origine — tampons et signatures visibles — mais devient interrogeable. La recherche plein texte retrouve un antécédent en quelques secondes au lieu d'un classeur.",
      },
      {
        title: "Recueillir des consentements",
        description:
          "Préparez le formulaire de consentement en PDF, faites-le remplir dans le navigateur — sans imprimante côté patient —, puis aplatissez les réponses pour figer le document avant classement. La signature numérique peut sceller le consentement recueilli.",
      },
      {
        title: "Déployer une instance souveraine",
        description:
          "Installez GigaPDF sur les serveurs de la structure : l'intégralité des traitements — édition, OCR, chiffrement, GED, partage interne — s'exécute dans votre périmètre. Le code source est auditable par votre prestataire ou votre RSSI, et aucun document patient ne transite par un cloud tiers.",
      },
    ],
    capabilities: [
      "Chiffrement AES-256 des documents médicaux et permissions granulaires",
      "Auto-hébergement complet : les données patients restent dans votre périmètre",
      "Code open source auditable par votre RSSI ou prestataire",
      "OCR et calque cherchable pour les archives papier numérisées",
      "Formulaires de consentement remplis en ligne puis aplatis",
      "Archivage PDF/A des documents à conservation longue durée",
    ],
    faq: [
      {
        question: "GigaPDF est-il adapté aux exigences pesant sur les données de santé ?",
        answer:
          "L'architecture le permet : en auto-hébergement, les documents ne quittent pas votre infrastructure, ce qui élimine la question du transfert vers des tiers ; le chiffrement AES-256 protège les documents en circulation ; le code source est auditable. La conformité globale (hébergement HDS le cas échéant, politiques d'accès, traçabilité) reste celle de votre infrastructure et de votre organisation — GigaPDF s'y insère sans imposer de cloud externe.",
      },
      {
        question: "Pourquoi chiffrer le PDF lui-même plutôt que compter sur la messagerie sécurisée ?",
        answer:
          "Parce que le document vit au-delà du transport : il est téléchargé, archivé, parfois transféré. Le chiffrement au niveau du fichier (AES-256) le protège partout où il se trouve, indépendamment du canal. Messagerie sécurisée et chiffrement du document se cumulent — défense en profondeur.",
      },
      {
        question: "L'OCR peut-il traiter des comptes rendus médicaux scannés ?",
        answer:
          "Oui pour les documents dactylographiés : le moteur OCR reconnaît le texte imprimé en français et en anglais, et le calque cherchable rend l'archive interrogeable sans altérer son apparence. Les mentions manuscrites — fréquentes sur les anciens dossiers — ne sont en revanche pas reconnues : c'est une limite de l'OCR, pas un défaut de numérisation.",
      },
      {
        question: "Que devient un document supprimé par erreur ?",
        answer:
          "La corbeille de la GED le conserve 30 jours : restauration complète, versions incluses. Cette fenêtre couvre l'erreur de manipulation sans contredire vos politiques de purge — au-delà, la suppression est définitive. L'historique de versions protège par ailleurs contre les écrasements accidentels.",
      },
    ],
    relatedTools: ["proteger-pdf", "ocr-pdf", "pdf-cherchable", "formulaires-pdf", "pdf-a"],
    icon: "heart-pulse",
  },
  {
    slug: "education-etudiants",
    name: "Étudiants",
    metaTitle: "GigaPDF pour étudiants : annoter et convertir",
    metaDescription:
      "Annotez vos cours, compressez vos rapports, convertissez mémoires et supports : l'outil PDF complet et gratuit des étudiants, sans filigrane.",
    h1: "Étudiants : un outil PDF complet, vraiment gratuit",
    intro: [
      "La vie étudiante tourne autour du PDF : polycopiés à annoter, articles à surligner pour le mémoire, rapports à rendre dans un format imposé, dossiers de candidature à assembler — le tout avec un budget logiciel égal à zéro. Les outils « gratuits » du marché l'ont bien compris, qui plafonnent les opérations à deux par jour ou tamponnent leur publicité sur les devoirs rendus.",
      "GigaPDF prend le contre-pied : toutes les fonctions sont incluses dans le plan gratuit — 5 Go de stockage, 1000 documents — sans filigrane ajouté ni compteur d'opérations. Surlignez et annotez vos cours dans le navigateur, sur n'importe quelle machine, y compris celles de la bibliothèque universitaire : il n'y a rien à installer. Convertissez votre mémoire Word en PDF impeccable avant le dépôt, compressez le rapport de stage gorgé de captures d'écran sous la limite de la plateforme de rendu, fusionnez CV, lettre et relevés en un dossier de candidature unique.",
      "Et parce que GigaPDF est open source (source-available), c'est aussi un objet d'étude : le code de l'éditeur, du moteur PDF et de la GED est public. Les étudiants en informatique peuvent regarder sous le capot — voire contribuer, ce qui fait toujours bien sur un CV.",
    ],
    workflows: [
      {
        title: "Annoter ses cours et ses sources",
        description:
          "Importez polycopiés et articles, surlignez les passages clés, ajoutez vos notes en marge : les annotations sont natives, donc visibles dans n'importe quel lecteur PDF, y compris hors ligne sur votre tablette. La recherche plein texte retrouve ensuite une notion dans tout votre corpus — fini le feuilletage de vingt fichiers la veille du partiel.",
      },
      {
        title: "Rendre un devoir au bon format",
        description:
          "Convertissez le devoir rédigé sous Word ou une suite OpenDocument (.docx, .odt) en PDF : la mise en page est figée, identique chez le correcteur. Si la plateforme de rendu limite la taille, la compression du moteur maison allège le fichier sans dégrader le texte. Aucun filigrane publicitaire ne s'invite sur votre copie.",
      },
      {
        title: "Assembler un dossier de candidature",
        description:
          "CV, lettre de motivation, relevés de notes, attestations : fusionnez le tout en un seul PDF ordonné, réorganisez les pages par glisser-déposer, et envoyez un dossier propre — ou un lien de partage si la pièce jointe est trop lourde. Les recruteurs et responsables de master apprécient.",
      },
      {
        title: "Travailler un mémoire à plusieurs",
        description:
          "Partagez le PDF du mémoire avec votre binôme ou votre directeur : la collaboration en temps réel permet d'annoter ensemble, chacun voyant les remarques des autres en direct. L'historique de versions conserve les états successifs — utile quand une relecture tourne mal.",
      },
    ],
    capabilities: [
      "Toutes les fonctions gratuites : 5 Go, 1000 documents, sans filigrane ni compteur",
      "Annotations natives : surlignage, notes, dessins, lisibles partout",
      "Conversion Word, OpenDocument, Excel et PowerPoint vers PDF",
      "Compression du moteur maison pour passer sous les limites des plateformes de rendu",
      "Fusion et organisation de dossiers de candidature",
      "Collaboration en temps réel sur les travaux de groupe",
    ],
    faq: [
      {
        question: "Est-ce vraiment gratuit, ou y a-t-il un piège ?",
        answer:
          "Le plan gratuit inclut toutes les fonctionnalités — édition, annotation, conversion, OCR, signature — avec pour seules limites le volume : 5 Go de stockage, 1000 documents et 1 000 appels API par mois. Pas de filigrane sur vos fichiers, pas de quota d'opérations journalier. Le projet est open source : le modèle est transparent, le code aussi.",
      },
      {
        question: "Puis-je utiliser GigaPDF sur les ordinateurs de la fac ?",
        answer:
          "Oui : tout fonctionne dans le navigateur, sans installation ni droits administrateur. Connectez-vous à votre compte depuis la bibliothèque universitaire, la salle informatique ou chez vous — vos documents, annotations et dossiers vous suivent.",
      },
      {
        question: "Comment réduire un rapport de stage trop lourd pour la plateforme de dépôt ?",
        answer:
          "Lancez la compression : le moteur maison purge les données structurelles inutiles et linéarise le fichier. Sur un rapport bourré de captures d'écran et passé par plusieurs exports successifs, le gain est souvent décisif — et le texte reste parfaitement net, contrairement aux compresseurs qui pixellisent tout.",
      },
      {
        question: "Mes annotations seront-elles visibles dans le lecteur PDF de mon correcteur ?",
        answer:
          "Oui : GigaPDF écrit des annotations au standard PDF, affichées par Adobe Reader, les navigateurs, l'aperçu macOS et les liseuses. À l'inverse, si vous voulez rendre une copie propre, vous pouvez aplatir les annotations ou simplement les supprimer avant l'export final.",
      },
    ],
    relatedTools: ["annoter-pdf", "compresser-pdf", "word-vers-pdf", "fusionner-pdf"],
    icon: "graduation-cap",
  },
  {
    slug: "enseignants-formateurs",
    name: "Enseignants et formateurs",
    metaTitle: "GigaPDF pour enseignants : supports et corrections",
    metaDescription:
      "Assemblez vos supports de cours, corrigez en annotations, filigranez vos sujets : l'outil PDF gratuit des enseignants et formateurs indépendants.",
    h1: "Enseignants et formateurs : maîtrisez vos supports de cours",
    intro: [
      "Préparer un cours, c'est faire de l'assemblage documentaire : un chapitre de manuel scanné, trois exercices piochés dans des fichiers différents, une fiche rédigée sous Word, deux pages d'annales — et il faut en faire un support cohérent, paginé, diffusable. Puis viennent les copies à corriger, les sujets à protéger de la circulation prématurée, et les supports à décliner en version élève et version corrigée.",
      "GigaPDF traite cette chaîne de bout en bout. La fusion assemble les sources hétérogènes en un support unique — les conversions Word, PowerPoint et OpenDocument se faisant au passage —, la vue miniatures réordonne les pages, et la division extrait la version élève (énoncés seuls) de la version complète (avec corrigés). Le filigrane marque les sujets d'examen « CONFIDENTIEL — NE PAS DIFFUSER » ou appose le nom de votre organisme sur les supports qui circulent.",
      "Pour la correction, les annotations natives remplacent le stylo rouge : surlignage, remarques en marge, appréciations — directement sur la copie PDF, lisibles dans n'importe quel lecteur côté élève. Le tout gratuitement, et les formateurs indépendants soumis à des exigences de traçabilité peuvent archiver leurs livrables en PDF/A et les signer numériquement.",
    ],
    workflows: [
      {
        title: "Composer un support de cours multi-sources",
        description:
          "Convertissez vos fichiers Word, PowerPoint et OpenDocument en PDF, fusionnez-les avec les pages scannées du manuel, réordonnez l'ensemble sur la planche de miniatures et compressez le support final pour l'ENT ou la plateforme de formation. Un seul fichier propre, paginé en continu, à jour dans votre GED avec ses versions.",
      },
      {
        title: "Corriger des copies numériques",
        description:
          "Les élèves déposent leurs devoirs en PDF ; vous les annotez dans le navigateur — surlignage des erreurs, remarques positionnées, appréciation finale — puis les renvoyez par lien de partage. Les annotations sont natives : chaque élève les voit dans son lecteur habituel, sans application imposée.",
      },
      {
        title: "Protéger un sujet d'examen",
        description:
          "Filigranez le sujet en diagonale « CONFIDENTIEL » avec la date de l'épreuve, chiffrez le fichier en AES-256 pour la transmission aux surveillants — le mot de passe partant par un autre canal — et gardez l'original intact dans votre espace. Après l'épreuve, diffusez librement la version publique.",
      },
      {
        title: "Décliner versions élève et corrigé",
        description:
          "Maintenez le document complet (énoncés + corrigés) comme source unique, puis extrayez par division les pages d'énoncés pour la version élève. À chaque mise à jour du document maître, regénérez la déclinaison — l'historique de versions garde la trace des millésimes successifs.",
      },
    ],
    capabilities: [
      "Fusion de sources hétérogènes (Word, PowerPoint, OpenDocument, scans) en supports uniques",
      "Annotations natives pour la correction de copies, lisibles dans tout lecteur",
      "Filigrane texte ou logo sur sujets et supports diffusés",
      "Division énoncés / corrigés depuis un document maître",
      "Compression des supports pour les ENT et plateformes de formation",
      "Archivage PDF/A et signature numérique des livrables de formation",
    ],
    faq: [
      {
        question: "Comment assembler un support à partir de fichiers de formats différents ?",
        answer:
          "Importez tout dans GigaPDF : les .docx, .pptx, .odt et .odp sont convertis en PDF par le moteur maison côté serveur, les scans arrivent tels quels. Fusionnez ensuite l'ensemble dans l'ordre voulu — la vue miniatures permet d'affiner page par page. Le support final est un PDF unique, homogène et paginé.",
      },
      {
        question: "Puis-je corriger des copies sans imprimer ?",
        answer:
          "Oui, intégralement : surlignage, remarques en marge, schémas à main levée pour les corrections graphiques — tout se fait dans l'éditeur, et les annotations sont enregistrées au standard PDF. L'élève les consulte dans n'importe quel lecteur. Vous gagnez l'impression, le transport et le rescannage des paquets de copies.",
      },
      {
        question: "Le filigrane suffit-il à protéger un sujet d'examen ?",
        answer:
          "Le filigrane dissuade et trace — un sujet qui fuite porte votre marquage —, mais la vraie protection avant l'épreuve est le chiffrement AES-256 : sans le mot de passe, le fichier est illisible. Combinez les deux : chiffrement pour la phase confidentielle, filigrane pour la diffusion contrôlée.",
      },
      {
        question: "GigaPDF convient-il à un organisme de formation avec plusieurs formateurs ?",
        answer:
          "Oui : les supports se partagent par lien ou par e-mail entre formateurs, la collaboration en temps réel permet de co-construire un support, et la GED — dossiers par module, tags par session, versions — sert de référentiel commun. En auto-hébergement, l'organisme garde l'ensemble sur sa propre infrastructure.",
      },
    ],
    relatedTools: ["fusionner-pdf", "annoter-pdf", "filigrane-pdf", "powerpoint-vers-pdf", "diviser-pdf"],
    icon: "book-open",
  },
  {
    slug: "freelances",
    name: "Freelances et indépendants",
    metaTitle: "GigaPDF pour freelances : devis, factures, livrables",
    metaDescription:
      "Devis et factures en PDF, livrables filigranés à votre marque, conversion Office complète : l'outil PDF gratuit des indépendants, avec API.",
    h1: "Freelances : des documents pro sans budget logiciel",
    intro: [
      "Être indépendant, c'est être son propre service administratif : devis à envoyer dans l'heure, factures à figer proprement, livrables à marquer de son identité, contrats à faire signer — avec des outils qu'on paie de sa poche. Chaque abonnement logiciel se soustrait directement du revenu, et les solutions PDF « freemium » qui tamponnent leur propre publicité sur vos documents clients renvoient une image exactement inverse de celle qu'on cherche à construire.",
      "GigaPDF aligne les fonctions dont un indépendant a réellement besoin, gratuitement et sans filigrane imposé. Vos devis et factures composés sous Word ou Excel se convertissent en PDF impeccables — valeurs figées, formules invisibles. Vos livrables partent avec votre logo en filigrane discret et, pour les versions de travail, un marquage BROUILLON qui évite qu'une maquette non validée soit prise pour définitive. Vos contrats de prestation se signent numériquement en PKCS#7 — une vraie signature vérifiable, pas une image collée.",
      "Pour les profils techniques, l'API (1 000 appels mensuels inclus) automatise la production documentaire : génération de factures PDF depuis vos gabarits HTML rendus par le moteur maison, conversion à la volée, archivage. Et la GED tient lieu de classement : un dossier par client, des tags par statut, la recherche plein texte qui retrouve n'importe quelle clause.",
    ],
    workflows: [
      {
        title: "Produire devis et factures impeccables",
        description:
          "Composez le devis sous Word ou le récapitulatif sous Excel, convertissez en PDF — mise en page figée, formules masquées —, puis protégez le fichier contre la modification avant l'envoi. Pour les flux réguliers, générez directement les factures en HTML via l'API : rendu maison fidèle à votre gabarit, à chaque fois.",
      },
      {
        title: "Livrer des documents à votre marque",
        description:
          "Apposez votre logo en filigrane translucide sur les livrables — visible sans gêner la lecture — et marquez BROUILLON les versions intermédiaires envoyées en validation. Aucun filigrane GigaPDF ne s'ajoute au vôtre : le document reste 100 % à votre image.",
      },
      {
        title: "Faire signer un contrat de prestation",
        description:
          "Convertissez le contrat en PDF, signez-le avec votre certificat P12, puis transmettez-le au client par lien de partage pour sa propre signature. Chaque signature PKCS#7 scelle l'état du document : en cas de désaccord ultérieur, l'intégrité du contrat signé est vérifiable dans n'importe quelle visionneuse.",
      },
      {
        title: "Tenir sa comptabilité documentaire",
        description:
          "Classez factures émises et reçues par dossiers et par tags (client, trimestre, à encaisser), passez les justificatifs scannés à l'OCR pour les retrouver par montant ou fournisseur, et archivez l'exercice en PDF/A pour la conservation légale. À la clôture, fusionnez les pièces en liasses pour votre comptable.",
      },
    ],
    capabilities: [
      "Conversion Word, Excel et PowerPoint vers PDF sans filigrane imposé",
      "Filigrane à votre marque : logo, opacité et position réglables",
      "Signature numérique PKCS#7 des contrats avec votre certificat",
      "Génération automatisée de factures via l'API et le rendu HTML maison",
      "GED par client : dossiers, tags, recherche plein texte, versions",
      "OCR des justificatifs scannés pour la comptabilité",
    ],
    faq: [
      {
        question: "Que m'apporte GigaPDF par rapport aux convertisseurs en ligne gratuits ?",
        answer:
          "Trois différences concrètes : aucun filigrane publicitaire sur vos documents clients ; un outil unique au lieu de six sites différents (conversion, fusion, signature, filigrane, compression, GED) ; et un espace persistant où vos documents sont classés, versionnés et cherchables — au lieu de fichiers jetables retéléchargés à chaque fois.",
      },
      {
        question: "Puis-je automatiser ma facturation sans payer un SaaS dédié ?",
        answer:
          "Si vous savez produire du HTML, oui : construisez votre gabarit de facture (votre CSS, votre identité), envoyez-le à l'API GigaPDF qui le rend en PDF avec son moteur maison, et archivez le résultat dans la GED. Le plan gratuit inclut 1 000 appels API par mois — largement de quoi couvrir la facturation d'une activité indépendante.",
      },
      {
        question: "La signature numérique me protège-t-elle en cas de litige client ?",
        answer:
          "Elle documente deux choses décisives : que le contrat n'a pas été modifié depuis la signature, et qui l'a signé. C'est l'écart entre « parole contre parole » et un fichier dont l'intégrité se vérifie techniquement. La portée juridique précise dépend du certificat employé — avec un certificat qualifié, vous êtes dans le cadre eIDAS.",
      },
      {
        question: "Comment marquer une maquette pour éviter qu'elle soit utilisée sans règlement ?",
        answer:
          "Filigranez la version de validation — diagonale BROUILLON ou SPÉCIMEN, opacité marquée — et n'envoyez la version propre qu'au paiement. Le filigrane est inscrit dans le contenu des pages, pas posé en annotation supprimable en deux clics ; pour durcir encore, ajoutez le chiffrement avec interdiction de modification.",
      },
    ],
    relatedTools: ["word-vers-pdf", "filigrane-pdf", "signer-pdf", "html-vers-pdf", "excel-vers-pdf"],
    icon: "briefcase",
  },
  {
    slug: "associations",
    name: "Associations",
    metaTitle: "GigaPDF pour associations : gratuit et collaboratif",
    metaDescription:
      "Toutes les fonctions PDF gratuites pour votre association : dossiers de subvention, PV signés, partage et collaboration bénévole. Open source.",
    h1: "Associations : un outil PDF complet au prix associatif — zéro",
    intro: [
      "Une association produit une paperasse de PME avec un budget de tirelire : dossiers de subvention à assembler pièce par pièce, procès-verbaux d'assemblée générale à faire approuver et archiver, convocations à diffuser, adhésions à collecter — le tout porté par des bénévoles qui changent, travaillent depuis leur propre ordinateur et n'ont ni licence Acrobat ni serveur de fichiers.",
      "GigaPDF correspond trait pour trait à cette situation, par philosophie autant que par fonctions : le plan gratuit inclut toutes les capacités — pas une version de démonstration — avec 5 Go et 1000 documents, de quoi couvrir la vie documentaire d'une association. La fusion assemble les dossiers de subvention (statuts, budget, RIB, comptes rendus d'activité) en liasses uniques conformes aux attentes des financeurs ; les PV se signent numériquement ; les formulaires d'adhésion se remplissent en ligne ; et le partage par lien diffuse les documents au bureau sans pièce jointe.",
      "La collaboration en temps réel permet de préparer un dossier à plusieurs bénévoles, chacun depuis chez soi, sur le même document. Et l'alignement va jusqu'à la licence : GigaPDF est un projet open source, source-available — auditable et auto-hébergeable, qu'une association équipée peut même héberger elle-même.",
    ],
    workflows: [
      {
        title: "Monter un dossier de subvention",
        description:
          "Rassemblez statuts, budget prévisionnel, RIB, rapport d'activité et comptes — souvent un mélange de Word, d'Excel et de scans —, convertissez le tout en PDF, fusionnez dans l'ordre exigé par le financeur et compressez sous la limite du portail de dépôt. Le dossier complet se prépare à plusieurs, en temps réel, chacun sur sa partie.",
      },
      {
        title: "Faire approuver et archiver les PV d'AG",
        description:
          "Convertissez le procès-verbal rédigé sous Word en PDF, faites-le signer numériquement par le président et le secrétaire — signatures PKCS#7 empilées, intégrité vérifiable —, puis archivez-le en PDF/A dans le dossier des instances. La mémoire de l'association survit aux changements de bureau.",
      },
      {
        title: "Collecter les adhésions sans imprimante",
        description:
          "Diffusez le bulletin d'adhésion en formulaire PDF remplissable : l'adhérent le complète dans son navigateur et le renvoie. Aplatissez les réponses à réception pour figer les bulletins, classez-les par saison avec des tags, et extrayez les valeurs par API si vous tenez un fichier des membres.",
      },
      {
        title: "Organiser la documentation entre bénévoles",
        description:
          "Un dossier par activité, des tags par année et par instance, le partage par lien pour le bureau et le conseil : chaque bénévole accède aux documents à jour sans chaîne d'e-mails. La corbeille à rétention 30 jours et l'historique de versions pardonnent les maladresses — inévitables quand tout le monde est volontaire.",
      },
    ],
    capabilities: [
      "Plan gratuit complet : toutes les fonctions, 5 Go, 1000 documents",
      "Fusion et compression des dossiers de subvention multi-pièces",
      "Signature numérique PKCS#7 des PV et documents officiels",
      "Formulaires d'adhésion remplissables en ligne puis aplatis",
      "Partage par lien et collaboration en temps réel entre bénévoles",
      "Projet open source, source-available, auto-hébergeable par les associations équipées",
    ],
    faq: [
      {
        question: "Le plan gratuit suffit-il vraiment pour une association ?",
        answer:
          "Pour la grande majorité, oui : 5 Go et 1000 documents couvrent les dossiers de subvention, PV, convocations et bulletins d'une saison associative, et toutes les fonctions — signature, OCR, conversion, collaboration — sont incluses sans bridage. Il n'y a pas de filigrane publicitaire sur vos documents officiels.",
      },
      {
        question: "Comment travailler à plusieurs bénévoles sur le même dossier ?",
        answer:
          "Partagez le document par lien aux personnes concernées : la collaboration en temps réel permet d'annoter et de compléter ensemble, chacun voyant les contributions des autres en direct. Plus de versions contradictoires qui circulent par e-mail — le document de référence est unique, et son historique de versions garde la trace.",
      },
      {
        question: "Un PV signé numériquement est-il valable pour nos démarches ?",
        answer:
          "La signature PKCS#7 apposée par GigaPDF est le standard vérifiable dans toutes les visionneuses : elle prouve l'intégrité du PV et l'identité des signataires via leurs certificats. Pour les démarches courantes (banque, préfecture, financeurs), ce niveau de traçabilité dépasse largement le scan d'un paraphe — et l'archivage PDF/A garantit la lisibilité dans le temps.",
      },
      {
        question: "Que se passe-t-il quand le bureau change ?",
        answer:
          "C'est là que la GED prend sa valeur : les documents, leurs versions et leur classement restent en place, indépendants des personnes. Le nouveau bureau reçoit l'accès aux dossiers partagés et retrouve l'historique complet — statuts, PV, conventions — par la recherche plein texte, sans dépendre du disque dur du trésorier sortant.",
      },
    ],
    relatedTools: ["fusionner-pdf", "formulaires-pdf", "signer-pdf", "compresser-pdf", "word-vers-pdf"],
    icon: "users-round",
  },
  {
    slug: "architectes-btp",
    name: "Architectes et BTP",
    metaTitle: "GigaPDF pour architectes : plans annotés et compressés",
    metaDescription:
      "Annotez les plans, apposez tampons de validation, compressez les dossiers lourds et rendez les pièces scannées cherchables. Gratuit et open source.",
    h1: "Architectes et BTP : des plans annotés aux dossiers maîtrisés",
    intro: [
      "Les documents du bâtiment ont un gabarit à part : plans en grand format qui pèsent des dizaines de mégaoctets, dossiers de consultation des entreprises empilant CCTP, plans et annexes par centaines de pages, allers-retours de visa où chaque remarque doit être localisée précisément sur le plan — et des CCTP scannés d'anciens projets dont personne ne retrouve les prescriptions.",
      "GigaPDF s'attaque à ces quatre douleurs. Les annotations natives portent le cycle de visa : remarques positionnées au millimètre sur le plan, nuages et flèches tracés à main levée, tampons de validation apposés via les annotations — le tout lisible par l'entreprise dans n'importe quelle visionneuse, et traçable par l'historique de versions à chaque indice. La compression du moteur maison dégonfle les dossiers retravaillés et les rend transmissibles par les plateformes de marchés ; la rotation et la réorganisation remettent d'aplomb les liasses scannées mélangeant portrait et paysage.",
      "Quant aux archives papier, la chaîne OCR + calque cherchable les ressuscite : un CCTP scanné garde son apparence exacte — tampons et visas visibles — mais devient interrogeable en texte intégral. Rechercher une prescription dans dix ans de projets cesse d'être une expédition. L'ensemble est gratuit, et auto-hébergeable pour les agences qui veulent garder leurs projets en interne.",
    ],
    workflows: [
      {
        title: "Viser et annoter des plans",
        description:
          "Ouvrez le plan PDF reçu de l'entreprise, positionnez vos remarques à l'endroit exact qu'elles concernent, entourez les zones à reprendre à main levée et apposez le tampon de validation en annotation. Renvoyez par lien de partage : l'entreprise voit chaque remarque dans son lecteur habituel, et la version visée reste dans l'historique du document.",
      },
      {
        title: "Assembler un DCE transmissible",
        description:
          "Fusionnez CCTP, plans et annexes en dossiers ordonnés par lot, réorganisez les pages sur la planche de miniatures, puis compressez : la passe de compression maison élimine les données mortes accumulées par les exports successifs et linéarise le fichier pour la consultation en ligne. Le dossier passe les limites des plateformes de dématérialisation.",
      },
      {
        title: "Rendre les archives projet cherchables",
        description:
          "Passez les CCTP, comptes rendus et courriers scannés à l'OCR (français + anglais), puis au calque cherchable : l'apparence des documents — visas, tampons, signatures — est préservée, mais la recherche plein texte de la GED retrouve une prescription, un matériau ou un nom d'entreprise dans tout le fonds documentaire.",
      },
      {
        title: "Suivre les indices et diffusions",
        description:
          "Chaque modification d'un document crée une version : l'historique restitue les indices successifs d'un plan ou d'une pièce écrite. Les tags par projet, par lot et par statut (diffusé, visé, bon pour exécution) structurent la GED, et le filigrane marque les diffusions provisoires pour éviter qu'un indice périmé parte en exécution.",
      },
    ],
    capabilities: [
      "Annotations natives sur plans : remarques positionnées, tracés à main levée, tampons",
      "Compression du moteur maison des dossiers lourds et linéarisation pour la consultation en ligne",
      "OCR + calque cherchable : les pièces scannées deviennent interrogeables sans changer d'aspect",
      "Fusion, rotation et réorganisation des liasses DCE mixtes portrait/paysage",
      "Versions et tags par projet, lot et statut de diffusion",
      "Filigrane des diffusions provisoires et partage par lien aux entreprises",
    ],
    faq: [
      {
        question: "GigaPDF gère-t-il les plans en grand format ?",
        answer:
          "Oui : le PDF n'impose pas de format de page, et les plans en A1 ou A0 s'ouvrent, s'annotent et se compressent comme les autres documents. Pour les dossiers volumineux, la compression du moteur maison et le partage par lien — qui évite l'e-mail et ses limites — sont les deux outils qui changent le quotidien.",
      },
      {
        question: "Comment apposer un tampon de visa sur un plan ?",
        answer:
          "Via les annotations : positionnez votre tampon — mention de visa, date, réserves — à l'endroit voulu du plan, complété au besoin de remarques localisées et de tracés. L'annotation est native, donc visible chez l'entreprise quel que soit son lecteur. Pour figer définitivement le visa, l'aplatissement fond les annotations dans la page.",
      },
      {
        question: "Peut-on retrouver une prescription dans d'anciens CCTP scannés ?",
        answer:
          "C'est l'exemple type de la chaîne OCR + calque cherchable : une fois traités, vos CCTP numérisés répondent à la recherche plein texte — un matériau, une norme, un nom d'entreprise — tout en conservant leur apparence d'origine. Le fonds documentaire de l'agence devient une base interrogeable au lieu d'un cimetière de scans.",
      },
      {
        question: "Comment éviter qu'un indice périmé soit utilisé sur le chantier ?",
        answer:
          "Trois garde-fous se combinent : le filigrane « DIFFUSION PROVISOIRE » ou « ANNULE ET REMPLACE » inscrit dans les pages des versions non exécutoires, les tags de statut dans la GED qui distinguent visé et bon pour exécution, et le partage par lien — qui pointe toujours vers le document à jour, là où une pièce jointe fige un état périmé dans les boîtes mail.",
      },
    ],
    relatedTools: ["annoter-pdf", "compresser-pdf", "pdf-cherchable", "organiser-pages-pdf", "filigrane-pdf"],
    icon: "hard-hat",
  },
];

/** Index par slug pour les pages dynamiques. */
const SOLUTIONS_BY_SLUG = new Map(SOLUTIONS.map((solution) => [solution.slug, solution]));

export function getSolutionBySlug(slug: string): SolutionData | undefined {
  return SOLUTIONS_BY_SLUG.get(slug);
}

export function getAllSolutionSlugs(): string[] {
  return SOLUTIONS.map((solution) => solution.slug);
}
