/**
 * PDF Tools configuration for GigaPDF
 * Based on the real GigaPDF API endpoints
 *
 * API Documentation: https://giga-pdf.com/api/v1/docs
 */

import { PDFTool, ToolCategory } from '../types/tools';

/**
 * All available PDF tools matching the GigaPDF API
 */
export const pdfTools: PDFTool[] = [
  // ============================================
  // ÉDITION DE TEXTE
  // ============================================
  {
    id: 'add-text',
    name: 'Ajouter du texte',
    description: 'Ajoutez du texte personnalisé à vos documents PDF',
    icon: 'text-outline',
    color: '#3B82F6',
    route: '/tools/add-text',
    apiEndpoint: '/documents/{id}/pages/{page}/elements',
    isNew: true,
  },
  {
    id: 'edit-text',
    name: 'Modifier le texte',
    description: 'Recherchez et remplacez du texte dans votre PDF',
    icon: 'create-outline',
    color: '#8B5CF6',
    route: '/tools/edit-text',
    apiEndpoint: '/documents/{id}/text/replace',
  },
  {
    id: 'extract-text',
    name: 'Extraire le texte',
    description: 'Extrayez tout le texte de votre document PDF',
    icon: 'document-text-outline',
    color: '#EC4899',
    route: '/tools/extract-text',
    apiEndpoint: '/documents/{id}/text/extract',
  },
  {
    id: 'search-text',
    name: 'Rechercher dans le PDF',
    description: 'Recherchez des mots ou phrases dans votre document',
    icon: 'search-outline',
    color: '#06B6D4',
    route: '/tools/search-text',
    apiEndpoint: '/documents/{id}/text/search',
  },

  // ============================================
  // ÉDITION D'IMAGES
  // ============================================
  {
    id: 'add-image',
    name: 'Ajouter une image',
    description: 'Insérez des images dans votre document PDF',
    icon: 'image-outline',
    color: '#10B981',
    route: '/tools/add-image',
    apiEndpoint: '/documents/{id}/pages/{page}/elements',
    isNew: true,
  },
  {
    id: 'extract-images',
    name: 'Extraire les images',
    description: 'Récupérez toutes les images intégrées du PDF',
    icon: 'images-outline',
    color: '#F59E0B',
    route: '/tools/extract-images',
    apiEndpoint: '/documents/{id}/pages/{page}/images/{xref}',
  },

  // ============================================
  // DESSINS ET FORMES
  // ============================================
  {
    id: 'add-shape',
    name: 'Ajouter des formes',
    description: 'Dessinez des rectangles, cercles et lignes',
    icon: 'shapes-outline',
    color: '#6366F1',
    route: '/tools/add-shape',
    apiEndpoint: '/documents/{id}/pages/{page}/elements',
  },
  {
    id: 'draw',
    name: 'Dessiner',
    description: 'Dessinez à main levée sur votre document',
    icon: 'brush-outline',
    color: '#A855F7',
    route: '/tools/draw',
    apiEndpoint: '/documents/{id}/pages/{page}/elements',
    isNew: true,
  },

  // ============================================
  // SIGNATURE
  // ============================================
  {
    id: 'sign',
    name: 'Signer le PDF',
    description: 'Ajoutez votre signature manuscrite au document',
    icon: 'finger-print-outline',
    color: '#EF4444',
    route: '/tools/sign',
    apiEndpoint: '/documents/{id}/pages/{page}/elements',
    isNew: true,
  },
  {
    id: 'add-stamp',
    name: 'Ajouter un tampon',
    description: 'Appliquez un tampon prédéfini ou personnalisé',
    icon: 'checkmark-circle-outline',
    color: '#14B8A6',
    route: '/tools/add-stamp',
    apiEndpoint: '/documents/{id}/pages/{page}/elements',
  },

  // ============================================
  // GESTION DES PAGES
  // ============================================
  {
    id: 'rotate',
    name: 'Pivoter les pages',
    description: 'Faites pivoter les pages de 90°, 180° ou 270°',
    icon: 'sync-outline',
    color: '#3B82F6',
    route: '/tools/rotate',
    apiEndpoint: '/documents/{id}/pages/{page}/rotate',
  },
  {
    id: 'reorder',
    name: 'Réorganiser les pages',
    description: 'Changez l\'ordre des pages par glisser-déposer',
    icon: 'reorder-four-outline',
    color: '#F97316',
    route: '/tools/reorder',
    apiEndpoint: '/documents/{id}/pages/reorder',
  },
  {
    id: 'extract-pages',
    name: 'Extraire des pages',
    description: 'Extrayez des pages vers un nouveau document',
    icon: 'copy-outline',
    color: '#84CC16',
    route: '/tools/extract-pages',
    apiEndpoint: '/documents/{id}/pages/extract',
  },
  {
    id: 'delete-pages',
    name: 'Supprimer des pages',
    description: 'Supprimez une ou plusieurs pages du document',
    icon: 'trash-outline',
    color: '#EF4444',
    route: '/tools/delete-pages',
    apiEndpoint: '/documents/{id}/pages/{page}',
  },
  {
    id: 'resize',
    name: 'Redimensionner',
    description: 'Changez la taille des pages (A4, Letter, etc.)',
    icon: 'resize-outline',
    color: '#8B5CF6',
    route: '/tools/resize',
    apiEndpoint: '/documents/{id}/pages/{page}/resize',
  },

  // ============================================
  // ANNOTATIONS
  // ============================================
  {
    id: 'highlight',
    name: 'Surligner',
    description: 'Surlignez du texte en jaune, vert ou rose',
    icon: 'color-fill-outline',
    color: '#FBBF24',
    route: '/tools/highlight',
    apiEndpoint: '/documents/{id}/pages/{page}/annotations/markup',
  },
  {
    id: 'underline',
    name: 'Souligner',
    description: 'Soulignez du texte important',
    icon: 'remove-outline',
    color: '#3B82F6',
    route: '/tools/underline',
    apiEndpoint: '/documents/{id}/pages/{page}/annotations/markup',
  },
  {
    id: 'strikethrough',
    name: 'Barrer',
    description: 'Barrez du texte à supprimer',
    icon: 'close-outline',
    color: '#EF4444',
    route: '/tools/strikethrough',
    apiEndpoint: '/documents/{id}/pages/{page}/annotations/markup',
  },
  {
    id: 'add-note',
    name: 'Ajouter une note',
    description: 'Ajoutez des commentaires et notes sur le document',
    icon: 'chatbubble-outline',
    color: '#F59E0B',
    route: '/tools/add-note',
    apiEndpoint: '/documents/{id}/pages/{page}/annotations/note',
  },
  {
    id: 'add-link',
    name: 'Ajouter un lien',
    description: 'Créez des liens vers des URLs ou pages du document',
    icon: 'link-outline',
    color: '#06B6D4',
    route: '/tools/add-link',
    apiEndpoint: '/documents/{id}/pages/{page}/annotations/link',
  },

  // ============================================
  // FORMULAIRES
  // ============================================
  {
    id: 'fill-form',
    name: 'Remplir un formulaire',
    description: 'Remplissez les champs de formulaire existants',
    icon: 'checkbox-outline',
    color: '#10B981',
    route: '/tools/fill-form',
    apiEndpoint: '/documents/{id}/forms/fill',
  },
  {
    id: 'create-form',
    name: 'Créer des champs',
    description: 'Ajoutez des champs de formulaire interactifs',
    icon: 'add-circle-outline',
    color: '#6366F1',
    route: '/tools/create-form',
    apiEndpoint: '/documents/{id}/pages/{page}/forms/fields',
  },
  {
    id: 'flatten-form',
    name: 'Aplatir le formulaire',
    description: 'Convertissez les champs en texte statique',
    icon: 'layers-outline',
    color: '#8B5CF6',
    route: '/tools/flatten-form',
    apiEndpoint: '/documents/{id}/forms/flatten',
  },

  // ============================================
  // CALQUES
  // ============================================
  {
    id: 'manage-layers',
    name: 'Gérer les calques',
    description: 'Affichez, masquez et organisez les calques',
    icon: 'git-compare-outline',
    color: '#A855F7',
    route: '/tools/manage-layers',
    apiEndpoint: '/documents/{id}/layers',
  },

  // ============================================
  // SÉCURITÉ
  // ============================================
  {
    id: 'unlock',
    name: 'Déverrouiller le PDF',
    description: 'Supprimez le mot de passe d\'un PDF protégé',
    icon: 'lock-open-outline',
    color: '#84CC16',
    route: '/tools/unlock',
    apiEndpoint: '/documents/{id}/unlock',
  },

  // ============================================
  // HISTORIQUE
  // ============================================
  {
    id: 'undo-redo',
    name: 'Annuler / Refaire',
    description: 'Gérez l\'historique des modifications',
    icon: 'arrow-undo-outline',
    color: '#64748B',
    route: '/tools/history',
    apiEndpoint: '/documents/{id}/history',
  },
];

/**
 * Tool categories for organized display
 */
export const toolCategories: ToolCategory[] = [
  {
    id: 'edit-text',
    name: 'Édition de texte',
    description: 'Ajoutez, modifiez et extrayez du texte',
    icon: 'text-outline',
    tools: pdfTools.filter((t) =>
      ['add-text', 'edit-text', 'extract-text', 'search-text'].includes(t.id)
    ),
  },
  {
    id: 'edit-images',
    name: 'Images et médias',
    description: 'Gérez les images de votre document',
    icon: 'image-outline',
    tools: pdfTools.filter((t) =>
      ['add-image', 'extract-images'].includes(t.id)
    ),
  },
  {
    id: 'drawing',
    name: 'Dessins et formes',
    description: 'Dessinez et ajoutez des formes',
    icon: 'brush-outline',
    tools: pdfTools.filter((t) =>
      ['add-shape', 'draw'].includes(t.id)
    ),
  },
  {
    id: 'signature',
    name: 'Signature',
    description: 'Signez et tamponnez vos documents',
    icon: 'finger-print-outline',
    tools: pdfTools.filter((t) =>
      ['sign', 'add-stamp'].includes(t.id)
    ),
  },
  {
    id: 'pages',
    name: 'Gestion des pages',
    description: 'Organisez les pages de votre PDF',
    icon: 'documents-outline',
    tools: pdfTools.filter((t) =>
      ['rotate', 'reorder', 'extract-pages', 'delete-pages', 'resize'].includes(t.id)
    ),
  },
  {
    id: 'annotations',
    name: 'Annotations',
    description: 'Surlignez, commentez et annotez',
    icon: 'color-fill-outline',
    tools: pdfTools.filter((t) =>
      ['highlight', 'underline', 'strikethrough', 'add-note', 'add-link'].includes(t.id)
    ),
  },
  {
    id: 'forms',
    name: 'Formulaires',
    description: 'Remplissez et créez des formulaires',
    icon: 'checkbox-outline',
    tools: pdfTools.filter((t) =>
      ['fill-form', 'create-form', 'flatten-form'].includes(t.id)
    ),
  },
  {
    id: 'security',
    name: 'Sécurité',
    description: 'Protégez et déverrouillez vos PDF',
    icon: 'shield-outline',
    tools: pdfTools.filter((t) =>
      ['unlock'].includes(t.id)
    ),
  },
  {
    id: 'advanced',
    name: 'Avancé',
    description: 'Fonctionnalités avancées',
    icon: 'settings-outline',
    tools: pdfTools.filter((t) =>
      ['manage-layers', 'undo-redo'].includes(t.id)
    ),
  },
];

/**
 * Quick access tools (most used)
 */
export const quickAccessTools = pdfTools.filter((t) =>
  ['add-text', 'add-image', 'sign', 'highlight', 'rotate', 'fill-form'].includes(t.id)
);

/**
 * New tools to highlight
 */
export const newTools = pdfTools.filter((t) => t.isNew);

// Note: GigaPDF is fully open source and free - no premium tiers

/**
 * Get tool by ID
 */
export function getToolById(id: string): PDFTool | undefined {
  return pdfTools.find((t) => t.id === id);
}

/**
 * Get category by ID
 */
export function getCategoryById(id: string): ToolCategory | undefined {
  return toolCategories.find((c) => c.id === id);
}

/**
 * Search tools by name or description
 */
export function searchTools(query: string): PDFTool[] {
  const lowerQuery = query.toLowerCase();
  return pdfTools.filter(
    (t) =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery)
  );
}
