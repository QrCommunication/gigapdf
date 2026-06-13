/**
 * Données SEO programmatique — pages outils (/tools/[slug]).
 *
 * Contenu statique rédigé en français (langue canonique du domaine).
 * Chaque entrée décrit UNIQUEMENT des capacités réellement présentes dans
 * GigaPDF (pdf-engine, MuPDF, LibreOffice headless, tesseract, Chromium).
 * Aucun gabarit à variables : intros et FAQ rédigées individuellement.
 */

export interface ToolFaqItem {
  question: string;
  answer: string;
}

export interface ToolHowTo {
  title: string;
  steps: string[];
}

export interface ToolData {
  slug: string;
  name: string;
  /** ≤ 60 caractères */
  metaTitle: string;
  /** ≤ 155 caractères */
  metaDescription: string;
  h1: string;
  /** 2-3 paragraphes rédigés */
  intro: string[];
  howTo: ToolHowTo;
  capabilities: string[];
  faq: ToolFaqItem[];
  useCases: string[];
  relatedTools: string[];
  relatedSolutions: string[];
  /** Nom d'icône lucide (mappé dans components/seo/tool-icon.tsx) */
  icon: string;
}

export const TOOLS: ToolData[] = [
  {
    slug: "editer-pdf",
    name: "Éditer un PDF",
    metaTitle: "Éditer un PDF en ligne gratuitement | GigaPDF",
    metaDescription:
      "Modifiez texte, images et formes directement dans vos PDF, avec les polices d'origine. Éditeur WYSIWYG gratuit, open source et auto-hébergeable.",
    h1: "Éditeur PDF en ligne : modifiez le texte directement dans le fichier",
    intro: [
      "Corriger une faute dans un contrat déjà exporté, mettre à jour un tarif sur une plaquette, remplacer un logo : la plupart des outils en ligne se contentent de poser un cadre blanc par-dessus l'ancien contenu. GigaPDF travaille autrement. Son éditeur WYSIWYG ouvre la page telle qu'elle s'imprimera et vous laisse cliquer sur un bloc de texte, une image ou une forme pour le modifier, le déplacer ou le supprimer réellement.",
      "La fidélité typographique fait la différence : GigaPDF identifie les polices utilisées dans le document, les télécharge automatiquement depuis Google Fonts quand elles y sont disponibles, puis les embarque dans le fichier au moment de l'enregistrement. Votre correction reprend la même police que le paragraphe d'origine, sans substitution Arial disgracieuse. Pour les suppressions, le moteur MuPDF retire les opérateurs de texte du flux de contenu au lieu de les masquer — rien ne réapparaît au copier-coller.",
      "L'éditeur fonctionne dans le navigateur, sans installation. Le plan gratuit inclut toutes les fonctions d'édition, avec 5 Go de stockage et 100 documents. Le code est open source sous licence AGPL : les équipes qui manipulent des documents sensibles peuvent héberger l'application sur leur propre serveur.",
    ],
    howTo: {
      title: "Comment modifier un PDF en ligne",
      steps: [
        "Créez un compte gratuit et importez votre PDF par glisser-déposer dans votre espace.",
        "Ouvrez le document dans l'éditeur : chaque bloc de texte, image et forme devient sélectionnable.",
        "Double-cliquez sur un texte pour le corriger ; la police d'origine est chargée automatiquement.",
        "Ajoutez de nouveaux éléments si besoin : zone de texte, image, rectangle, flèche ou trait.",
        "Supprimez les éléments obsolètes : le contenu est retiré du fichier, pas recouvert.",
        "Enregistrez : les polices modifiées sont embarquées et une nouvelle version du document est conservée.",
      ],
    },
    capabilities: [
      "Édition WYSIWYG du texte, des images et des formes existantes",
      "Polices d'origine détectées, téléchargées depuis Google Fonts et embarquées à l'enregistrement",
      "Suppression réelle du contenu via MuPDF (pas de masque blanc)",
      "Annotations natives, filigranes et remplissage de formulaires depuis le même éditeur",
      "Historique de versions et miniatures de pages dans la GED intégrée",
      "Collaboration en temps réel sur le même document",
    ],
    faq: [
      {
        question: "Puis-je modifier le texte existant d'un PDF, pas seulement en ajouter ?",
        answer:
          "Oui. GigaPDF extrait les blocs de texte du fichier et les rend éditables en place. Quand vous corrigez un paragraphe, l'ancien contenu est supprimé du flux PDF par MuPDF et le nouveau texte est écrit avec la police d'origine, embarquée dans le fichier au moment de l'enregistrement.",
      },
      {
        question: "Que se passe-t-il si la police du PDF n'est pas installée sur mon ordinateur ?",
        answer:
          "Vous n'avez rien à installer. GigaPDF reconnaît la police déclarée dans le document et la télécharge automatiquement depuis Google Fonts lorsqu'elle y est référencée. Si une police propriétaire n'est pas disponible, une équivalente proche est proposée et clairement indiquée avant l'enregistrement.",
      },
      {
        question: "L'éditeur PDF de GigaPDF est-il vraiment gratuit ?",
        answer:
          "Oui. Le plan gratuit donne accès à toutes les fonctions, édition comprise, avec 5 Go de stockage, 100 documents et 1 000 appels API par mois. Il n'existe pas de version bridée de l'éditeur : les limites portent sur le volume, pas sur les fonctionnalités.",
      },
      {
        question: "Mes documents confidentiels sont-ils en sécurité ?",
        answer:
          "Vos fichiers restent dans votre espace personnel, peuvent être chiffrés en AES-256 et sont restaurables depuis la corbeille pendant 30 jours. Pour un contrôle total, GigaPDF est open source et auto-hébergeable : vous pouvez faire tourner l'application entière sur votre propre infrastructure.",
      },
      {
        question: "Peut-on éditer un PDF à plusieurs en même temps ?",
        answer:
          "Oui, l'éditeur prend en charge la collaboration en temps réel. Plusieurs personnes peuvent ouvrir le même document, voir les modifications des autres en direct et travailler sans s'écraser mutuellement, ce qui évite les allers-retours de versions par e-mail.",
      },
    ],
    useCases: [
      "Corriger une coquille ou mettre à jour une date dans un contrat sans repasser par le fichier Word d'origine",
      "Remplacer un logo, un tarif ou une mention légale sur une plaquette commerciale déjà au format PDF",
      "Nettoyer un document reçu d'un tiers : retirer des éléments obsolètes et ajouter les informations manquantes",
    ],
    relatedTools: ["annoter-pdf", "organiser-pages-pdf", "filigrane-pdf", "formulaires-pdf"],
    relatedSolutions: ["freelances", "ressources-humaines", "avocats"],
    icon: "pen-line",
  },
  {
    slug: "fusionner-pdf",
    name: "Fusionner des PDF",
    metaTitle: "Fusionner des PDF en ligne gratuitement | GigaPDF",
    metaDescription:
      "Combinez plusieurs PDF en un seul fichier, dans l'ordre de votre choix. Outil gratuit, sans filigrane ajouté, open source et auto-hébergeable.",
    h1: "Fusionner plusieurs PDF en un seul document",
    intro: [
      "Un dossier de candidature, une liasse de pièces justificatives, un rapport assemblé depuis plusieurs services : ces documents finissent toujours éparpillés en cinq ou six fichiers PDF distincts. Les envoyer tels quels oblige le destinataire à jongler entre les pièces jointes ; les imprimer pour les rescanner dégrade la qualité. La fusion produit un fichier unique, paginé en continu, prêt à être transmis ou archivé.",
      "GigaPDF assemble vos PDF côté serveur avec son moteur dédié : les pages sont copiées sans recompression, les signets et les champs de formulaire des fichiers sources sont préservés autant que le format le permet, et aucun filigrane publicitaire n'est apposé sur le résultat. Vous réordonnez les fichiers avant la fusion, puis les pages elles-mêmes dans l'éditeur si un ajustement s'impose.",
      "L'outil s'intègre à la GED de GigaPDF : le fichier fusionné rejoint vos dossiers, peut être tagué, recherché en texte intégral et partagé par lien ou par e-mail. Le tout est inclus dans le plan gratuit, et l'application complète peut être auto-hébergée puisque le code est publié sous licence AGPL.",
    ],
    howTo: {
      title: "Comment fusionner des fichiers PDF",
      steps: [
        "Importez les PDF à combiner dans votre espace GigaPDF, en une seule sélection ou par lots.",
        "Sélectionnez les documents puis lancez la fusion depuis le menu d'actions.",
        "Glissez-déposez les fichiers pour définir l'ordre d'assemblage final.",
        "Validez : le moteur copie les pages sans recompression et génère le document combiné.",
        "Ajustez si besoin l'ordre des pages dans l'éditeur, puis partagez ou archivez le fichier fusionné.",
      ],
    },
    capabilities: [
      "Fusion d'un nombre illimité de fichiers en un seul PDF",
      "Réorganisation de l'ordre des documents avant assemblage",
      "Copie des pages sans recompression ni perte de qualité",
      "Aucun filigrane ajouté sur le fichier produit",
      "Réorganisation fine des pages après fusion dans l'éditeur",
      "Classement du résultat dans la GED : dossiers, tags, recherche plein texte",
    ],
    faq: [
      {
        question: "Combien de fichiers PDF puis-je fusionner à la fois ?",
        answer:
          "GigaPDF ne fixe pas de plafond sur le nombre de fichiers d'une fusion. La seule limite est celle de votre espace de stockage : le plan gratuit offre 5 Go et 100 documents, ce qui couvre largement des liasses de plusieurs centaines de pages.",
      },
      {
        question: "La fusion dégrade-t-elle la qualité des documents ?",
        answer:
          "Non. Les pages sont copiées telles quelles dans le fichier final, sans réencodage des images ni réinterprétation du contenu. Un PDF vectoriel reste vectoriel, un scan conserve sa résolution d'origine. Si vous voulez réduire le poids du résultat, l'outil de compression s'applique ensuite, en option.",
      },
      {
        question: "Puis-je changer l'ordre des pages après la fusion ?",
        answer:
          "Oui. Le document fusionné s'ouvre dans l'éditeur GigaPDF, où la vue en miniatures permet de déplacer, faire pivoter, supprimer ou extraire n'importe quelle page. Vous n'avez pas besoin de recommencer la fusion pour corriger un ordre imparfait.",
      },
      {
        question: "Les formulaires et les liens des fichiers d'origine sont-ils conservés ?",
        answer:
          "Les champs de formulaire et les liens internes des documents sources sont repris dans le fichier fusionné dans la mesure où la structure PDF le permet. Si deux formulaires utilisent des noms de champs identiques, GigaPDF les distingue pour éviter qu'une saisie n'écrase l'autre.",
      },
    ],
    useCases: [
      "Assembler un dossier de location ou de prêt : pièce d'identité, justificatifs, avis d'imposition en un seul fichier",
      "Regrouper les factures d'un mois en une liasse unique avant transmission au cabinet comptable",
      "Construire un rapport final à partir des chapitres PDF produits par plusieurs contributeurs",
    ],
    relatedTools: ["diviser-pdf", "organiser-pages-pdf", "compresser-pdf"],
    relatedSolutions: ["experts-comptables", "immobilier", "associations"],
    icon: "merge",
  },
  {
    slug: "diviser-pdf",
    name: "Diviser un PDF",
    metaTitle: "Diviser un PDF : extraire des pages en ligne | GigaPDF",
    metaDescription:
      "Découpez un PDF en plusieurs fichiers ou extrayez les pages utiles. Sélection visuelle par miniatures, gratuit et open source.",
    h1: "Diviser un PDF et extraire les pages dont vous avez besoin",
    intro: [
      "Transmettre les trois pages pertinentes d'un rapport de quarante, isoler chaque bulletin d'une liasse de paie, séparer l'annexe technique du contrat principal : découper un PDF est souvent plus utile que l'envoyer entier. Cela évite de diffuser des informations qui ne concernent pas le destinataire et allège les échanges.",
      "Dans GigaPDF, la division se fait visuellement. Les miniatures de toutes les pages s'affichent, vous sélectionnez celles à extraire ou définissez les points de coupe, et le moteur génère des fichiers indépendants en copiant les pages sans les recompresser. L'opération inverse existe aussi : supprimer des pages d'un document pour n'en garder que l'essentiel, directement depuis le même écran.",
      "Chaque fichier produit reste un PDF complet et autonome, classable dans vos dossiers, taggable et retrouvable par la recherche plein texte de la GED. La division est incluse dans le plan gratuit, sans limite de fréquence d'utilisation, et fonctionne aussi sur une instance auto-hébergée.",
    ],
    howTo: {
      title: "Comment diviser un fichier PDF",
      steps: [
        "Importez le PDF à découper dans votre espace GigaPDF.",
        "Ouvrez la vue par miniatures pour visualiser l'ensemble des pages.",
        "Sélectionnez les pages à extraire, ou définissez les intervalles de découpe (par exemple 1-4, 5-12, 13-20).",
        "Lancez l'opération : chaque segment devient un fichier PDF indépendant.",
        "Renommez et classez les fichiers obtenus dans vos dossiers, puis partagez ceux qui doivent l'être.",
      ],
    },
    capabilities: [
      "Extraction d'une page, d'une plage ou d'une sélection libre de pages",
      "Découpe d'un document en plusieurs fichiers en une seule opération",
      "Sélection visuelle sur les miniatures, sans saisie de numéros à l'aveugle",
      "Pages copiées sans recompression : qualité strictement identique à l'original",
      "Suppression de pages et rotation depuis le même écran",
      "Classement immédiat des fichiers produits dans la GED",
    ],
    faq: [
      {
        question: "Puis-je extraire des pages non consécutives, par exemple les pages 2, 7 et 15 ?",
        answer:
          "Oui. La sélection se fait page par page sur les miniatures : vous cochez les pages 2, 7 et 15 et GigaPDF les assemble dans un nouveau fichier en respectant l'ordre choisi. Vous n'êtes pas limité aux plages continues.",
      },
      {
        question: "Le document d'origine est-il modifié quand je le divise ?",
        answer:
          "Non. La division crée de nouveaux fichiers et laisse l'original intact dans votre espace. Si vous préférez réellement amputer le document source, utilisez la suppression de pages dans l'éditeur ; l'historique de versions permet de toute façon de revenir en arrière.",
      },
      {
        question: "Comment découper un gros PDF en plusieurs parties égales ?",
        answer:
          "Définissez vos intervalles dans la boîte de découpe (par exemple toutes les 10 pages) : GigaPDF génère un fichier par segment en une seule passe. C'est la méthode la plus rapide pour fractionner une numérisation longue ou un export volumineux en lots gérables.",
      },
      {
        question: "Les fichiers extraits conservent-ils le texte cherchable et les liens ?",
        answer:
          "Oui. Les pages sont transférées avec leur contenu complet : texte sélectionnable, images, liens et annotations. Un PDF passé par l'OCR de GigaPDF conserve son calque texte invisible dans chaque fichier issu de la découpe.",
      },
    ],
    useCases: [
      "Extraire l'attestation utile d'une liasse administrative avant de la joindre à un dossier",
      "Séparer chaque exercice ou chaque client d'un export comptable global",
      "Isoler un chapitre de mémoire ou de support de cours pour le distribuer seul",
    ],
    relatedTools: ["fusionner-pdf", "organiser-pages-pdf", "compresser-pdf"],
    relatedSolutions: ["experts-comptables", "ressources-humaines", "education-etudiants"],
    icon: "scissors",
  },
  {
    slug: "compresser-pdf",
    name: "Compresser un PDF",
    metaTitle: "Compresser un PDF en ligne gratuitement | GigaPDF",
    metaDescription:
      "Réduisez le poids de vos PDF sans sacrifier la lisibilité : nettoyage de structure et optimisation web par MuPDF. Gratuit et open source.",
    h1: "Compresser un PDF : réduire le poids sans détruire le document",
    intro: [
      "Un PDF trop lourd se heurte vite aux limites du quotidien : messageries qui plafonnent les pièces jointes à 10 ou 25 Mo, formulaires administratifs qui refusent les fichiers volumineux, portails de dépôt qui expirent avant la fin du transfert. Les scans de plusieurs dizaines de pages et les exports bourrés d'images sont les premiers concernés.",
      "GigaPDF s'appuie sur le moteur MuPDF pour compresser intelligemment : la passe de garbage collection supprime les objets inutilisés, les polices dupliquées et les flux orphelins qui gonflent silencieusement les fichiers retravaillés, tandis que la linéarisation réorganise la structure pour un affichage progressif dans le navigateur — la première page apparaît avant la fin du téléchargement. Le contenu visible n'est pas dégradé : on élimine le superflu structurel plutôt que de pixelliser vos pages.",
      "Cette approche est particulièrement efficace sur les documents passés par plusieurs éditeurs successifs, qui accumulent des données mortes. La compression est incluse dans le plan gratuit et se combine naturellement avec la fusion ou la division : assemblez d'abord, compressez ensuite, partagez le résultat par lien.",
    ],
    howTo: {
      title: "Comment compresser un fichier PDF",
      steps: [
        "Importez le PDF volumineux dans votre espace GigaPDF.",
        "Lancez la compression depuis le menu d'actions du document.",
        "Le moteur MuPDF nettoie la structure : objets inutilisés, doublons et flux orphelins sont supprimés.",
        "Le fichier est linéarisé pour un affichage progressif en ligne.",
        "Comparez le poids obtenu à l'original, puis téléchargez ou partagez la version allégée.",
      ],
    },
    capabilities: [
      "Garbage collection MuPDF : suppression des objets, polices et flux inutilisés",
      "Linéarisation pour un affichage page à page immédiat dans le navigateur",
      "Aucune dégradation du texte vectoriel ni des mises en page",
      "Particulièrement efficace sur les PDF retravaillés ou assemblés plusieurs fois",
      "Combinable avec la fusion et la division dans la même session",
      "Original conservé : la compression produit une version, l'historique garde le reste",
    ],
    faq: [
      {
        question: "Quelle réduction de poids puis-je espérer ?",
        answer:
          "Cela dépend de ce que contient le fichier. Les PDF passés par plusieurs outils accumulent des objets morts et des polices dupliquées : sur ces documents, le nettoyage structurel fait souvent gagner une part substantielle du poids. Un scan déjà optimisé, dont le poids vient presque uniquement des images, se réduira moins.",
      },
      {
        question: "La compression rend-elle mon texte flou ?",
        answer:
          "Non. La méthode de GigaPDF agit sur la structure du fichier — objets inutilisés, doublons, organisation des flux — et non sur une pixellisation du contenu. Le texte vectoriel reste net à tous les niveaux de zoom et les mises en page sont inchangées.",
      },
      {
        question: "Qu'apporte la linéarisation d'un PDF ?",
        answer:
          "Un PDF linéarisé est réorganisé pour que la première page s'affiche dès le début du téléchargement, sans attendre le fichier complet. C'est précieux pour les documents consultés en ligne ou partagés par lien : le destinataire commence à lire immédiatement, même sur une connexion lente.",
      },
      {
        question: "Puis-je compresser plusieurs documents d'affilée ?",
        answer:
          "Oui. La compression est une action disponible sur chaque document de votre espace, sans quota d'utilisation. Les limites du plan gratuit portent sur le stockage (5 Go) et le nombre de documents (100), pas sur le nombre d'opérations effectuées.",
      },
    ],
    useCases: [
      "Faire passer un dossier scanné sous la limite de pièce jointe d'une messagerie ou d'un portail administratif",
      "Alléger les rapports archivés pour économiser l'espace de stockage de l'équipe",
      "Préparer des documents fluides à consulter en ligne via le partage par lien",
    ],
    relatedTools: ["fusionner-pdf", "diviser-pdf", "ocr-pdf"],
    relatedSolutions: ["architectes-btp", "associations", "experts-comptables"],
    icon: "file-archive",
  },
  {
    slug: "signer-pdf",
    name: "Signer un PDF",
    metaTitle: "Signature électronique de PDF (PKCS#7) | GigaPDF",
    metaDescription:
      "Signez vos PDF avec un vrai certificat numérique P12/PFX : signature PKCS#7 vérifiable dans Adobe Reader. Gratuit, open source, auto-hébergeable.",
    h1: "Signer un PDF avec un certificat numérique",
    intro: [
      "Il faut distinguer deux choses que beaucoup d'outils confondent : apposer une image de paraphe sur une page, et signer numériquement un document. La première n'offre aucune garantie — n'importe qui peut copier l'image. La seconde scelle cryptographiquement le fichier : toute modification ultérieure invalide la signature, et l'identité du signataire est vérifiable par le destinataire.",
      "GigaPDF implémente la vraie signature numérique au standard PKCS#7 (sous-filtre adbe.pkcs7.detached, le format reconnu par Adobe Reader et les visionneuses conformes). Vous importez votre certificat au format P12/PFX — émis par votre autorité de certification, votre ordre professionnel ou votre infrastructure interne — et GigaPDF calcule l'empreinte du document, la chiffre avec votre clé privée et incorpore la signature dans le fichier. Le destinataire ouvre le PDF et voit immédiatement si le document est intact et qui l'a signé.",
      "Cette approche par certificat vous laisse maître de votre identité numérique : la clé privée reste la vôtre, là où les plateformes propriétaires signent en votre nom sur leurs serveurs. Et comme GigaPDF est open source et auto-hébergeable, une organisation peut opérer toute la chaîne de signature sur sa propre infrastructure.",
    ],
    howTo: {
      title: "Comment signer numériquement un PDF",
      steps: [
        "Importez le document à signer dans votre espace GigaPDF.",
        "Ouvrez l'outil de signature et chargez votre certificat P12/PFX avec son mot de passe.",
        "Positionnez le champ de signature à l'endroit voulu sur la page.",
        "Validez : GigaPDF calcule l'empreinte du document et incorpore la signature PKCS#7 détachée.",
        "Téléchargez le PDF signé : son intégrité est désormais vérifiable dans toute visionneuse conforme.",
      ],
    },
    capabilities: [
      "Signature numérique PKCS#7 au format adbe.pkcs7.detached",
      "Prise en charge des certificats P12/PFX (AC publiques, ordres professionnels, PKI internes)",
      "Vérification de l'intégrité : toute modification après signature est détectée",
      "Signature visible positionnable sur la page de votre choix",
      "Clé privée jamais déléguée à un tiers : vous signez avec votre propre certificat",
      "Chaîne entièrement auto-hébergeable pour les organisations soumises à des exigences strictes",
    ],
    faq: [
      {
        question: "Quelle est la différence avec une image de signature scannée ?",
        answer:
          "Une image se copie et ne protège rien. Une signature numérique PKCS#7 lie cryptographiquement votre identité au contenu exact du fichier : si une seule virgule change après la signature, la vérification échoue et la visionneuse l'affiche. C'est la base d'une signature à valeur probante.",
      },
      {
        question: "Où obtenir un certificat P12/PFX ?",
        answer:
          "Auprès d'une autorité de certification (les prestataires qualifiés délivrent des certificats sur clé ou en fichier), de votre ordre professionnel — les avocats français disposent par exemple de certificats via leur écosystème métier — ou de la PKI interne de votre entreprise. Le fichier P12/PFX contient votre certificat et votre clé privée, protégés par mot de passe.",
      },
      {
        question: "La signature est-elle reconnue dans Adobe Acrobat Reader ?",
        answer:
          "Oui. GigaPDF utilise le sous-filtre adbe.pkcs7.detached, le standard historique des signatures PDF. Adobe Reader affiche le panneau de signatures, vérifie l'intégrité du document et présente la chaîne de certification. La mention « valide » dépend ensuite de la confiance accordée à votre autorité de certification par le lecteur.",
      },
      {
        question: "Puis-je faire signer plusieurs personnes sur le même document ?",
        answer:
          "Oui, les signatures s'ajoutent successivement : chaque signataire appose la sienne avec son propre certificat, et chaque signature couvre l'état du document au moment où elle est posée. Les visionneuses conformes affichent l'historique complet des signatures.",
      },
      {
        question: "Que vaut juridiquement cette signature ?",
        answer:
          "Le niveau de reconnaissance dépend du certificat employé, pas de GigaPDF : avec un certificat qualifié délivré par un prestataire de confiance, vous êtes dans le cadre des signatures électroniques avancées ou qualifiées du règlement eIDAS. GigaPDF fournit le mécanisme technique standard ; la qualification juridique découle de votre certificat.",
      },
    ],
    useCases: [
      "Signer des contrats et des conventions avec une preuve d'intégrité vérifiable par l'autre partie",
      "Sceller des rapports, attestations ou livrables officiels avant diffusion",
      "Mettre en place une chaîne de signature interne sur une instance auto-hébergée",
    ],
    relatedTools: ["proteger-pdf", "pdf-a", "formulaires-pdf", "editer-pdf"],
    relatedSolutions: ["avocats", "ressources-humaines", "immobilier"],
    icon: "file-signature",
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    metaTitle: "OCR PDF en ligne : scan vers texte | GigaPDF",
    metaDescription:
      "Reconnaissance de texte Tesseract (français + anglais) sur vos PDF scannés : copiez, cherchez, exportez le contenu. Gratuit et open source.",
    h1: "OCR : extraire le texte de vos PDF scannés",
    intro: [
      "Un document scanné n'est qu'une suite de photographies de pages : impossible d'y rechercher un mot, de copier un paragraphe ou d'en extraire les montants. Tant que le texte n'est pas reconnu, le fichier reste muet pour vos outils — y compris pour la recherche de votre propre GED. La reconnaissance optique de caractères (OCR) transforme ces images en texte exploitable.",
      "GigaPDF embarque le moteur Tesseract, référence open source du domaine, configuré pour le français et l'anglais — accents, cédilles et ligatures compris, là où beaucoup de services entraînés sur l'anglais seul écorchent les textes français. Le traitement s'exécute côté serveur : vous lancez l'OCR sur un document, le moteur analyse chaque page et restitue le texte reconnu, prêt à être copié, exporté ou indexé.",
      "L'OCR alimente directement le reste de la plateforme : une fois le document reconnu, la recherche plein texte de la GED le retrouve par son contenu, et l'outil de PDF cherchable peut incruster le texte en calque invisible sous l'image d'origine. Le tout fonctionne dans le plan gratuit, et sur votre propre serveur si vous auto-hébergez — un point décisif quand les documents scannés sont confidentiels.",
    ],
    howTo: {
      title: "Comment appliquer l'OCR à un PDF scanné",
      steps: [
        "Importez votre PDF scanné (ou vos photos de documents converties en PDF) dans GigaPDF.",
        "Lancez l'OCR depuis le menu d'actions du document.",
        "Tesseract analyse chaque page et reconnaît le texte en français et en anglais.",
        "Récupérez le texte : copie directe, export TXT, ou génération d'un PDF cherchable.",
        "Le document devient trouvable par son contenu dans la recherche plein texte de votre espace.",
      ],
    },
    capabilities: [
      "Moteur Tesseract avec modèles français et anglais (fra+eng)",
      "Reconnaissance fidèle des accents et caractères spéciaux du français",
      "Traitement page par page des documents multipages",
      "Export du texte reconnu (TXT) ou génération d'un calque cherchable invisible",
      "Indexation du contenu reconnu dans la recherche plein texte de la GED",
      "Exécution sur votre propre serveur en auto-hébergement : les scans ne quittent pas votre infrastructure",
    ],
    faq: [
      {
        question: "Quelles langues l'OCR de GigaPDF reconnaît-il ?",
        answer:
          "Le moteur Tesseract est configuré avec les modèles français et anglais, utilisables simultanément : un contrat bilingue ou une facture mêlant les deux langues est traité en une seule passe. Les caractères accentués du français sont correctement restitués.",
      },
      {
        question: "Quelle qualité de scan faut-il pour un bon résultat ?",
        answer:
          "Tesseract donne d'excellents résultats sur des scans nets à 300 dpi avec un texte d'imprimerie. Les documents inclinés, les photocopies de photocopies ou les très petites tailles de caractères dégradent la reconnaissance ; mieux vaut numériser à plat et en bonne résolution quand c'est possible.",
      },
      {
        question: "L'OCR reconnaît-il l'écriture manuscrite ?",
        answer:
          "Non, et il faut s'en méfier des promesses contraires : Tesseract est conçu pour les caractères imprimés. Une mention manuscrite isolée sur un formulaire ne sera généralement pas reconnue, même si le reste du document imprimé l'est parfaitement.",
      },
      {
        question: "Que devient le document original après l'OCR ?",
        answer:
          "Il n'est pas altéré. L'OCR produit du texte que vous exploitez comme vous voulez : copie, export, ou création d'un PDF cherchable où le texte reconnu est posé en calque invisible sous l'image du scan — le document garde alors son apparence exacte tout en devenant sélectionnable.",
      },
    ],
    useCases: [
      "Rendre exploitables des factures scannées : montants et références deviennent copiables et cherchables",
      "Numériser des archives papier et les retrouver ensuite par leur contenu, pas seulement par leur nom de fichier",
      "Extraire le texte d'un contrat reçu en scan pour le citer ou le réviser",
    ],
    relatedTools: ["pdf-cherchable", "compresser-pdf", "pdf-vers-word"],
    relatedSolutions: ["experts-comptables", "avocats", "sante"],
    icon: "scan-text",
  },
  {
    slug: "pdf-cherchable",
    name: "PDF cherchable",
    metaTitle: "Rendre un PDF cherchable (calque texte OCR) | GigaPDF",
    metaDescription:
      "Ajoutez un calque de texte invisible sur vos scans : le PDF garde son apparence et devient sélectionnable et cherchable. Gratuit, open source.",
    h1: "Rendre un PDF scanné cherchable sans changer son apparence",
    intro: [
      "C'est la technique dite du « PDF sandwich » : l'image numérisée reste affichée telle quelle, et le texte reconnu par OCR est inséré en dessous, dans un calque invisible parfaitement aligné sur les mots de l'image. Visuellement, rien ne change — le tampon, la signature manuscrite et la mise en page d'origine restent intacts. Mais le document répond désormais à Ctrl+F, le texte se sélectionne à la souris et les lecteurs d'écran peuvent le lire.",
      "GigaPDF construit ce calque à partir de la reconnaissance Tesseract (français et anglais) : chaque mot reconnu est positionné aux coordonnées exactes où il apparaît dans l'image, si bien qu'une recherche surligne le bon endroit de la page et qu'un copier-coller suit l'ordre de lecture. C'est la différence avec un simple export texte, qui perd toute correspondance avec la page.",
      "Pour une GED, c'est l'étape qui change tout : un fonds documentaire scanné devient interrogeable en texte intégral. Combinée à la recherche plein texte de GigaPDF, la sandwich-isation transforme des années d'archives papier numérisées en base documentaire réellement consultable — sur le cloud ou sur votre propre serveur en auto-hébergement.",
    ],
    howTo: {
      title: "Comment ajouter un calque cherchable à un scan",
      steps: [
        "Importez le PDF scanné dans votre espace GigaPDF.",
        "Lancez la création du PDF cherchable depuis le menu d'actions.",
        "Tesseract reconnaît le texte de chaque page (français + anglais).",
        "Le texte est incrusté en calque invisible, mot par mot, aux coordonnées de l'image.",
        "Téléchargez le résultat : apparence identique, mais texte sélectionnable et cherchable partout.",
      ],
    },
    capabilities: [
      "Calque de texte invisible aligné sur l'image d'origine (PDF sandwich)",
      "Apparence du document strictement inchangée : tampons et signatures visibles conservés",
      "Recherche Ctrl+F fonctionnelle dans toutes les visionneuses PDF",
      "Sélection et copier-coller du texte directement sur le scan",
      "Reconnaissance Tesseract français + anglais",
      "Indexation automatique dans la recherche plein texte de la GED GigaPDF",
    ],
    faq: [
      {
        question: "Quelle différence entre l'OCR simple et le PDF cherchable ?",
        answer:
          "L'OCR simple extrait le texte vers l'extérieur du document (copie, fichier TXT). Le PDF cherchable réinjecte ce texte dans le document lui-même, en calque invisible sous l'image : le fichier garde son apparence de scan mais se comporte comme un PDF natif pour la recherche, la sélection et l'accessibilité.",
      },
      {
        question: "Le calque invisible modifie-t-il l'aspect du document ?",
        answer:
          "Non, par construction : le texte est inséré en mode de rendu invisible, sous l'image numérisée. À l'écran comme à l'impression, le document est identique au scan d'origine. Seuls les comportements changent : la recherche trouve, la souris sélectionne.",
      },
      {
        question: "La recherche surligne-t-elle le bon endroit de la page ?",
        answer:
          "Oui. Chaque mot du calque est positionné aux coordonnées où Tesseract l'a détecté dans l'image. Quand votre visionneuse surligne un résultat de recherche, le surlignage tombe sur le mot visible correspondant — ce qui rend la consultation de gros documents scannés réellement praticable.",
      },
      {
        question: "Est-ce utile pour l'accessibilité ?",
        answer:
          "Oui. Un scan brut est inaccessible aux lecteurs d'écran, qui n'y voient qu'une image. Avec le calque texte, le contenu devient vocalisable et navigable. La qualité dépend de celle de la reconnaissance : un scan net donne un calque fidèle.",
      },
    ],
    useCases: [
      "Convertir un fonds d'archives numérisées en base documentaire interrogeable par mots-clés",
      "Rendre les contrats scannés cherchables tout en conservant tampons et signatures visibles",
      "Améliorer l'accessibilité de documents distribués initialement sous forme de scans",
    ],
    relatedTools: ["ocr-pdf", "compresser-pdf", "pdf-a"],
    relatedSolutions: ["avocats", "experts-comptables", "architectes-btp"],
    icon: "file-search",
  },
  {
    slug: "proteger-pdf",
    name: "Protéger un PDF",
    metaTitle: "Protéger un PDF : mot de passe et chiffrement | GigaPDF",
    metaDescription:
      "Chiffrez vos PDF (AES-256, AES-128 ou RC4) et contrôlez impression, copie et modification. Protection par mot de passe gratuite et open source.",
    h1: "Protéger un PDF par mot de passe et chiffrement",
    intro: [
      "Envoyer un bulletin de salaire, un relevé médical ou une offre commerciale par e-mail, c'est accepter que le fichier circule au-delà du destinataire prévu : transferts, boîtes partagées, pièces jointes archivées par des serveurs tiers. Le chiffrement du PDF lui-même est la parade la plus simple — le document devient illisible sans le mot de passe, où qu'il se trouve.",
      "GigaPDF chiffre vos fichiers au standard PDF avec trois algorithmes au choix : AES-256, le niveau recommandé aujourd'hui ; AES-128, largement compatible ; et RC4, conservé uniquement pour les rares visionneuses anciennes qui l'exigent. Vous définissez un mot de passe d'ouverture et, séparément, un mot de passe propriétaire assorti de permissions : autoriser ou interdire l'impression, la copie de texte, la modification du contenu et le remplissage de formulaires.",
      "La distinction entre les deux mots de passe est précieuse : vous pouvez diffuser un document lisible par tous mais verrouillé en modification, ou au contraire totalement confidentiel. Le chiffrement s'applique en un clic depuis votre espace, sans supplément — comme toutes les fonctions de GigaPDF, il est inclus dans le plan gratuit et disponible en auto-hébergement.",
    ],
    howTo: {
      title: "Comment protéger un PDF par mot de passe",
      steps: [
        "Importez le document à protéger dans votre espace GigaPDF.",
        "Ouvrez l'outil de protection et choisissez l'algorithme : AES-256 recommandé.",
        "Définissez le mot de passe d'ouverture, à transmettre au destinataire par un canal séparé.",
        "Réglez les permissions : impression, copie, modification, remplissage de formulaires.",
        "Validez et téléchargez le PDF chiffré : sans mot de passe, son contenu est illisible.",
      ],
    },
    capabilities: [
      "Chiffrement AES-256, AES-128 ou RC4 selon vos contraintes de compatibilité",
      "Mot de passe d'ouverture (lecture) distinct du mot de passe propriétaire (droits)",
      "Permissions granulaires : impression, copie de texte, modification, formulaires",
      "Suppression de la protection d'un fichier dont vous connaissez le mot de passe",
      "Application en un clic depuis la GED, sans logiciel à installer",
      "Chaîne complète opérable sur votre propre serveur en auto-hébergement",
    ],
    faq: [
      {
        question: "Quel algorithme de chiffrement choisir ?",
        answer:
          "AES-256 dans la quasi-totalité des cas : c'est le standard le plus robuste pris en charge par le format PDF et par toutes les visionneuses modernes. AES-128 reste un choix sûr si vous visez de très vieux lecteurs. RC4 est obsolète sur le plan cryptographique et ne devrait servir qu'en compatibilité contrainte avec des systèmes anciens.",
      },
      {
        question: "Quelle différence entre mot de passe d'ouverture et mot de passe propriétaire ?",
        answer:
          "Le mot de passe d'ouverture est exigé pour lire le document. Le mot de passe propriétaire contrôle les droits : un fichier peut s'ouvrir librement mais refuser l'impression ou la copie tant que ce second mot de passe n'est pas fourni. Les deux se combinent selon votre besoin de confidentialité.",
      },
      {
        question: "Les restrictions de copie et d'impression sont-elles infaillibles ?",
        answer:
          "Non, et il faut le savoir : les permissions PDF sont respectées par les visionneuses conformes, mais un outil malveillant peut les ignorer dès lors que le document s'ouvre. Pour une confidentialité réelle, utilisez le mot de passe d'ouverture avec AES-256 : sans lui, le contenu est cryptographiquement illisible.",
      },
      {
        question: "Que faire si j'oublie le mot de passe d'un PDF chiffré en AES-256 ?",
        answer:
          "Il n'existe pas de porte dérobée : c'est précisément ce qui fait la valeur du chiffrement. Conservez vos mots de passe dans un gestionnaire dédié. Si le fichier d'origine non chiffré est encore dans votre espace GigaPDF, l'historique de versions vous permet de le récupérer et de rechiffrer.",
      },
    ],
    useCases: [
      "Envoyer bulletins de paie et documents RH chiffrés, le mot de passe transitant par un autre canal",
      "Diffuser une étude ou un devis lisible mais verrouillé contre la modification et la copie",
      "Archiver des documents médicaux ou juridiques chiffrés en AES-256 dans la GED",
    ],
    relatedTools: ["signer-pdf", "filigrane-pdf", "pdf-a", "editer-pdf"],
    relatedSolutions: ["sante", "ressources-humaines", "avocats"],
    icon: "lock",
  },
  {
    slug: "filigrane-pdf",
    name: "Filigrane PDF",
    metaTitle: "Ajouter un filigrane à un PDF en ligne | GigaPDF",
    metaDescription:
      "Apposez un filigrane texte ou image (logo) sur toutes les pages d'un PDF : CONFIDENTIEL, BROUILLON, marque… Gratuit et open source.",
    h1: "Ajouter un filigrane texte ou image sur un PDF",
    intro: [
      "Un document sans marquage circule sans contexte : une version de travail est prise pour définitive, une étude confidentielle se retrouve transférée, un devis est réutilisé par un concurrent sans attribution. Le filigrane répond à ces trois situations d'un coup : il imprime le statut du document — BROUILLON, CONFIDENTIEL, SPÉCIMEN — ou votre identité visuelle sur chaque page, de manière indissociable du contenu.",
      "GigaPDF applique deux types de filigranes : du texte, dont vous choisissez le contenu, la taille, la couleur, l'opacité et l'inclinaison (la diagonale translucide classique), ou une image — typiquement votre logo — positionnée et dosée pour rester discrète sans disparaître. Le filigrane est inscrit dans le contenu des pages au moment du traitement, pas posé comme une annotation supprimable en deux clics depuis n'importe quelle visionneuse.",
      "Précision qui a son importance : GigaPDF n'ajoute jamais son propre filigrane publicitaire sur vos fichiers, contrairement à nombre d'outils « gratuits ». Les filigranes sont les vôtres, appliqués quand vous le décidez, y compris dans le plan gratuit et sur instance auto-hébergée.",
    ],
    howTo: {
      title: "Comment ajouter un filigrane à un PDF",
      steps: [
        "Importez le document à marquer dans votre espace GigaPDF.",
        "Choisissez le type de filigrane : texte libre ou image (votre logo).",
        "Réglez l'apparence : position, taille, opacité, rotation pour la diagonale classique.",
        "Appliquez : le filigrane est inscrit sur toutes les pages du document.",
        "Téléchargez ou partagez le PDF marqué ; l'original reste disponible dans l'historique.",
      ],
    },
    capabilities: [
      "Filigrane texte : contenu, police, taille, couleur, opacité et rotation réglables",
      "Filigrane image : logo ou tampon graphique avec opacité dosée",
      "Application sur l'ensemble des pages en une opération",
      "Filigrane inscrit dans le contenu de la page, pas une simple annotation amovible",
      "Aucun filigrane publicitaire GigaPDF ajouté à vos fichiers",
      "Original conservé grâce à l'historique de versions",
    ],
    faq: [
      {
        question: "Le filigrane peut-il être retiré par le destinataire ?",
        answer:
          "GigaPDF inscrit le filigrane dans le contenu des pages, ce qui le rend bien plus solide qu'une annotation, supprimable en deux clics. Un utilisateur outillé et déterminé peut toujours retravailler un PDF ; pour un engagement fort, combinez filigrane, chiffrement AES avec restriction de modification, et signature numérique qui révèle toute altération.",
      },
      {
        question: "Puis-je utiliser mon logo en filigrane sans écraser le texte du document ?",
        answer:
          "Oui : l'opacité se règle finement. Un logo à 10-15 % d'opacité, centré ou placé en pied de page, marque le document sans gêner la lecture ni l'impression. Vous prévisualisez le rendu avant d'appliquer.",
      },
      {
        question: "Peut-on filigraner plusieurs documents avec le même réglage ?",
        answer:
          "Oui. Vos réglages (texte, opacité, position) se réappliquent d'un document à l'autre, et l'API de GigaPDF — incluse à hauteur de 1 000 appels par mois dans le plan gratuit — permet d'automatiser le marquage systématique des fichiers d'un flux documentaire.",
      },
      {
        question: "Quelle est la différence entre un filigrane et un tampon ?",
        answer:
          "Le filigrane est appliqué uniformément sur toutes les pages, en arrière-plan ou en surimpression translucide : il qualifie le document entier. Le tampon est une annotation ponctuelle posée à un endroit précis d'une page — « Validé », « Reçu le… ». GigaPDF propose les deux : le filigrane ici, les tampons via l'outil d'annotation.",
      },
    ],
    useCases: [
      "Marquer BROUILLON ou CONFIDENTIEL les versions de travail avant relecture externe",
      "Apposer le logo du cabinet ou de l'agence sur les livrables envoyés aux clients",
      "Étiqueter SPÉCIMEN des documents types diffusés à des fins de démonstration",
    ],
    relatedTools: ["proteger-pdf", "annoter-pdf", "editer-pdf"],
    relatedSolutions: ["freelances", "enseignants-formateurs", "immobilier"],
    icon: "stamp",
  },
  {
    slug: "organiser-pages-pdf",
    name: "Organiser les pages",
    metaTitle: "Organiser un PDF : trier et pivoter les pages | GigaPDF",
    metaDescription:
      "Réordonnez, faites pivoter, supprimez ou extrayez les pages d'un PDF par glisser-déposer sur miniatures. Gratuit, open source, auto-hébergeable.",
    h1: "Organiser les pages d'un PDF : réordonner, pivoter, supprimer",
    intro: [
      "Les numérisations recto-verso qui intercalent les pages dans le désordre, les scans passés à l'envers dans le chargeur, la page 12 qui aurait dû être la 3 : remettre de l'ordre dans un PDF est l'une des opérations les plus banales — et les plus pénibles quand l'outil impose de ressaisir des numéros de pages à l'aveugle.",
      "GigaPDF affiche le document en planche de miniatures : chaque page se voit, s'attrape et se déplace par glisser-déposer. La rotation se corrige page par page ou par lot (90°, 180°, 270°), les pages blanches ou inutiles se suppriment d'un clic, et une sélection s'extrait en nouveau fichier sans quitter l'écran. Le moteur applique l'ensemble des changements en une passe, sans recompresser le contenu des pages.",
      "Chaque réorganisation crée une nouvelle version dans l'historique du document : un faux mouvement se rattrape en restaurant l'état précédent. Cette ergonomie visuelle, combinée à la fusion et à la division, couvre tout le cycle de préparation d'un dossier — assembler, ordonner, épurer — depuis le navigateur, gratuitement.",
    ],
    howTo: {
      title: "Comment réorganiser les pages d'un PDF",
      steps: [
        "Ouvrez votre document dans GigaPDF et passez en vue miniatures.",
        "Glissez-déposez les pages pour corriger l'ordre du document.",
        "Sélectionnez les pages à pivoter et appliquez la rotation 90°, 180° ou 270°.",
        "Supprimez les pages blanches ou hors sujet d'un clic.",
        "Enregistrez : les changements sont appliqués en une passe et l'ancienne version reste restaurable.",
      ],
    },
    capabilities: [
      "Réorganisation par glisser-déposer sur la planche de miniatures",
      "Rotation par page ou par lot : 90°, 180°, 270°",
      "Suppression de pages et extraction d'une sélection en nouveau fichier",
      "Application des modifications en une passe, sans recompression du contenu",
      "Historique de versions : chaque réorganisation est réversible",
      "Enchaînement direct avec la fusion, la division et la compression",
    ],
    faq: [
      {
        question: "Comment corriger un scan recto-verso dont les pages sont intercalées dans le désordre ?",
        answer:
          "C'est le cas d'école de la vue miniatures : vous voyez d'un coup d'œil la séquence réelle (1, 3, 5… puis 2, 4, 6…) et vous replacez les pages par glisser-déposer. Sur un document long, l'extraction des pages paires puis une re-fusion ordonnée peut aller encore plus vite — les deux outils s'enchaînent dans GigaPDF.",
      },
      {
        question: "La rotation est-elle enregistrée définitivement dans le fichier ?",
        answer:
          "Oui. La rotation appliquée dans GigaPDF est inscrite dans le PDF lui-même : le document s'ouvrira dans le bon sens dans toutes les visionneuses, à l'écran comme à l'impression — contrairement à la rotation d'affichage temporaire que proposent certains lecteurs.",
      },
      {
        question: "Puis-je annuler une réorganisation après l'avoir enregistrée ?",
        answer:
          "Oui. Chaque enregistrement crée une version dans l'historique du document. Vous pouvez consulter les versions précédentes et restaurer celle d'avant la manipulation, ce qui rend l'opération sans risque même sur un document important.",
      },
      {
        question: "Que deviennent les pages supprimées ?",
        answer:
          "Elles disparaissent de la version courante du document, mais restent présentes dans les versions antérieures de l'historique. Et si vous supprimez un document entier par erreur, la corbeille de la GED le conserve 30 jours avant suppression définitive.",
      },
    ],
    useCases: [
      "Remettre dans l'ordre une numérisation dont les pages sont mélangées ou à l'envers",
      "Épurer un dossier avant envoi : retirer pages blanches, doublons et brouillons",
      "Recomposer un document à partir de plusieurs sources puis l'ordonner visuellement",
    ],
    relatedTools: ["fusionner-pdf", "diviser-pdf", "editer-pdf"],
    relatedSolutions: ["immobilier", "experts-comptables", "ressources-humaines"],
    icon: "layout-grid",
  },
  {
    slug: "annoter-pdf",
    name: "Annoter un PDF",
    metaTitle: "Annoter un PDF en ligne : notes et surlignage | GigaPDF",
    metaDescription:
      "Surlignez, commentez et dessinez sur vos PDF avec des annotations natives lisibles dans toutes les visionneuses. Gratuit et open source.",
    h1: "Annoter un PDF : surligner, commenter, dessiner",
    intro: [
      "Relire un contrat, corriger un mémoire, commenter une maquette : le travail sur document est d'abord un travail de marge. Imprimer pour annoter au stylo puis rescanner fait perdre le texte cherchable et la qualité ; commenter dans un e-mail séparé déconnecte les remarques de leur contexte. L'annotation directe dans le PDF garde chaque commentaire à l'endroit exact qu'il concerne.",
      "GigaPDF écrit des annotations natives au standard PDF : surlignage, notes, texte libre, formes et tracés sont enregistrés comme objets d'annotation conformes, et non aplatis en image. Concrètement, vos marques restent visibles et listables dans Adobe Reader, dans l'aperçu macOS, dans un navigateur — et le destinataire peut y répondre avec son propre outil, même s'il n'utilise pas GigaPDF.",
      "La collaboration en temps réel ajoute la dimension d'équipe : plusieurs relecteurs annotent le même document simultanément et voient les marques des autres apparaître en direct. Combiné au partage par lien et à l'historique de versions de la GED, le cycle de relecture entier se passe au même endroit, sans pièce jointe.",
    ],
    howTo: {
      title: "Comment annoter un document PDF",
      steps: [
        "Ouvrez le PDF dans l'éditeur GigaPDF.",
        "Surlignez les passages clés en sélectionnant le texte.",
        "Ajoutez des notes et commentaires aux endroits qui appellent une remarque.",
        "Dessinez si besoin : flèches, cadres et tracés libres pour pointer un détail visuel.",
        "Partagez le document par lien : vos annotations sont visibles dans toutes les visionneuses, et l'équipe peut annoter en temps réel.",
      ],
    },
    capabilities: [
      "Surlignage du texte avec choix de couleur",
      "Notes et commentaires positionnés au point exact qu'ils concernent",
      "Texte libre, formes et dessin à main levée sur la page",
      "Annotations natives au standard PDF, lisibles dans toutes les visionneuses",
      "Annotation collaborative en temps réel à plusieurs sur le même fichier",
      "Partage par lien ou e-mail et historique de versions intégrés",
    ],
    faq: [
      {
        question: "Mes annotations seront-elles visibles dans Adobe Reader ?",
        answer:
          "Oui. GigaPDF enregistre des annotations natives conformes au standard PDF : Adobe Reader, l'aperçu macOS, les navigateurs et les autres visionneuses les affichent et les listent dans leur panneau de commentaires. Rien n'est propriétaire ni enfermé dans la plateforme.",
      },
      {
        question: "Peut-on annoter à plusieurs en même temps ?",
        answer:
          "Oui, c'est l'un des points forts de GigaPDF : la collaboration en temps réel permet à plusieurs relecteurs d'ouvrir le même document et de voir les annotations des autres apparaître en direct, sans conflit de versions ni fusion manuelle de commentaires.",
      },
      {
        question: "Quelle différence entre annoter et éditer le PDF ?",
        answer:
          "L'annotation se superpose au contenu sans le modifier : c'est la couche de relecture, listable et attribuable. L'édition change le contenu lui-même — corriger le texte, remplacer une image. GigaPDF fait les deux, dans le même éditeur, mais il est utile de choisir : on annote une proposition, on édite son propre document.",
      },
      {
        question: "Puis-je figer les annotations pour qu'elles ne soient plus modifiables ?",
        answer:
          "Oui, c'est le rôle de l'aplatissement, disponible dans l'outil formulaires de GigaPDF : il fond les annotations dans le contenu des pages. Elles restent visibles mais ne sont plus des objets séparés modifiables — utile avant archivage ou diffusion finale.",
      },
    ],
    useCases: [
      "Relire un contrat à plusieurs en surlignant les clauses à renégocier",
      "Corriger des copies ou des mémoires avec notes en marge, sans imprimer",
      "Commenter un état des lieux ou un plan directement sur le document de référence",
    ],
    relatedTools: ["editer-pdf", "filigrane-pdf", "formulaires-pdf"],
    relatedSolutions: ["education-etudiants", "enseignants-formateurs", "architectes-btp"],
    icon: "highlighter",
  },
  {
    slug: "formulaires-pdf",
    name: "Formulaires PDF",
    metaTitle: "Remplir un formulaire PDF en ligne | GigaPDF",
    metaDescription:
      "Remplissez les champs d'un formulaire PDF dans le navigateur et aplatissez le résultat pour figer les réponses. Gratuit et open source.",
    h1: "Remplir et aplatir des formulaires PDF",
    intro: [
      "Les formulaires PDF interactifs — champs AcroForm avec zones de texte, cases à cocher et listes — sont partout dans la vie administrative : demandes officielles, formulaires d'inscription, documents d'embauche. Encore faut-il un outil qui les remplisse correctement : nombre de visionneuses gratuites affichent les champs mais perdent les saisies à l'enregistrement, ou forcent l'impression-rescan.",
      "GigaPDF lit la structure du formulaire, présente chaque champ à la saisie dans le navigateur et enregistre les valeurs dans le fichier, conformément au standard. Troisième opération, souvent décisive : l'aplatissement. Il fond les champs remplis dans le contenu des pages — les réponses deviennent du contenu définitif, non modifiable par un simple clic dans le champ. C'est l'étape qui sépare un brouillon de formulaire d'un document à transmettre.",
      "Pour les organisations, la lecture des champs par l'API ouvre l'automatisation : extraire les valeurs saisies dans les formulaires reçus sans ressaisie manuelle. Le plan gratuit inclut le remplissage, l'aplatissement et 1 000 appels API par mois ; l'auto-hébergement garde les formulaires sensibles sur votre infrastructure.",
    ],
    howTo: {
      title: "Comment remplir un formulaire PDF",
      steps: [
        "Importez le formulaire PDF dans votre espace GigaPDF.",
        "Ouvrez-le : les champs interactifs (texte, cases, listes) sont détectés automatiquement.",
        "Saisissez vos réponses directement dans le navigateur.",
        "Enregistrez les valeurs dans le fichier, ou aplatissez le formulaire pour figer définitivement les réponses.",
        "Téléchargez, partagez par lien, ou signez ensuite numériquement le document complété.",
      ],
    },
    capabilities: [
      "Détection et lecture des champs de formulaire (AcroForm)",
      "Remplissage dans le navigateur : texte, cases à cocher, listes",
      "Enregistrement des valeurs conforme au standard PDF",
      "Aplatissement : les réponses sont fondues dans la page, non modifiables",
      "Extraction des valeurs saisies via l'API pour automatiser le traitement",
      "Enchaînement naturel avec la signature numérique PKCS#7",
    ],
    faq: [
      {
        question: "Pourquoi aplatir un formulaire après l'avoir rempli ?",
        answer:
          "Tant que les champs restent interactifs, n'importe quel destinataire peut modifier vos réponses d'un clic. L'aplatissement transforme les valeurs saisies en contenu de page définitif : le document se fige tel que vous l'avez complété. C'est la bonne pratique avant transmission officielle ou archivage.",
      },
      {
        question: "Que faire d'un formulaire non interactif, simple page scannée avec des lignes vides ?",
        answer:
          "S'il n'y a pas de champs AcroForm, le remplissage de formulaire n'a pas de prise — mais l'éditeur GigaPDF prend le relais : ajoutez des zones de texte par-dessus les lignes du document, positionnées précisément, puis enregistrez. Le résultat est équivalent à un formulaire complété.",
      },
      {
        question: "Les listes déroulantes et cases à cocher sont-elles gérées ?",
        answer:
          "Oui. GigaPDF lit les différents types de champs du standard : zones de texte, cases à cocher, boutons radio et listes. Chaque champ se manipule dans le navigateur comme dans un formulaire web, et la valeur est écrite dans le fichier à l'enregistrement.",
      },
      {
        question: "Puis-je récupérer automatiquement les réponses des formulaires que je reçois ?",
        answer:
          "Oui, via l'API : la lecture des champs retourne les valeurs saisies de manière structurée, ce qui évite la ressaisie quand vous collectez des dizaines de formulaires identiques. Le plan gratuit comprend 1 000 appels API par mois — de quoi automatiser un flux régulier.",
      },
    ],
    useCases: [
      "Compléter des documents administratifs ou d'embauche sans imprimante ni scanner",
      "Figer par aplatissement les réponses d'un formulaire avant envoi officiel",
      "Collecter des formulaires remplis et en extraire les valeurs automatiquement par API",
    ],
    relatedTools: ["signer-pdf", "editer-pdf", "annoter-pdf"],
    relatedSolutions: ["ressources-humaines", "associations", "immobilier"],
    icon: "clipboard-list",
  },
  {
    slug: "pdf-vers-word",
    name: "PDF vers Word",
    metaTitle: "Convertir un PDF en Word (DOCX) en ligne | GigaPDF",
    metaDescription:
      "Transformez vos PDF en documents Word modifiables (.docx), mise en page préservée. Conversion gratuite, open source, sans filigrane.",
    h1: "Convertir un PDF en document Word modifiable",
    intro: [
      "Le PDF fige, Word libère : quand il faut reprendre intégralement un document — restructurer un rapport, réutiliser les paragraphes d'un contrat type, repartir d'une trame existante — l'édition ponctuelle ne suffit plus, il faut retrouver un fichier traitement de texte. La conversion PDF vers DOCX reconstruit le document dans un format où chaque élément redevient malléable.",
      "GigaPDF analyse la structure du PDF — blocs de texte, paragraphes, images, tableaux — et génère un fichier .docx ouvert par Word, LibreOffice ou Google Docs. Les conversions fidèles exigent un vrai travail de reconstruction : respecter l'enchaînement des paragraphes plutôt que de produire une zone de texte par ligne, conserver les images à leur place, restituer les tableaux en tableaux. C'est ce que vise le moteur de conversion, exécuté côté serveur.",
      "Un cas mérite une mention : les PDF scannés. Sans texte numérique, il n'y a rien à convertir — passez d'abord le document à l'OCR de GigaPDF (français + anglais), puis convertissez. La chaîne scan → OCR → DOCX transforme un papier numérisé en document Word retravaillable, entièrement dans la même plateforme, gratuitement.",
    ],
    howTo: {
      title: "Comment convertir un PDF en Word",
      steps: [
        "Importez le PDF à convertir dans votre espace GigaPDF.",
        "S'il s'agit d'un scan, lancez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format DOCX dans le menu de conversion.",
        "Le moteur reconstruit paragraphes, images et tableaux dans le fichier Word.",
        "Téléchargez le .docx et ouvrez-le dans Word, LibreOffice ou Google Docs.",
      ],
    },
    capabilities: [
      "Export DOCX compatible Word, LibreOffice et Google Docs",
      "Reconstruction des paragraphes, images et tableaux",
      "Conversion côté serveur, sans installation locale",
      "Chaîne scan → OCR → DOCX pour les documents numérisés",
      "Aucun filigrane ajouté sur le document converti",
      "Exports complémentaires depuis le même menu : ODT, TXT, HTML, PNG, JPEG",
    ],
    faq: [
      {
        question: "La mise en page sera-t-elle identique à l'original ?",
        answer:
          "L'objectif est la fidélité maximale, mais soyons honnêtes : PDF et DOCX décrivent les documents différemment, et les mises en page très graphiques (colonnes imbriquées, texte sur images, plaquettes design) peuvent demander des ajustements après conversion. Les documents textuels classiques — rapports, contrats, courriers — se convertissent très proprement.",
      },
      {
        question: "Puis-je convertir un PDF scanné en Word ?",
        answer:
          "Oui, en deux temps : l'OCR d'abord, la conversion ensuite. Un scan ne contient que des images ; l'OCR Tesseract de GigaPDF en extrait le texte (français et anglais), qui alimente alors la conversion DOCX. Sans cette étape, le fichier Word ne contiendrait que des images de pages.",
      },
      {
        question: "Les tableaux du PDF restent-ils des tableaux dans Word ?",
        answer:
          "Les structures tabulaires détectées sont restituées en tableaux Word, modifiables cellule par cellule. Les tableaux très complexes — cellules fusionnées en cascade, tableaux dessinés sans structure — peuvent être partiellement simplifiés ; un contrôle visuel après conversion reste recommandé sur ces cas.",
      },
      {
        question: "Y a-t-il une limite de taille ou un filigrane sur la conversion gratuite ?",
        answer:
          "Aucun filigrane, jamais. La conversion est une fonction complète du plan gratuit, dont les limites sont le stockage (5 Go) et le nombre de documents (100) — pas une dégradation du résultat. Le fichier produit vous appartient, propre.",
      },
    ],
    useCases: [
      "Reprendre un contrat ou un rapport dont vous n'avez plus le fichier source",
      "Réutiliser le contenu d'une documentation PDF dans un nouveau livrable Word",
      "Transformer des courriers scannés en documents modifiables via OCR puis conversion",
    ],
    relatedTools: ["word-vers-pdf", "ocr-pdf", "pdf-vers-odt"],
    relatedSolutions: ["freelances", "education-etudiants", "avocats"],
    icon: "file-text",
  },
  {
    slug: "word-vers-pdf",
    name: "Word vers PDF",
    metaTitle: "Convertir Word en PDF (.doc, .docx) en ligne | GigaPDF",
    metaDescription:
      "Convertissez vos documents Word en PDF fidèles via LibreOffice : .docx récents et anciens .doc. Gratuit, open source, sans filigrane.",
    h1: "Convertir un document Word en PDF",
    intro: [
      "Envoyer un .docx, c'est envoyer un document vivant : il s'affichera différemment selon la version de Word, les polices installées et la machine du destinataire — quand il ne sera pas modifié en route. Le passage en PDF verrouille la mise en page : ce que vous avez composé est exactement ce qui sera lu et imprimé, partout.",
      "GigaPDF convertit via LibreOffice exécuté côté serveur, le moteur de conversion bureautique open source le plus éprouvé. Il prend en charge le .docx moderne comme l'ancien format .doc — celui des archives Word 97-2003 qui traînent dans tous les serveurs de fichiers et que beaucoup de convertisseurs en ligne refusent. Styles, tableaux, images, en-têtes et pieds de page sont rendus dans un PDF propre, sans filigrane publicitaire.",
      "Vous n'avez pas besoin de Microsoft Office, ni d'aucune installation : le navigateur suffit. Et le PDF produit atterrit directement dans votre GED GigaPDF, où il peut être fusionné avec d'autres pièces, signé numériquement, protégé par chiffrement ou archivé en PDF/A — la conversion n'est que la première étape d'une chaîne documentaire complète.",
    ],
    howTo: {
      title: "Comment convertir un fichier Word en PDF",
      steps: [
        "Importez votre fichier .docx ou .doc dans votre espace GigaPDF.",
        "Lancez la conversion : LibreOffice restitue le document côté serveur.",
        "Vérifiez le PDF obtenu dans la visionneuse intégrée.",
        "Enchaînez si besoin : fusion avec d'autres pièces, signature, chiffrement ou filigrane.",
        "Téléchargez le PDF ou partagez-le par lien directement depuis la GED.",
      ],
    },
    capabilities: [
      "Conversion des .docx et des anciens .doc (Word 97-2003)",
      "Moteur LibreOffice côté serveur : aucune installation, pas besoin de Microsoft Office",
      "Restitution des styles, tableaux, images, en-têtes et pieds de page",
      "Aucun filigrane sur le PDF produit",
      "Enchaînement immédiat : fusion, signature numérique, chiffrement, PDF/A",
      "Import des autres formats bureautiques depuis le même flux : Excel, PowerPoint, OpenDocument",
    ],
    faq: [
      {
        question: "Les anciens fichiers .doc sont-ils vraiment pris en charge ?",
        answer:
          "Oui, c'est une spécificité utile de GigaPDF : LibreOffice lit le format binaire Word 97-2003 en plus du .docx moderne. Les archives bureautiques anciennes se convertissent sans passer par une réouverture manuelle dans Word — précieux pour numériser proprement un historique documentaire.",
      },
      {
        question: "La mise en page de mon document sera-t-elle respectée ?",
        answer:
          "LibreOffice restitue fidèlement la très grande majorité des documents : styles, tableaux, images ancrées, en-têtes, pieds de page et numérotation. Les documents dépendant de polices propriétaires non embarquées ou de macros d'affichage peuvent présenter de légers écarts ; un coup d'œil au PDF dans la visionneuse intégrée suffit à le vérifier.",
      },
      {
        question: "Puis-je convertir plusieurs documents Word d'affilée ?",
        answer:
          "Oui. Importez vos fichiers par lot et convertissez-les successivement ; via l'API, l'opération s'automatise pour les flux réguliers (1 000 appels par mois inclus dans le plan gratuit). Chaque PDF produit est classé dans votre GED, taggable et cherchable.",
      },
      {
        question: "Le PDF produit est-il modifiable ensuite ?",
        answer:
          "Oui, doublement : vous conservez le Word d'origine dans votre espace, et le PDF lui-même reste éditable dans l'éditeur WYSIWYG de GigaPDF pour les retouches ponctuelles — corriger une date, masquer une mention — sans regénérer tout le document.",
      },
    ],
    useCases: [
      "Figer un CV, un devis ou un contrat avant envoi, à l'identique sur tous les écrans",
      "Convertir en masse d'anciennes archives .doc en PDF consultables",
      "Préparer des documents Word à la signature numérique : conversion puis PKCS#7 dans la foulée",
    ],
    relatedTools: ["pdf-vers-word", "excel-vers-pdf", "powerpoint-vers-pdf", "signer-pdf"],
    relatedSolutions: ["freelances", "ressources-humaines", "associations"],
    icon: "file-input",
  },
  {
    slug: "excel-vers-pdf",
    name: "Excel vers PDF",
    metaTitle: "Convertir Excel en PDF (.xls, .xlsx) en ligne | GigaPDF",
    metaDescription:
      "Transformez vos classeurs Excel en PDF propres et imprimables via LibreOffice : .xlsx et anciens .xls. Conversion gratuite et open source.",
    h1: "Convertir un classeur Excel en PDF",
    intro: [
      "Un tableur transmis en .xlsx est un document à risques : formules visibles, onglets de travail oubliés, colonnes masquées qu'un clic révèle, et une mise en page qui explose à l'impression chez le destinataire. Pour communiquer des chiffres — devis, tableau de bord, budget — le PDF présente le résultat, et seulement le résultat, exactement cadré.",
      "GigaPDF convertit vos classeurs avec LibreOffice côté serveur : les formats .xlsx et .xls (Excel 97-2003) sont acceptés, les valeurs calculées remplacent les formules, et la zone d'impression définie dans le classeur structure la pagination du PDF. Bordures, couleurs de cellules, graphiques et formats de nombres sont restitués tels que le tableur les affiche.",
      "Conseil hérité de l'impression : la qualité du PDF se joue dans le classeur, avant conversion. Une zone d'impression définie, une orientation paysage pour les tableaux larges et un ajustement « une page en largeur » donnent un document final net. Une fois converti, le PDF se fusionne avec vos autres pièces, se protège par mot de passe ou se filigrane — sans quitter GigaPDF, gratuitement.",
    ],
    howTo: {
      title: "Comment convertir un fichier Excel en PDF",
      steps: [
        "Préparez le classeur : zone d'impression et orientation définies dans votre tableur.",
        "Importez le fichier .xlsx ou .xls dans votre espace GigaPDF.",
        "Lancez la conversion : LibreOffice calcule le rendu et pagine le document.",
        "Contrôlez le PDF dans la visionneuse : coupures de colonnes, lisibilité des chiffres.",
        "Téléchargez, fusionnez avec d'autres pièces ou partagez le PDF par lien.",
      ],
    },
    capabilities: [
      "Conversion des .xlsx et des anciens .xls (Excel 97-2003)",
      "Valeurs calculées dans le PDF : les formules ne sont pas exposées",
      "Respect des zones d'impression et de l'orientation définies dans le classeur",
      "Restitution des bordures, couleurs, graphiques et formats de nombres",
      "Import des classeurs OpenDocument (.ods) par le même moteur",
      "Fusion, protection et filigrane du PDF produit dans la même plateforme",
    ],
    faq: [
      {
        question: "Comment éviter qu'un tableau large soit coupé sur plusieurs pages ?",
        answer:
          "Réglez-le dans le classeur avant conversion : orientation paysage et ajustement « une page en largeur » dans les options de mise en page de votre tableur. LibreOffice applique ces réglages lors de la conversion ; un tableau sans mise en page définie sera paginé par défaut, avec des coupures possibles.",
      },
      {
        question: "Les formules de mon classeur apparaissent-elles dans le PDF ?",
        answer:
          "Non, et c'est l'un des intérêts de la conversion : le PDF contient les valeurs calculées, pas les formules. Vos méthodes de calcul, hypothèses intermédiaires et références de cellules restent dans le fichier source, que vous gardez pour vous.",
      },
      {
        question: "Tous les onglets du classeur sont-ils convertis ?",
        answer:
          "La conversion suit la configuration d'impression du classeur. Pour ne diffuser qu'un onglet de synthèse, définissez-le comme zone d'impression avant l'import — ou supprimez les pages superflues du PDF après conversion grâce à l'outil d'organisation des pages de GigaPDF.",
      },
      {
        question: "Les graphiques Excel sont-ils conservés ?",
        answer:
          "Oui, les graphiques sont rendus dans le PDF tels qu'ils apparaissent dans le classeur. Ils deviennent des éléments graphiques figés : c'est le but — le destinataire voit la courbe, pas les données sous-jacentes ni les séries masquées.",
      },
    ],
    useCases: [
      "Envoyer un devis ou un budget chiffré sans exposer formules et hypothèses de calcul",
      "Figer un tableau de bord mensuel en PDF pour diffusion et archivage",
      "Joindre des annexes chiffrées paginées proprement à un rapport fusionné",
    ],
    relatedTools: ["word-vers-pdf", "powerpoint-vers-pdf", "fusionner-pdf"],
    relatedSolutions: ["experts-comptables", "freelances", "associations"],
    icon: "file-spreadsheet",
  },
  {
    slug: "powerpoint-vers-pdf",
    name: "PowerPoint vers PDF",
    metaTitle: "Convertir PowerPoint en PDF (.ppt, .pptx) | GigaPDF",
    metaDescription:
      "Convertissez vos présentations PowerPoint en PDF fidèles via LibreOffice : .pptx et anciens .ppt. Gratuit, open source, sans filigrane.",
    h1: "Convertir une présentation PowerPoint en PDF",
    intro: [
      "Une présentation envoyée en .pptx arrive rarement intacte : polices substituées, animations qui n'ont plus de sens à l'arrêt, slides décalées selon la version de PowerPoint — et un fichier modifiable par n'importe qui. Le support qui circule après la réunion mérite mieux : un PDF où chaque diapositive est figée exactement comme vous l'avez conçue.",
      "GigaPDF s'appuie sur LibreOffice côté serveur pour convertir les .pptx comme les anciens .ppt (PowerPoint 97-2003). Chaque diapositive devient une page du PDF : arrière-plans, images, schémas et blocs de texte sont rendus à leur position exacte. Les animations et transitions, propres au mode diaporama, sont naturellement absentes du support figé — c'est l'état final de chaque slide qui est restitué.",
      "Le PDF obtenu est plus léger à diffuser qu'un .pptx chargé d'images, lisible sur tout appareil sans PowerPoint, et imprimable proprement. Besoin d'aller plus loin ? GigaPDF exporte aussi dans l'autre sens (PDF vers PPTX) pour reprendre un vieux support dont le fichier source a disparu — les deux sens de conversion sont inclus dans le plan gratuit.",
    ],
    howTo: {
      title: "Comment convertir un PowerPoint en PDF",
      steps: [
        "Importez votre présentation .pptx ou .ppt dans votre espace GigaPDF.",
        "Lancez la conversion : chaque diapositive est rendue en page PDF par LibreOffice.",
        "Vérifiez le résultat dans la visionneuse : polices, images et schémas en place.",
        "Appliquez si besoin un filigrane ou une protection avant diffusion.",
        "Téléchargez le PDF ou partagez-le par lien, lisible sans PowerPoint.",
      ],
    },
    capabilities: [
      "Conversion des .pptx et des anciens .ppt (PowerPoint 97-2003)",
      "Une diapositive = une page PDF, à la mise en page exacte",
      "Restitution des arrière-plans, images, schémas et zones de texte",
      "Conversion inverse disponible : export d'un PDF vers PPTX",
      "Import des présentations OpenDocument (.odp) par le même moteur",
      "Filigrane, protection et partage par lien depuis la même plateforme",
    ],
    faq: [
      {
        question: "Que deviennent les animations et transitions de ma présentation ?",
        answer:
          "Elles disparaissent, par nature : un PDF est un support figé, sans mode diaporama. Chaque diapositive est rendue dans son état final, tous éléments visibles. Si une slide révèle des blocs progressivement, pensez à vérifier que leur superposition finale reste lisible une fois figée.",
      },
      {
        question: "Les polices spéciales de ma présentation seront-elles respectées ?",
        answer:
          "Les polices embarquées ou standard sont restituées fidèlement. Une police exotique non disponible côté moteur de conversion est remplacée par la plus proche — comme le ferait PowerPoint sur une machine où elle manque. Le PDF de contrôle dans la visionneuse permet de le vérifier en quelques secondes.",
      },
      {
        question: "Puis-je convertir un PDF en PowerPoint, dans l'autre sens ?",
        answer:
          "Oui. GigaPDF propose l'export PDF vers PPTX : chaque page redevient une diapositive avec ses textes et images, modifiable dans PowerPoint ou LibreOffice Impress. C'est la solution quand le fichier source d'un support a été perdu et qu'il faut le faire évoluer.",
      },
      {
        question: "Le PDF est-il plus léger que la présentation d'origine ?",
        answer:
          "Souvent, oui : le PDF ne transporte ni les animations, ni les médias inutilisés, ni les masques de diapositives multiples. Et si le résultat reste lourd — présentations très riches en photos — l'outil de compression MuPDF de GigaPDF le réduit encore d'une passe.",
      },
    ],
    useCases: [
      "Diffuser le support d'une formation ou d'une conférence après la session, figé et lisible partout",
      "Archiver les présentations clients en PDF dans la GED, cherchables et versionnées",
      "Imprimer proprement un jeu de slides pour une réunion sans vidéoprojecteur",
    ],
    relatedTools: ["word-vers-pdf", "excel-vers-pdf", "compresser-pdf", "filigrane-pdf"],
    relatedSolutions: ["enseignants-formateurs", "freelances", "associations"],
    icon: "presentation",
  },
  {
    slug: "opendocument-pdf",
    name: "OpenDocument et PDF",
    metaTitle: "Convertir OpenDocument en PDF (ODT, ODS, ODP) | GigaPDF",
    metaDescription:
      "Convertissez ODT, ODS et ODP en PDF, et repassez du PDF vers ODT ou ODP. Le pont LibreOffice ↔ PDF, gratuit et open source.",
    h1: "OpenDocument vers PDF, et retour : ODT, ODS, ODP",
    intro: [
      "Les administrations, les collectivités et les organisations attachées au logiciel libre travaillent en OpenDocument : textes .odt, classeurs .ods, présentations .odp. Format ouvert, normalisé ISO — mais minoritaire face à l'écosystème Microsoft, ce qui complique les échanges : le destinataire n'a pas toujours LibreOffice, et la plupart des convertisseurs en ligne ignorent purement ces formats.",
      "GigaPDF les traite en citoyens de première classe, et pour cause : son moteur de conversion est LibreOffice lui-même, exécuté côté serveur. Les trois formats se convertissent en PDF avec la fidélité du logiciel natif — styles, tableaux, graphiques et mises en page restitués sans approximation d'un convertisseur tiers. Et le chemin inverse existe : un PDF s'exporte en ODT pour retravailler le texte, ou en ODP pour reprendre une présentation, refermant la boucle avec votre suite bureautique libre.",
      "Cette cohérence open source va jusqu'au bout de la chaîne : GigaPDF est publié sous licence AGPL et s'auto-héberge. Une organisation qui a fait le choix du libre pour sa bureautique peut faire le même choix pour sa plateforme documentaire — conversion, édition, signature et GED comprises, sans dépendre d'un service propriétaire.",
    ],
    howTo: {
      title: "Comment convertir entre OpenDocument et PDF",
      steps: [
        "Importez votre fichier .odt, .ods ou .odp dans votre espace GigaPDF.",
        "Lancez la conversion en PDF : LibreOffice serveur restitue le document à l'identique.",
        "Vérifiez le rendu dans la visionneuse intégrée.",
        "Pour le sens inverse, ouvrez un PDF et exportez-le en ODT (texte) ou ODP (présentation).",
        "Classez, partagez ou signez le résultat directement dans la GED.",
      ],
    },
    capabilities: [
      "Conversion en PDF des textes .odt, classeurs .ods et présentations .odp",
      "Moteur LibreOffice natif côté serveur : fidélité maximale au format OpenDocument",
      "Export inverse du PDF vers ODT et ODP pour retravailler les contenus",
      "Classeurs : export des données d'un PDF vers XLSX exploitable dans LibreOffice Calc",
      "Aucun filigrane, conversion incluse dans le plan gratuit",
      "Plateforme AGPL auto-hébergeable : la chaîne documentaire libre de bout en bout",
    ],
    faq: [
      {
        question: "Pourquoi la conversion OpenDocument est-elle plus fiable ici qu'ailleurs ?",
        answer:
          "Parce que GigaPDF convertit avec LibreOffice lui-même, le logiciel de référence du format OpenDocument, exécuté côté serveur. Là où d'autres services passent par des bibliothèques de réinterprétation approximatives — quand ils acceptent ces formats —, GigaPDF utilise le rendu natif : ce que LibreOffice affiche est ce que le PDF contient.",
      },
      {
        question: "Puis-je reconvertir un PDF en fichier OpenDocument modifiable ?",
        answer:
          "Oui pour les textes et les présentations : l'export ODT reconstruit un document texte modifiable et l'export ODP des diapositives reprenables dans Impress. Pour les données tabulaires d'un PDF, l'export se fait en XLSX, que LibreOffice Calc ouvre et réenregistre en .ods nativement.",
      },
      {
        question: "Les documents .ods avec graphiques et formules sont-ils bien rendus ?",
        answer:
          "Oui : les classeurs sont convertis avec leurs valeurs calculées, leurs formats de cellules et leurs graphiques, selon la zone d'impression définie. Comme pour Excel, les formules restent dans le fichier source — le PDF expose les résultats, pas la mécanique.",
      },
      {
        question: "GigaPDF est-il adapté à une administration sous contrainte de souveraineté ?",
        answer:
          "C'est l'un de ses terrains naturels : code source AGPL auditable, auto-hébergement complet sur vos serveurs, formats ouverts en entrée comme en sortie. Aucun document n'a besoin de transiter par un cloud tiers, et aucune licence propriétaire n'entre dans la chaîne.",
      },
    ],
    useCases: [
      "Diffuser en PDF des documents produits sous LibreOffice à des destinataires non équipés",
      "Reprendre en ODT un PDF dont le fichier source a disparu, sans passer par Word",
      "Outiller une organisation 100 % logiciel libre : LibreOffice + GigaPDF auto-hébergé",
    ],
    relatedTools: ["pdf-vers-odt", "word-vers-pdf", "pdf-a"],
    relatedSolutions: ["associations", "education-etudiants", "sante"],
    icon: "file-stack",
  },
  {
    slug: "pdf-vers-odt",
    name: "PDF vers ODT",
    metaTitle: "Convertir un PDF en ODT (LibreOffice Writer) | GigaPDF",
    metaDescription:
      "Transformez un PDF en document ODT modifiable dans LibreOffice Writer, texte et images repris. Conversion gratuite et open source.",
    h1: "Convertir un PDF en ODT modifiable dans LibreOffice",
    intro: [
      "Pour qui travaille sous LibreOffice, convertir un PDF en .docx est un détour absurde : il faut ensuite réimporter le fichier Word dans Writer, avec une couche de conversion supplémentaire et son lot d'écarts. GigaPDF offre le chemin direct : du PDF vers l'ODT, le format natif de LibreOffice Writer, en une seule transformation.",
      "Le moteur analyse le PDF — paragraphes, images, structure de page — et reconstruit un document texte OpenDocument : le texte redevient des paragraphes éditables avec leurs attributs, les images reprennent leur place, et le fichier s'ouvre dans Writer comme n'importe quel .odt, prêt à être restylé avec vos modèles. Pour les PDF scannés, l'OCR Tesseract intégré (français + anglais) fournit d'abord le texte, la conversion fait le reste.",
      "Ce choix de format n'est pas anodin : l'ODT est une norme ISO ouverte, lisible aujourd'hui et dans vingt ans, sans dépendance à un éditeur. GigaPDF — open source, auto-hébergeable, sans filigrane — complète logiquement cette philosophie : vos documents repassent du format figé au format libre, avec des outils libres.",
    ],
    howTo: {
      title: "Comment convertir un PDF en ODT",
      steps: [
        "Importez le PDF dans votre espace GigaPDF.",
        "S'il s'agit d'un document scanné, appliquez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format ODT dans le menu de conversion.",
        "Le moteur reconstruit paragraphes et images en document OpenDocument.",
        "Ouvrez le .odt dans LibreOffice Writer et reprenez la rédaction.",
      ],
    },
    capabilities: [
      "Export ODT natif, sans détour par le format Word",
      "Reconstruction des paragraphes éditables et reprise des images",
      "Chaîne scan → OCR Tesseract → ODT pour les documents numérisés",
      "Fichier conforme OpenDocument, ouvert par Writer et tout éditeur compatible",
      "Aucun filigrane sur le document converti",
      "Autres exports disponibles au même endroit : DOCX, ODP, TXT, HTML",
    ],
    faq: [
      {
        question: "Pourquoi convertir directement en ODT plutôt qu'en DOCX puis ouvrir dans Writer ?",
        answer:
          "Chaque conversion de format introduit ses approximations. Passer par DOCX en ajoute une seconde : PDF vers DOCX, puis DOCX vers le modèle interne de Writer. L'export ODT direct de GigaPDF n'en fait qu'une, vers le format que Writer parle nativement — moins d'écarts, moins de reprises.",
      },
      {
        question: "Le document converti garde-t-il sa mise en forme ?",
        answer:
          "Le texte revient avec ses attributs essentiels — corps, graisse, alignements — et les images à leur position. Comme pour toute conversion depuis PDF, un document très graphique peut demander des retouches dans Writer ; un rapport, un courrier ou un contrat se reprend en général directement.",
      },
      {
        question: "Puis-je convertir un scan en ODT ?",
        answer:
          "Oui, en chaînant deux outils GigaPDF : l'OCR d'abord, qui reconnaît le texte du scan en français et en anglais, puis l'export ODT, qui le structure en document Writer. Sans l'étape OCR, un scan n'a pas de texte à convertir.",
      },
      {
        question: "Le fichier ODT produit est-il standard ?",
        answer:
          "Oui : c'est un document OpenDocument conforme, lisible par LibreOffice, OpenOffice, et tout logiciel respectant la norme ISO 26300 — y compris Word, qui ouvre les .odt. Vous n'êtes enfermé ni dans GigaPDF ni dans aucun éditeur.",
      },
    ],
    useCases: [
      "Reprendre dans Writer un document officiel diffusé uniquement en PDF",
      "Réintégrer d'anciens livrables PDF dans une chaîne éditoriale LibreOffice",
      "Convertir des courriers scannés en ODT retravaillables via l'OCR intégré",
    ],
    relatedTools: ["opendocument-pdf", "pdf-vers-word", "ocr-pdf"],
    relatedSolutions: ["associations", "education-etudiants", "avocats"],
    icon: "file-output",
  },
  {
    slug: "html-vers-pdf",
    name: "HTML vers PDF",
    metaTitle: "Convertir HTML ou une page web en PDF | GigaPDF",
    metaDescription:
      "Transformez du HTML ou une URL en PDF rendu par Chromium : CSS moderne, polices web, pages longues. Gratuit, open source, avec API.",
    h1: "Convertir du HTML ou une page web en PDF",
    intro: [
      "Le web est devenu la source de la plupart des documents : factures générées par les applications, confirmations de commande, articles, rapports produits par des outils internes. Les figer en PDF — pour archiver, prouver, transmettre — exige un rendu exact. Or le HTML moderne (flexbox, grid, polices web, contenu injecté par JavaScript) dépasse largement ce que savent restituer les bibliothèques de conversion légères.",
      "GigaPDF prend le problème par le bon bout : le rendu est confié à Chromium, le moteur de Chrome, piloté côté serveur. Vous fournissez du code HTML ou simplement une URL ; la page est chargée, les styles appliqués, les polices web téléchargées, puis le document est imprimé en PDF exactement comme le ferait le navigateur. Ce que vous voyez en ligne est ce que contient le fichier.",
      "C'est aussi un outil d'automatisation de premier plan : via l'API GigaPDF (1 000 appels par mois inclus dans le plan gratuit), vos applications génèrent leurs factures, attestations et rapports en envoyant du HTML — le langage de gabarit le plus universel qui soit — et reçoivent des PDF prêts à archiver dans la GED. En auto-hébergement, cette chaîne tourne entièrement sur vos serveurs.",
    ],
    howTo: {
      title: "Comment convertir une page web en PDF",
      steps: [
        "Indiquez la source : une URL publique ou votre code HTML complet.",
        "Chromium charge la page côté serveur : CSS, polices web et mise en page appliqués.",
        "Le rendu est imprimé en PDF, fidèle à l'affichage navigateur.",
        "Récupérez le document dans votre espace GigaPDF, prêt à être classé ou partagé.",
        "Pour automatiser, appelez la même conversion par API depuis vos applications.",
      ],
    },
    capabilities: [
      "Rendu par Chromium : le moteur d'un vrai navigateur, pas une approximation",
      "Conversion depuis une URL ou depuis du code HTML fourni",
      "Prise en charge du CSS moderne (flexbox, grid) et des polices web",
      "Génération automatisée par API : factures, attestations, rapports",
      "PDF classé directement dans la GED : dossiers, tags, recherche, partage",
      "Exécution intégralement sur vos serveurs en auto-hébergement",
    ],
    faq: [
      {
        question: "Pourquoi le rendu Chromium fait-il la différence ?",
        answer:
          "Parce que les convertisseurs HTML légers implémentent un sous-ensemble daté du CSS : les mises en page en flexbox ou grid s'effondrent, les polices web manquent, le JavaScript n'est pas exécuté. Chromium est le moteur qui affiche le web réel — le PDF produit correspond pixel pour pixel à ce que montre Chrome.",
      },
      {
        question: "Puis-je générer mes factures en PDF automatiquement ?",
        answer:
          "Oui, c'est le cas d'usage type : votre application construit la facture en HTML (un gabarit avec vos styles), l'envoie à l'API GigaPDF et reçoit le PDF. Le plan gratuit inclut 1 000 appels API par mois ; le document peut être archivé, protégé ou signé numériquement dans la foulée.",
      },
      {
        question: "Les pages nécessitant une connexion sont-elles convertibles ?",
        answer:
          "La conversion par URL charge la page telle qu'elle est accessible publiquement : un contenu derrière authentification n'y apparaîtra pas. La solution robuste consiste à fournir directement le HTML — votre application, elle, a accès aux données et construit le document complet avant conversion.",
      },
      {
        question: "Comment maîtriser la pagination du PDF produit ?",
        answer:
          "Avec les outils standard du CSS d'impression, que Chromium honore : propriétés page-break/break-inside pour contrôler les coupures, règles @media print pour adapter les styles, @page pour les marges. Un gabarit HTML bien préparé donne des PDF paginés au cordeau, reproductibles à chaque génération.",
      },
    ],
    useCases: [
      "Générer automatiquement factures et attestations en PDF depuis vos applications via l'API",
      "Archiver une page web — article, annonce, conditions en vigueur — telle qu'affichée à une date donnée",
      "Produire des rapports PDF à partir de gabarits HTML stylés, reproductibles à l'identique",
    ],
    relatedTools: ["pdf-a", "compresser-pdf", "proteger-pdf"],
    relatedSolutions: ["freelances", "immobilier", "experts-comptables"],
    icon: "globe",
  },
  {
    slug: "pdf-a",
    name: "PDF/A",
    metaTitle: "Convertir en PDF/A : archivage conforme | GigaPDF",
    metaDescription:
      "Convertissez vos PDF au format d'archivage PDF/A-1b ou PDF/A-2b, conforme ISO 19005. Outil gratuit, open source et auto-hébergeable.",
    h1: "Convertir un PDF en PDF/A pour l'archivage à long terme",
    intro: [
      "Un PDF ordinaire ne garantit rien sur la durée : polices non embarquées qui s'afficheront autrement dans dix ans, contenus dépendant de ressources externes, éléments dynamiques. Pour les documents qui engagent — contrats, factures, dossiers réglementaires — la norme ISO 19005 a défini le PDF/A : un profil restreint du PDF où tout ce qui est nécessaire à l'affichage est contenu dans le fichier, pour toujours.",
      "GigaPDF convertit vos documents vers deux niveaux de conformité : PDF/A-1b, le profil historique le plus largement exigé par les administrations, et PDF/A-2b, plus récent, qui autorise notamment la compression JPEG2000 et la transparence — souvent le meilleur choix pour les documents contemporains. La conversion embarque les polices, normalise les espaces colorimétriques et inscrit les métadonnées de conformité que les validateurs vérifient.",
      "L'archivage conforme est fréquemment une obligation : marchés publics, conservation des factures, procédures dématérialisées et systèmes d'archivage électronique exigent du PDF/A en entrée. Avec GigaPDF, la mise en conformité est une opération d'un clic — ou un appel d'API pour traiter les flux —, incluse dans le plan gratuit et opérable sur votre propre infrastructure.",
    ],
    howTo: {
      title: "Comment convertir un document en PDF/A",
      steps: [
        "Importez le PDF à mettre en conformité dans votre espace GigaPDF.",
        "Choisissez le niveau cible : PDF/A-1b (exigence classique) ou PDF/A-2b (profil plus récent).",
        "Lancez la conversion : polices embarquées, couleurs normalisées, métadonnées de conformité inscrites.",
        "Récupérez le fichier conforme, prêt pour le dépôt ou le système d'archivage.",
        "Conservez l'original dans la GED : versions, tags et recherche plein texte restent disponibles.",
      ],
    },
    capabilities: [
      "Conversion vers PDF/A-1b et PDF/A-2b (ISO 19005)",
      "Polices embarquées dans le fichier : affichage identique dans le temps",
      "Normalisation des espaces colorimétriques et métadonnées XMP de conformité",
      "Traitement unitaire en un clic ou en flux via l'API",
      "Combinable avec l'OCR : un scan devient une archive conforme et cherchable",
      "Auto-hébergement possible pour les politiques d'archivage internes strictes",
    ],
    faq: [
      {
        question: "PDF/A-1b ou PDF/A-2b : lequel choisir ?",
        answer:
          "Suivez d'abord l'exigence du destinataire : si une administration ou un SAE impose un niveau, la question est tranchée. À défaut, PDF/A-2b est généralement préférable pour les documents actuels — il accepte la transparence et des compressions plus efficaces — tandis que PDF/A-1b reste la valeur sûre face aux systèmes anciens.",
      },
      {
        question: "Qu'est-ce qui change concrètement dans mon fichier ?",
        answer:
          "Tout ce qui rendrait l'affichage dépendant de l'extérieur est résolu : les polices sont embarquées, les couleurs rattachées à un profil explicite, les métadonnées de conformité inscrites au format XMP. Les contenus interdits par la norme — éléments dynamiques, dépendances externes — sont neutralisés. Visuellement, le document reste le même.",
      },
      {
        question: "Un PDF/A est-il encore modifiable ou signable ?",
        answer:
          "Le PDF/A reste un PDF : techniquement lisible et éditable partout. L'esprit de l'archivage veut qu'on fige le document — et la bonne pratique consiste à le signer numériquement (PKCS#7, disponible dans GigaPDF) : toute modification ultérieure devient détectable, ce qui complète la garantie de pérennité par une garantie d'intégrité.",
      },
      {
        question: "Puis-je rendre un scan conforme PDF/A et cherchable à la fois ?",
        answer:
          "Oui, c'est la chaîne d'archivage idéale dans GigaPDF : OCR Tesseract pour reconnaître le texte, calque cherchable invisible pour le rendre exploitable, puis conversion PDF/A. Le document final est à la fois pérenne, conforme et interrogeable en texte intégral.",
      },
    ],
    useCases: [
      "Mettre les factures et pièces comptables au format exigé pour la conservation légale",
      "Déposer des documents conformes dans les téléprocédures et marchés publics",
      "Constituer des archives de cabinet pérennes : OCR + PDF/A + signature numérique",
    ],
    relatedTools: ["signer-pdf", "ocr-pdf", "pdf-cherchable", "proteger-pdf"],
    relatedSolutions: ["avocats", "experts-comptables", "sante"],
    icon: "archive",
  },
];

/** Index par slug pour les pages dynamiques. */
const TOOLS_BY_SLUG = new Map(TOOLS.map((tool) => [tool.slug, tool]));

export function getToolBySlug(slug: string): ToolData | undefined {
  return TOOLS_BY_SLUG.get(slug);
}

export function getAllToolSlugs(): string[] {
  return TOOLS.map((tool) => tool.slug);
}
