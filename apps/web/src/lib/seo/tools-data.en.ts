/**
 * Programmatic SEO data — English tool pages (/en/tools/[slug]).
 *
 * Static content written natively in English (not translated literally).
 * Every entry describes ONLY capabilities that actually exist in GigaPDF
 * (pdf-engine, MuPDF, LibreOffice headless, tesseract, Chromium).
 * No variable templates: intros and FAQs are written individually.
 *
 * Slugs are English-specific; the FR ↔ EN mapping lives in ./slug-map.ts.
 * relatedTools / relatedSolutions reference EN slugs only.
 */

import type { ToolData } from "./tools-data";

export const TOOLS: ToolData[] = [
  {
    slug: "edit-pdf",
    name: "Edit PDF",
    metaTitle: "Edit PDF Online: Change Text & Images Free | GigaPDF",
    metaDescription:
      "Edit text, images, and shapes inside your PDF with the original fonts. Free WYSIWYG editor — open source, self-hostable, no watermark.",
    h1: "Online PDF editor: change the text inside the file itself",
    intro: [
      "Fixing a typo in a contract that only exists as a PDF, updating a price on a brochure, swapping out an old logo: most online tools handle this by painting a white box over the old content and hoping nobody notices. GigaPDF works differently. Its WYSIWYG editor opens the page exactly as it will print and lets you click any text block, image, or shape to change it, move it, or genuinely remove it.",
      "Font fidelity is what makes the result look right. GigaPDF identifies the fonts used in the document, fetches them automatically from Google Fonts when they are available there, and embeds them in the file when you save. Your correction picks up the same typeface as the surrounding paragraph instead of an ugly Arial substitute. Deletions go through the MuPDF engine, which strips the text operators out of the content stream rather than hiding them — nothing resurfaces when someone copies and pastes.",
      "The editor runs in the browser with nothing to install. The free plan includes every editing feature, along with 5 GB of storage and 100 documents. The code is open source under the AGPL license, so teams handling sensitive files can run the whole application on their own server.",
    ],
    howTo: {
      title: "How to edit a PDF online",
      steps: [
        "Create a free account and drag your PDF into your workspace.",
        "Open the document in the editor: every text block, image, and shape becomes selectable.",
        "Double-click any text to correct it; the original font loads automatically.",
        "Add new elements where you need them: text boxes, images, rectangles, arrows, or lines.",
        "Delete what no longer belongs: the content is removed from the file, not covered up.",
        "Save: edited fonts are embedded and a new version of the document is kept.",
      ],
    },
    capabilities: [
      "WYSIWYG editing of existing text, images, and shapes",
      "Original fonts detected, fetched from Google Fonts, and embedded on save",
      "True content removal through MuPDF — no white-box masking",
      "Native annotations, watermarks, and form filling from the same editor",
      "Version history and page thumbnails in the built-in document manager",
      "Real-time collaboration on the same document",
    ],
    faq: [
      {
        question: "Can I change the existing text of a PDF, not just add new text on top?",
        answer:
          "Yes. GigaPDF extracts the text blocks from the file and makes them editable in place. When you correct a paragraph, the old content is removed from the PDF stream by MuPDF and the new text is written with the original font, which gets embedded in the file when you save.",
      },
      {
        question: "What happens when the PDF uses a font I don't have installed?",
        answer:
          "You don't need to install anything. GigaPDF reads the font declared in the document and downloads it automatically from Google Fonts whenever it is published there. If a proprietary font is not available, a close equivalent is offered and clearly flagged before you save.",
      },
      {
        question: "Is the GigaPDF editor actually free?",
        answer:
          "Yes. The free plan covers every feature, editing included, with 5 GB of storage, 100 documents, and 1,000 API calls per month. There is no stripped-down edition of the editor: the limits apply to volume, never to functionality.",
      },
      {
        question: "Are my confidential documents safe?",
        answer:
          "Your files stay in your personal workspace, can be encrypted with AES-256, and remain recoverable from the trash for 30 days. For full control, GigaPDF is open source and self-hostable: you can run the entire application on your own infrastructure.",
      },
      {
        question: "Can several people edit a PDF at the same time?",
        answer:
          "Yes, the editor supports real-time collaboration. Several people can open the same document, watch each other's changes appear live, and work without overwriting one another — no more version ping-pong by email.",
      },
    ],
    useCases: [
      "Fix a typo or update a date in a contract without going back to the original Word file",
      "Replace a logo, a price, or a legal notice on a sales brochure that only exists as a PDF",
      "Clean up a document received from a third party: strip outdated elements and add what's missing",
    ],
    relatedTools: ["annotate-pdf", "organize-pdf-pages", "watermark-pdf", "pdf-forms"],
    relatedSolutions: ["freelancers", "human-resources", "lawyers"],
    icon: "pen-line",
  },
  {
    slug: "merge-pdf",
    name: "Merge PDF",
    metaTitle: "Merge PDF Files Online Free | GigaPDF",
    metaDescription:
      "Combine several PDFs into one file, in the order you choose. Free, no added watermark, pages copied without recompression. Open source.",
    h1: "Merge several PDFs into a single document",
    intro: [
      "Application files, supporting documents for a loan, a report assembled from three departments: these things always end up scattered across five or six separate PDFs. Sending them as-is forces the recipient to juggle attachments; printing and rescanning them murders the quality. Merging produces one continuously paginated file, ready to send or archive.",
      "GigaPDF assembles your PDFs server-side with its dedicated engine: pages are copied without recompression, bookmarks and form fields from the source files survive as far as the format allows, and no advertising watermark lands on the result. You set the file order before merging, then fine-tune the page order in the editor if something needs adjusting.",
      "The merged file drops straight into your GigaPDF document manager, where it can be tagged, found through full-text search, and shared by link or email. All of it ships with the free plan, and since the code is published under the AGPL license, the whole application can run on your own server.",
    ],
    howTo: {
      title: "How to merge PDF files",
      steps: [
        "Upload the PDFs you want to combine, in one batch or several.",
        "Select the documents and start the merge from the actions menu.",
        "Drag the files into the final assembly order.",
        "Confirm: the engine copies the pages without recompression and builds the combined document.",
        "Adjust the page order in the editor if needed, then share or file the merged PDF.",
      ],
    },
    capabilities: [
      "Merge any number of files into a single PDF",
      "Reorder documents before assembly",
      "Pages copied without recompression or quality loss",
      "No watermark added to the output file",
      "Fine-grained page reordering after the merge, in the editor",
      "Result filed in the document manager: folders, tags, full-text search",
    ],
    faq: [
      {
        question: "How many PDF files can I merge at once?",
        answer:
          "GigaPDF puts no ceiling on the number of files in a merge. The only boundary is your storage: the free plan gives you 5 GB and 100 documents, which comfortably covers bundles running to several hundred pages.",
      },
      {
        question: "Does merging degrade document quality?",
        answer:
          "No. Pages are copied into the final file exactly as they are, with no image re-encoding and no reinterpretation of the content. A vector PDF stays vector, a scan keeps its original resolution. If you want a lighter result, run the compression tool afterwards — it's optional.",
      },
      {
        question: "Can I change the page order after merging?",
        answer:
          "Yes. The merged document opens in the GigaPDF editor, where the thumbnail view lets you move, rotate, delete, or extract any page. You never have to redo the merge because one page landed in the wrong spot.",
      },
      {
        question: "Do forms and links from the source files survive?",
        answer:
          "Form fields and internal links are carried into the merged file as far as the PDF structure allows. When two forms use identical field names, GigaPDF tells them apart so one entry doesn't overwrite the other.",
      },
    ],
    useCases: [
      "Assemble a rental or loan application: ID, payslips, and tax statements in a single file",
      "Bundle a month of invoices into one package before sending it to your accountant",
      "Build a final report from PDF chapters written by several contributors",
    ],
    relatedTools: ["split-pdf", "organize-pdf-pages", "compress-pdf"],
    relatedSolutions: ["accountants", "real-estate", "nonprofits"],
    icon: "merge",
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    metaTitle: "Split PDF: Extract Pages Online Free | GigaPDF",
    metaDescription:
      "Cut a PDF into separate files or pull out just the pages you need. Visual thumbnail selection, free and open source.",
    h1: "Split a PDF and extract just the pages you need",
    intro: [
      "Sending the three relevant pages of a forty-page report, isolating each payslip from a payroll run, separating the technical annex from the main contract: cutting a PDF apart is often more useful than sending the whole thing. It keeps information away from people it doesn't concern and makes every exchange lighter.",
      "In GigaPDF, splitting is visual. Thumbnails of every page appear on screen; you tick the pages to extract or set the cut points, and the engine produces independent files by copying pages without recompressing them. The reverse move works from the same screen: delete pages from a document to keep only what matters.",
      "Every output file is a complete, standalone PDF that can be filed in your folders, tagged, and found again through the document manager's full-text search. Splitting comes with the free plan, with no cap on how often you use it, and works the same on a self-hosted instance.",
    ],
    howTo: {
      title: "How to split a PDF file",
      steps: [
        "Upload the PDF you want to cut into your workspace.",
        "Open the thumbnail view to see every page at a glance.",
        "Select the pages to extract, or define the split ranges (for example 1-4, 5-12, 13-20).",
        "Run the operation: each segment becomes its own PDF file.",
        "Rename and file the new documents, then share the ones that need to go out.",
      ],
    },
    capabilities: [
      "Extract a single page, a range, or any free selection of pages",
      "Cut one document into several files in a single operation",
      "Visual selection on thumbnails — no typing page numbers blind",
      "Pages copied without recompression: quality strictly identical to the source",
      "Page deletion and rotation from the same screen",
      "New files filed immediately in the document manager",
    ],
    faq: [
      {
        question: "Can I extract non-consecutive pages, say pages 2, 7, and 15?",
        answer:
          "Yes. Selection happens page by page on the thumbnails: tick pages 2, 7, and 15 and GigaPDF assembles them into a new file in the order you chose. You are never restricted to continuous ranges.",
      },
      {
        question: "Is the original document modified when I split it?",
        answer:
          "No. Splitting creates new files and leaves the source untouched in your workspace. If you genuinely want to trim the original, use page deletion in the editor instead — version history lets you walk it back either way.",
      },
      {
        question: "How do I cut a large PDF into equal parts?",
        answer:
          "Set your intervals in the split dialog — every 10 pages, for instance — and GigaPDF generates one file per segment in a single pass. It's the fastest way to break a long scan or a bulky export into manageable chunks.",
      },
      {
        question: "Do extracted files keep searchable text and links?",
        answer:
          "Yes. Pages travel with everything they contain: selectable text, images, links, annotations. A PDF that went through GigaPDF's OCR keeps its invisible text layer in every file produced by the split.",
      },
    ],
    useCases: [
      "Pull the one certificate you need out of an administrative bundle before filing it",
      "Separate each fiscal year or each client from a global accounting export",
      "Isolate a single chapter of a thesis or course pack to hand out on its own",
    ],
    relatedTools: ["merge-pdf", "organize-pdf-pages", "compress-pdf"],
    relatedSolutions: ["accountants", "human-resources", "students"],
    icon: "scissors",
  },
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    metaTitle: "Compress PDF Online Free — Reduce File Size | GigaPDF",
    metaDescription:
      "Shrink heavy PDFs without wrecking them: MuPDF strips unused objects and linearizes for fast web viewing. Free and open source.",
    h1: "Compress a PDF: cut the weight without gutting the document",
    intro: [
      "An oversized PDF runs into walls all day long: mailboxes that cap attachments at 10 or 25 MB, government portals that reject large uploads, transfer links that time out halfway. Multi-page scans and image-stuffed exports are the usual offenders.",
      "GigaPDF leans on the MuPDF engine to compress intelligently: a garbage-collection pass removes unused objects, duplicated fonts, and orphaned streams that silently bloat files reworked by several tools, while linearization reorders the structure for progressive display in the browser — the first page shows up before the download finishes. The visible content is never degraded: the structural junk goes, your pages stay sharp.",
      "This approach pays off most on documents that have been through several editors, because they accumulate dead weight. Compression is part of the free plan and chains naturally with merging and splitting: assemble first, compress next, share the result by link.",
    ],
    howTo: {
      title: "How to compress a PDF file",
      steps: [
        "Upload the heavy PDF to your workspace.",
        "Start compression from the document's actions menu.",
        "The MuPDF engine cleans the structure: unused objects, duplicates, and orphaned streams are dropped.",
        "The file is linearized for progressive online viewing.",
        "Compare the new size with the original, then download or share the lighter version.",
      ],
    },
    capabilities: [
      "MuPDF garbage collection: unused objects, fonts, and streams removed",
      "Linearization for instant page-by-page display in the browser",
      "No degradation of vector text or page layouts",
      "Most effective on PDFs that were edited or assembled multiple times",
      "Chains with merge and split in the same session",
      "Original preserved: compression creates a version, history keeps the rest",
    ],
    faq: [
      {
        question: "How much smaller will my file get?",
        answer:
          "It depends on what's inside. PDFs that passed through several tools pile up dead objects and duplicate fonts: on those, the structural cleanup often claws back a substantial share of the weight. An already optimized scan, where nearly all the size is image data, will shrink less.",
      },
      {
        question: "Will compression make my text blurry?",
        answer:
          "No. GigaPDF works on the file's structure — unused objects, duplicates, stream organization — not by rasterizing your content. Vector text stays crisp at every zoom level and layouts are untouched.",
      },
      {
        question: "What does linearizing a PDF actually do?",
        answer:
          "A linearized PDF is reorganized so the first page renders as soon as the download starts, without waiting for the whole file. That matters for documents read online or shared by link: the recipient starts reading immediately, even on a slow connection.",
      },
      {
        question: "Can I compress several documents in a row?",
        answer:
          "Yes. Compression is available on every document in your workspace with no usage quota. The free plan's limits are storage (5 GB) and document count (100), not the number of operations you run.",
      },
    ],
    useCases: [
      "Get a scanned file under the attachment limit of a mailbox or government portal",
      "Slim down archived reports to save your team's storage space",
      "Prepare documents that load fast when viewed online through a share link",
    ],
    relatedTools: ["merge-pdf", "split-pdf", "ocr-pdf"],
    relatedSolutions: ["architects-construction", "nonprofits", "accountants"],
    icon: "file-archive",
  },
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    metaTitle: "Sign PDF with Digital Certificate (PKCS#7) | GigaPDF",
    metaDescription:
      "Sign PDFs with a real P12/PFX digital certificate: PKCS#7 signatures verifiable in Adobe Reader. Free, open source, self-hostable.",
    h1: "Sign a PDF with a digital certificate",
    intro: [
      "Two things get mixed up constantly: pasting an image of a signature onto a page, and digitally signing a document. The first guarantees nothing — anyone can copy the image. The second seals the file cryptographically: any later modification breaks the signature, and the recipient can verify exactly who signed.",
      "GigaPDF implements genuine digital signing to the PKCS#7 standard (the adbe.pkcs7.detached subfilter, the format Adobe Reader and conforming viewers recognize). You load your certificate as a P12/PFX file — issued by your certificate authority, your professional body, or your internal PKI — and GigaPDF computes the document's digest, encrypts it with your private key, and embeds the signature in the file. The recipient opens the PDF and sees at once whether the document is intact and who signed it.",
      "Certificate-based signing keeps you in charge of your own digital identity: the private key never leaves you, whereas proprietary platforms sign on their servers in your name. And because GigaPDF is open source and self-hostable, an organization can run its entire signing chain on its own infrastructure.",
    ],
    howTo: {
      title: "How to digitally sign a PDF",
      steps: [
        "Upload the document to sign to your workspace.",
        "Open the signing tool and load your P12/PFX certificate with its password.",
        "Place the signature field where you want it on the page.",
        "Confirm: GigaPDF computes the document digest and embeds the detached PKCS#7 signature.",
        "Download the signed PDF: its integrity can now be verified in any conforming viewer.",
      ],
    },
    capabilities: [
      "PKCS#7 digital signatures in the adbe.pkcs7.detached format",
      "P12/PFX certificate support (public CAs, professional bodies, internal PKI)",
      "Integrity check: any change after signing is detected",
      "Visible signature placed on the page of your choice",
      "Private key never handed to a third party: you sign with your own certificate",
      "Fully self-hostable chain for organizations under strict requirements",
    ],
    faq: [
      {
        question: "How is this different from a scanned signature image?",
        answer:
          "An image can be copied and protects nothing. A PKCS#7 digital signature cryptographically binds your identity to the exact content of the file: change a single comma after signing and verification fails, visibly, in the viewer. That is the foundation of a signature with evidentiary weight.",
      },
      {
        question: "Where do I get a P12/PFX certificate?",
        answer:
          "From a certificate authority (qualified providers issue certificates on tokens or as files), from your professional body — many bar associations and professional orders provide them — or from your company's internal PKI. The P12/PFX file holds your certificate and private key, protected by a password.",
      },
      {
        question: "Will Adobe Acrobat Reader recognize the signature?",
        answer:
          "Yes. GigaPDF uses the adbe.pkcs7.detached subfilter, the long-standing standard for PDF signatures. Adobe Reader shows its signature panel, checks the document's integrity, and displays the certification chain. Whether it shows 'valid' then depends on how much the reader trusts your certificate authority.",
      },
      {
        question: "Can several people sign the same document?",
        answer:
          "Yes, signatures stack: each signer adds theirs with their own certificate, and each signature covers the state of the document at the moment it was applied. Conforming viewers display the full signature history.",
      },
      {
        question: "What is this signature worth legally?",
        answer:
          "The level of recognition comes from the certificate, not from GigaPDF. In the EU, a qualified certificate from a trust service provider puts you in eIDAS territory for advanced or qualified signatures; other jurisdictions have comparable frameworks for certificate-based signing. GigaPDF supplies the standard mechanism; your certificate supplies the legal weight.",
      },
    ],
    useCases: [
      "Sign contracts and agreements with integrity proof the other party can verify",
      "Seal reports, certificates, or official deliverables before they go out",
      "Run an internal signing chain on a self-hosted instance",
    ],
    relatedTools: ["protect-pdf", "pdf-a", "pdf-forms", "edit-pdf"],
    relatedSolutions: ["lawyers", "human-resources", "real-estate"],
    icon: "file-signature",
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    metaTitle: "OCR PDF Online Free: Scan to Text | GigaPDF",
    metaDescription:
      "Run Tesseract OCR (English + French) on scanned PDFs: copy, search, and export the recognized text. Free and open source.",
    h1: "OCR: pull the text out of your scanned PDFs",
    intro: [
      "A scanned document is just a stack of page photographs: you can't search for a word, copy a paragraph, or pull out the figures. Until the text is recognized, the file stays mute for every tool you own — including your own document manager's search. Optical character recognition (OCR) turns those images into text you can actually use.",
      "GigaPDF ships with Tesseract, the reference open-source OCR engine, configured for English and French — accents, cedillas, and ligatures included, where many services trained on English alone mangle anything else. Processing runs server-side: you launch OCR on a document, the engine reads every page, and the recognized text comes back ready to copy, export, or index.",
      "OCR feeds the rest of the platform directly: once a document is recognized, full-text search finds it by its content, and the searchable-PDF tool can lay the text as an invisible layer under the original image. Everything works on the free plan — and on your own server if you self-host, which matters when the scans are confidential.",
    ],
    howTo: {
      title: "How to run OCR on a scanned PDF",
      steps: [
        "Upload your scanned PDF (or photos of documents saved as PDF) to GigaPDF.",
        "Launch OCR from the document's actions menu.",
        "Tesseract reads each page and recognizes the text in English and French.",
        "Grab the result: copy it directly, export it as TXT, or generate a searchable PDF.",
        "The document becomes findable by its content in your workspace's full-text search.",
      ],
    },
    capabilities: [
      "Tesseract engine with English and French models (eng+fra)",
      "Accurate handling of accented and special characters",
      "Page-by-page processing of multi-page documents",
      "Recognized text exported as TXT or embedded as an invisible searchable layer",
      "Recognized content indexed in the document manager's full-text search",
      "Runs on your own server when self-hosted: scans never leave your infrastructure",
    ],
    faq: [
      {
        question: "Which languages does GigaPDF's OCR recognize?",
        answer:
          "The Tesseract engine runs with the English and French models loaded together: a bilingual contract or an invoice mixing the two languages is handled in a single pass. Accented characters come through correctly.",
      },
      {
        question: "What scan quality do I need for good results?",
        answer:
          "Tesseract performs best on clean 300 dpi scans of printed text. Skewed pages, photocopies of photocopies, and tiny font sizes drag recognition down — when it matters, scan flat and at a decent resolution.",
      },
      {
        question: "Does OCR read handwriting?",
        answer:
          "No, and be wary of tools that promise otherwise: Tesseract is built for printed characters. A handwritten note on a form will usually go unrecognized even when the printed body of the document reads perfectly.",
      },
      {
        question: "What happens to the original document after OCR?",
        answer:
          "Nothing — it is not altered. OCR produces text you use however you like: copy it, export it, or build a searchable PDF where the recognized words sit in an invisible layer under the scan, keeping the exact original appearance.",
      },
    ],
    useCases: [
      "Make scanned invoices usable: amounts and reference numbers become copyable and searchable",
      "Digitize paper archives and find them later by content, not just by file name",
      "Extract the text of a contract received as a scan so you can quote or revise it",
    ],
    relatedTools: ["searchable-pdf", "compress-pdf", "pdf-to-word"],
    relatedSolutions: ["accountants", "lawyers", "healthcare"],
    icon: "scan-text",
  },
  {
    slug: "searchable-pdf",
    name: "Searchable PDF",
    metaTitle: "Make a Scanned PDF Searchable (OCR Layer) | GigaPDF",
    metaDescription:
      "Add an invisible OCR text layer to your scans: the PDF looks identical but becomes selectable and searchable. Free, open source.",
    h1: "Make a scanned PDF searchable without changing how it looks",
    intro: [
      "The technique is known as the 'sandwich PDF': the scanned image stays exactly as displayed, and the OCR-recognized text is inserted underneath in an invisible layer aligned word for word with the image. Visually nothing changes — the stamp, the handwritten signature, the original layout all stay put. But the document now answers Ctrl+F, the text selects with the mouse, and screen readers can speak it.",
      "GigaPDF builds that layer from Tesseract recognition (English and French): every recognized word is placed at the exact coordinates where it appears in the image, so a search highlights the right spot on the page and copy-paste follows the reading order. That is what separates it from a plain text export, which loses all connection to the page.",
      "For a document archive, this is the step that changes everything: a scanned collection becomes queryable in full text. Combined with GigaPDF's built-in search, it turns years of digitized paper into a base you can actually interrogate — in the cloud or on your own self-hosted server.",
    ],
    howTo: {
      title: "How to add a searchable layer to a scan",
      steps: [
        "Upload the scanned PDF to your workspace.",
        "Start the searchable-PDF conversion from the actions menu.",
        "Tesseract recognizes the text on every page (English + French).",
        "The text is embedded as an invisible layer, word by word, at the image's coordinates.",
        "Download the result: identical appearance, but selectable and searchable text everywhere.",
      ],
    },
    capabilities: [
      "Invisible text layer aligned with the original image (sandwich PDF)",
      "Document appearance strictly unchanged: visible stamps and signatures preserved",
      "Ctrl+F search working in every PDF viewer",
      "Text selection and copy-paste directly on the scan",
      "Tesseract recognition in English and French",
      "Automatic indexing in GigaPDF's full-text search",
    ],
    faq: [
      {
        question: "What's the difference between plain OCR and a searchable PDF?",
        answer:
          "Plain OCR pulls the text out of the document (clipboard, TXT file). A searchable PDF injects that text back into the document itself, as an invisible layer under the image: the file keeps its scanned look but behaves like a native PDF for search, selection, and accessibility.",
      },
      {
        question: "Does the invisible layer change how the document looks?",
        answer:
          "No, by construction: the text is inserted in invisible rendering mode, beneath the scanned image. On screen and in print, the document is identical to the original scan. Only the behavior changes: search finds, the mouse selects.",
      },
      {
        question: "Does search highlight the right place on the page?",
        answer:
          "Yes. Each word in the layer is positioned at the coordinates where Tesseract detected it in the image. When your viewer highlights a search hit, the highlight lands on the matching visible word — which makes long scanned documents genuinely navigable.",
      },
      {
        question: "Does this help with accessibility?",
        answer:
          "Yes. A raw scan is opaque to screen readers, which see only an image. With the text layer, the content can be read aloud and navigated. Quality tracks the recognition quality: a clean scan yields a faithful layer.",
      },
    ],
    useCases: [
      "Turn a digitized archive into a keyword-searchable document base",
      "Make scanned contracts searchable while keeping visible stamps and signatures intact",
      "Improve the accessibility of documents that were only ever distributed as scans",
    ],
    relatedTools: ["ocr-pdf", "compress-pdf", "pdf-a"],
    relatedSolutions: ["lawyers", "accountants", "architects-construction"],
    icon: "file-search",
  },
  {
    slug: "protect-pdf",
    name: "Protect PDF",
    metaTitle: "Password Protect PDF Online (AES-256) | GigaPDF",
    metaDescription:
      "Encrypt PDFs with AES-256, AES-128, or RC4 and control printing, copying, and editing. Free password protection, open source.",
    h1: "Protect a PDF with a password and encryption",
    intro: [
      "Emailing a payslip, a medical report, or a commercial offer means accepting that the file will travel beyond its intended reader: forwards, shared inboxes, attachments archived by third-party servers. Encrypting the PDF itself is the simplest counter — the document becomes unreadable without its password, wherever it ends up.",
      "GigaPDF encrypts files to the PDF standard with a choice of three algorithms: AES-256, today's recommended level; AES-128, broadly compatible; and RC4, kept only for the rare legacy viewers that demand it. You set an open password and, separately, an owner password tied to permissions: allow or block printing, text copying, content changes, and form filling.",
      "Keeping the two passwords distinct is genuinely useful: you can circulate a document anyone can read but nobody can modify, or one that is fully confidential. Protection applies in one click from your workspace, at no extra cost — like every GigaPDF feature, it's in the free plan and available when self-hosting.",
    ],
    howTo: {
      title: "How to password-protect a PDF",
      steps: [
        "Upload the document you want to protect.",
        "Open the protection tool and pick the algorithm — AES-256 recommended.",
        "Set the open password, to be sent to the recipient through a separate channel.",
        "Configure permissions: printing, copying, editing, form filling.",
        "Confirm and download the encrypted PDF: without the password, its content is unreadable.",
      ],
    },
    capabilities: [
      "AES-256, AES-128, or RC4 encryption depending on your compatibility constraints",
      "Open password (reading) separate from the owner password (permissions)",
      "Granular permissions: printing, text copying, modification, forms",
      "Remove protection from a file whose password you know",
      "One-click application from the document manager, nothing to install",
      "Complete chain operable on your own server when self-hosted",
    ],
    faq: [
      {
        question: "Which encryption algorithm should I pick?",
        answer:
          "AES-256 in nearly every case: it's the strongest standard the PDF format supports and every modern viewer handles it. AES-128 remains a safe pick if you target very old readers. RC4 is cryptographically obsolete and should only serve forced compatibility with ancient systems.",
      },
      {
        question: "What's the difference between the open password and the owner password?",
        answer:
          "The open password is required to read the document at all. The owner password governs rights: a file can open freely yet refuse printing or copying until that second password is supplied. Combine the two to match your confidentiality needs.",
      },
      {
        question: "Are the copy and print restrictions bulletproof?",
        answer:
          "No, and you should know it: PDF permissions are honored by conforming viewers, but a malicious tool can ignore them once the document opens. For real confidentiality, use the open password with AES-256: without it, the content is cryptographically unreadable.",
      },
      {
        question: "What if I forget the password of an AES-256 encrypted PDF?",
        answer:
          "There is no backdoor — that's exactly what makes the encryption worth using. Keep your passwords in a dedicated manager. If the original unencrypted file is still in your GigaPDF workspace, version history lets you retrieve it and encrypt again.",
      },
    ],
    useCases: [
      "Send payslips and HR documents encrypted, with the password traveling through another channel",
      "Distribute a study or quote that anyone can read but nobody can alter or copy",
      "Archive medical or legal documents AES-256 encrypted in the document manager",
    ],
    relatedTools: ["sign-pdf", "watermark-pdf", "pdf-a", "edit-pdf"],
    relatedSolutions: ["healthcare", "human-resources", "lawyers"],
    icon: "lock",
  },
  {
    slug: "watermark-pdf",
    name: "Watermark PDF",
    metaTitle: "Add a Watermark to PDF Online Free | GigaPDF",
    metaDescription:
      "Stamp a text or image watermark (CONFIDENTIAL, DRAFT, your logo) on every page of a PDF. Free, open source, no ads on your files.",
    h1: "Add a text or image watermark to a PDF",
    intro: [
      "An unmarked document travels without context: a working draft gets treated as final, a confidential study gets forwarded around, a quote gets reused by a competitor with your name stripped off. A watermark answers all three at once — it prints the document's status (DRAFT, CONFIDENTIAL, SPECIMEN) or your visual identity on every page, inseparably from the content.",
      "GigaPDF applies two kinds of watermark: text, with full control over wording, size, color, opacity, and angle (the classic translucent diagonal), or an image — typically your logo — positioned and dialed in to stay discreet without disappearing. The watermark is written into the page content during processing, not dropped on top as an annotation anyone can delete in two clicks from any viewer.",
      "One detail worth spelling out: GigaPDF never stamps its own advertising on your files, unlike plenty of so-called free tools. The watermarks are yours, applied when you decide — on the free plan and on a self-hosted instance alike.",
    ],
    howTo: {
      title: "How to watermark a PDF",
      steps: [
        "Upload the document you want to mark.",
        "Choose the watermark type: free text or an image such as your logo.",
        "Tune the appearance: position, size, opacity, rotation for the classic diagonal.",
        "Apply: the watermark is written onto every page of the document.",
        "Download or share the marked PDF; the original stays available in version history.",
      ],
    },
    capabilities: [
      "Text watermark: adjustable wording, font, size, color, opacity, and rotation",
      "Image watermark: logo or graphic stamp with measured opacity",
      "Applied to every page in a single operation",
      "Written into the page content — not a removable annotation",
      "No GigaPDF advertising ever added to your files",
      "Original kept safe through version history",
    ],
    faq: [
      {
        question: "Can the recipient remove the watermark?",
        answer:
          "GigaPDF writes the watermark into the page content, which makes it far tougher than an annotation that vanishes in two clicks. A determined, well-equipped user can always rework a PDF; for stronger guarantees, combine the watermark with AES encryption blocking modification and a digital signature that exposes any tampering.",
      },
      {
        question: "Can I use my logo without drowning the document's text?",
        answer:
          "Yes — opacity is finely adjustable. A logo at 10-15% opacity, centered or placed in the footer, brands the document without hurting readability on screen or in print. You preview the result before applying.",
      },
      {
        question: "Can I watermark several documents with the same settings?",
        answer:
          "Yes. Your settings (text, opacity, position) carry over from one document to the next, and the GigaPDF API — 1,000 calls per month included in the free plan — lets you automate systematic marking across a document pipeline.",
      },
      {
        question: "What's the difference between a watermark and a stamp?",
        answer:
          "A watermark applies uniformly to every page, as a translucent background or overlay: it qualifies the whole document. A stamp is a one-off annotation placed at a precise spot on one page — 'Approved', 'Received on…'. GigaPDF offers both: the watermark here, stamps through the annotation tool.",
      },
    ],
    useCases: [
      "Mark working versions DRAFT or CONFIDENTIAL before external review",
      "Put your firm's or agency's logo on every deliverable sent to clients",
      "Label sample documents SPECIMEN before circulating them for demos",
    ],
    relatedTools: ["protect-pdf", "annotate-pdf", "edit-pdf"],
    relatedSolutions: ["freelancers", "teachers-trainers", "real-estate"],
    icon: "stamp",
  },
  {
    slug: "organize-pdf-pages",
    name: "Organize Pages",
    metaTitle: "Organize PDF Pages: Reorder & Rotate Free | GigaPDF",
    metaDescription:
      "Reorder, rotate, delete, or extract PDF pages by dragging thumbnails. Free, open source, and self-hostable.",
    h1: "Organize PDF pages: reorder, rotate, delete",
    intro: [
      "Duplex scans that interleave pages out of order, sheets fed upside down through the document feeder, page 12 sitting where page 3 should be: putting a PDF back in order is one of the most ordinary jobs there is — and one of the most painful when the tool makes you type page numbers blind.",
      "GigaPDF lays the document out as a board of thumbnails: every page is visible, grabbable, and movable by drag and drop. Rotation is fixed per page or in batch (90°, 180°, 270°), blank or useless pages disappear with a click, and any selection can be extracted into a new file without leaving the screen. The engine applies all changes in one pass, without recompressing page content.",
      "Each reorganization creates a new version in the document's history, so a wrong move is undone by restoring the previous state. This visual workflow, alongside merge and split, covers the whole cycle of preparing a file — assemble, order, prune — from the browser, at no cost.",
    ],
    howTo: {
      title: "How to reorder the pages of a PDF",
      steps: [
        "Open your document in GigaPDF and switch to the thumbnail view.",
        "Drag and drop pages to fix the document's order.",
        "Select the pages to rotate and apply 90°, 180°, or 270°.",
        "Remove blank or off-topic pages with one click.",
        "Save: the changes apply in a single pass and the previous version stays restorable.",
      ],
    },
    capabilities: [
      "Drag-and-drop reordering on the thumbnail board",
      "Rotation per page or in batch: 90°, 180°, 270°",
      "Page deletion and extraction of a selection into a new file",
      "All changes applied in one pass, no content recompression",
      "Version history: every reorganization is reversible",
      "Direct hand-off to merge, split, and compression",
    ],
    faq: [
      {
        question: "How do I fix a duplex scan with interleaved pages?",
        answer:
          "This is the textbook case for the thumbnail view: you spot the actual sequence at a glance (1, 3, 5… then 2, 4, 6…) and drag the pages back into place. On a long document, extracting the even pages and re-merging in order can be even faster — both tools chain together in GigaPDF.",
      },
      {
        question: "Is the rotation saved permanently in the file?",
        answer:
          "Yes. Rotation applied in GigaPDF is written into the PDF itself: the document opens the right way up in every viewer, on screen and in print — unlike the temporary display rotation some readers offer.",
      },
      {
        question: "Can I undo a reorganization after saving it?",
        answer:
          "Yes. Every save creates a version in the document's history. You can browse earlier states and restore the one before the mishap, which makes the operation risk-free even on an important file.",
      },
      {
        question: "What happens to deleted pages?",
        answer:
          "They leave the current version of the document but remain inside earlier versions in the history. And if you delete an entire document by mistake, the trash keeps it for 30 days before permanent removal.",
      },
    ],
    useCases: [
      "Put a scan back in order when its pages came out shuffled or upside down",
      "Tidy a file before sending: drop blank pages, duplicates, and drafts",
      "Rebuild a document from several sources, then order it visually",
    ],
    relatedTools: ["merge-pdf", "split-pdf", "edit-pdf"],
    relatedSolutions: ["real-estate", "accountants", "human-resources"],
    icon: "layout-grid",
  },
  {
    slug: "annotate-pdf",
    name: "Annotate PDF",
    metaTitle: "Annotate PDF Online: Highlight & Comment | GigaPDF",
    metaDescription:
      "Highlight, comment, and draw on PDFs with native annotations readable in any viewer. Free, open source, with real-time collaboration.",
    h1: "Annotate a PDF: highlight, comment, draw",
    intro: [
      "Reviewing a contract, marking up a thesis, commenting on a mockup: working on a document is mostly working in the margins. Printing to annotate by hand, then rescanning, throws away searchable text and image quality; commenting in a separate email cuts the remarks off from their context. Annotating directly in the PDF keeps every comment exactly where it belongs.",
      "GigaPDF writes native annotations to the PDF standard: highlights, notes, free text, shapes, and freehand strokes are saved as conforming annotation objects, never flattened into an image. In practice, your marks remain visible and listed in Adobe Reader, in macOS Preview, in a browser — and the recipient can answer with their own tool, whether or not they use GigaPDF.",
      "Real-time collaboration adds the team dimension: several reviewers annotate the same document at once and watch each other's marks appear live. With link sharing and version history from the document manager, the whole review cycle happens in one place, with zero attachments.",
    ],
    howTo: {
      title: "How to annotate a PDF document",
      steps: [
        "Open the PDF in the GigaPDF editor.",
        "Highlight the key passages by selecting the text.",
        "Add notes and comments wherever something needs saying.",
        "Draw when words aren't enough: arrows, boxes, and freehand strokes to point at a visual detail.",
        "Share the document by link: your annotations show in every viewer, and the team can annotate live together.",
      ],
    },
    capabilities: [
      "Text highlighting with a choice of colors",
      "Notes and comments pinned to the exact spot they concern",
      "Free text, shapes, and freehand drawing on the page",
      "Native standard-PDF annotations, readable in every viewer",
      "Live multi-user annotation on the same file",
      "Link or email sharing and built-in version history",
    ],
    faq: [
      {
        question: "Will my annotations show up in Adobe Reader?",
        answer:
          "Yes. GigaPDF saves native annotations that conform to the PDF standard: Adobe Reader, macOS Preview, browsers, and other viewers display them and list them in their comments panel. Nothing is proprietary or locked into the platform.",
      },
      {
        question: "Can several people annotate at the same time?",
        answer:
          "Yes, it's one of GigaPDF's strong points: real-time collaboration lets several reviewers open the same document and watch each other's annotations appear live, with no version conflicts and no manual merging of comments.",
      },
      {
        question: "What's the difference between annotating and editing a PDF?",
        answer:
          "Annotation sits on top of the content without altering it: it's the review layer, listable and attributable. Editing changes the content itself — fixing the text, swapping an image. GigaPDF does both in the same editor, but the distinction matters: you annotate a proposal, you edit your own document.",
      },
      {
        question: "Can I lock annotations so they can no longer be changed?",
        answer:
          "Yes, that's what flattening is for, available in GigaPDF's forms tool: it fuses annotations into the page content. They stay visible but stop being separate editable objects — useful before archiving or final distribution.",
      },
    ],
    useCases: [
      "Review a contract as a team, highlighting the clauses to renegotiate",
      "Grade papers or theses with margin notes, without printing a single page",
      "Comment on an inspection report or a floor plan directly on the reference document",
    ],
    relatedTools: ["edit-pdf", "watermark-pdf", "pdf-forms"],
    relatedSolutions: ["students", "teachers-trainers", "architects-construction"],
    icon: "highlighter",
  },
  {
    slug: "pdf-forms",
    name: "PDF Forms",
    metaTitle: "Fill Out PDF Forms Online Free | GigaPDF",
    metaDescription:
      "Fill out PDF form fields in your browser and flatten the result to lock in your answers. Free and open source.",
    h1: "Fill out and flatten PDF forms",
    intro: [
      "Interactive PDF forms — AcroForm fields with text boxes, checkboxes, and dropdowns — are everywhere in administrative life: official applications, registration forms, onboarding paperwork. You still need a tool that fills them properly: plenty of free viewers display the fields but lose your entries on save, or push you back to print-and-rescan.",
      "GigaPDF reads the form's structure, presents every field for input in the browser, and writes the values into the file according to the standard. Then comes the third operation, often the decisive one: flattening. It fuses the filled fields into the page content — your answers become permanent material that can't be changed with a casual click in the field. That step is what separates a form draft from a document ready to submit.",
      "For organizations, reading fields through the API opens up automation: extract the values from incoming forms without retyping anything. The free plan covers filling, flattening, and 1,000 API calls a month; self-hosting keeps sensitive forms on your own infrastructure.",
    ],
    howTo: {
      title: "How to fill out a PDF form",
      steps: [
        "Upload the PDF form to your workspace.",
        "Open it: interactive fields (text, checkboxes, lists) are detected automatically.",
        "Type your answers directly in the browser.",
        "Save the values into the file, or flatten the form to lock the answers in for good.",
        "Download, share by link, or add a digital signature to the completed document.",
      ],
    },
    capabilities: [
      "Detection and reading of form fields (AcroForm)",
      "In-browser filling: text, checkboxes, dropdowns",
      "Values saved in conformance with the PDF standard",
      "Flattening: answers fused into the page, no longer editable",
      "Field values extracted through the API for automated processing",
      "Natural hand-off to PKCS#7 digital signing",
    ],
    faq: [
      {
        question: "Why flatten a form after filling it?",
        answer:
          "As long as the fields stay interactive, any recipient can change your answers with one click. Flattening turns the entered values into permanent page content: the document freezes exactly as you completed it. It's the right move before official submission or archiving.",
      },
      {
        question: "What about a non-interactive form — a scanned page with blank lines?",
        answer:
          "Without AcroForm fields there is nothing for form filling to grab — but the GigaPDF editor takes over: drop text boxes over the document's lines, position them precisely, and save. The result is equivalent to a completed form.",
      },
      {
        question: "Are dropdowns and checkboxes handled?",
        answer:
          "Yes. GigaPDF reads the field types defined by the standard: text boxes, checkboxes, radio buttons, and lists. Each one behaves in the browser like a web form control, and the value is written into the file on save.",
      },
      {
        question: "Can I collect the answers from forms people send me, automatically?",
        answer:
          "Yes, through the API: field reading returns the entered values in structured form, which kills the retyping when you receive dozens of identical forms. The free plan includes 1,000 API calls a month — enough to automate a steady flow.",
      },
    ],
    useCases: [
      "Complete administrative or onboarding paperwork without a printer or scanner",
      "Flatten a form's answers before an official submission",
      "Collect filled forms and extract their values automatically over the API",
    ],
    relatedTools: ["sign-pdf", "edit-pdf", "annotate-pdf"],
    relatedSolutions: ["human-resources", "nonprofits", "real-estate"],
    icon: "clipboard-list",
  },
  {
    slug: "pdf-to-word",
    name: "PDF to Word",
    metaTitle: "Convert PDF to Word (DOCX) Online Free | GigaPDF",
    metaDescription:
      "Turn PDFs into editable Word documents (.docx) with layout preserved. Free conversion, open source, no watermark.",
    h1: "Convert a PDF into an editable Word document",
    intro: [
      "PDF freezes, Word frees: when a document needs a full rework — restructuring a report, reusing the clauses of a template contract, starting from an existing outline — spot edits stop being enough and you need a word-processor file again. PDF-to-DOCX conversion rebuilds the document in a format where every element becomes workable.",
      "GigaPDF analyzes the PDF's structure — text blocks, paragraphs, images, tables — and produces a .docx that opens in Word, LibreOffice, or Google Docs. Faithful conversion takes real reconstruction work: keeping paragraphs flowing instead of spitting out one text box per line, leaving images where they belong, returning tables as tables. That is what the conversion engine aims for, running server-side.",
      "One case deserves a callout: scanned PDFs. With no digital text, there is nothing to convert — run the document through GigaPDF's OCR first (English + French), then convert. The scan → OCR → DOCX chain turns digitized paper into a workable Word file, all inside the same platform, free of charge.",
    ],
    howTo: {
      title: "How to convert a PDF to Word",
      steps: [
        "Upload the PDF you want to convert.",
        "If it's a scan, run OCR first to recognize the text.",
        "Pick the DOCX export in the conversion menu.",
        "The engine rebuilds paragraphs, images, and tables into the Word file.",
        "Download the .docx and open it in Word, LibreOffice, or Google Docs.",
      ],
    },
    capabilities: [
      "DOCX export compatible with Word, LibreOffice, and Google Docs",
      "Reconstruction of paragraphs, images, and tables",
      "Server-side conversion, no local install",
      "Scan → OCR → DOCX chain for digitized documents",
      "No watermark on the converted file",
      "More exports from the same menu: ODT, TXT, HTML, PNG, JPEG",
    ],
    faq: [
      {
        question: "Will the layout match the original exactly?",
        answer:
          "The goal is maximum fidelity, but let's be honest: PDF and DOCX describe documents differently, and heavily designed layouts (nested columns, text over images, design brochures) may need touch-ups after conversion. Standard text documents — reports, contracts, letters — convert very cleanly.",
      },
      {
        question: "Can I convert a scanned PDF to Word?",
        answer:
          "Yes, in two steps: OCR first, conversion second. A scan contains nothing but images; GigaPDF's Tesseract OCR extracts the text (English and French), which then feeds the DOCX conversion. Skip that step and the Word file would hold only page images.",
      },
      {
        question: "Do the PDF's tables stay tables in Word?",
        answer:
          "Detected tabular structures come back as Word tables, editable cell by cell. Very intricate tables — cascading merged cells, tables drawn without real structure — may be partially simplified; a quick visual check after conversion is wise on those.",
      },
      {
        question: "Is there a size limit or a watermark on the free conversion?",
        answer:
          "No watermark, ever. Conversion is a full feature of the free plan, whose limits are storage (5 GB) and document count (100) — never a degraded output. The file you get is yours, clean.",
      },
    ],
    useCases: [
      "Recover a contract or report whose source file is long gone",
      "Reuse the content of a PDF manual in a new Word deliverable",
      "Turn scanned letters into editable documents via OCR plus conversion",
    ],
    relatedTools: ["word-to-pdf", "ocr-pdf", "pdf-to-odt"],
    relatedSolutions: ["freelancers", "students", "lawyers"],
    icon: "file-text",
  },
  {
    slug: "word-to-pdf",
    name: "Word to PDF",
    metaTitle: "Convert Word to PDF Online (.doc, .docx) | GigaPDF",
    metaDescription:
      "Convert Word documents to faithful PDFs with LibreOffice: modern .docx and legacy .doc. Free, open source, no watermark.",
    h1: "Convert a Word document to PDF",
    intro: [
      "Sending a .docx means sending a living document: it will render differently depending on the recipient's Word version, installed fonts, and machine — when it isn't simply modified along the way. Converting to PDF locks the layout: what you composed is exactly what gets read and printed, everywhere.",
      "GigaPDF converts with LibreOffice running server-side, the most battle-tested open-source office conversion engine there is. It handles modern .docx as well as the old binary .doc — the Word 97-2003 format that haunts every file server and that many online converters turn away. Styles, tables, images, headers, and footers come out in a clean PDF with no advertising stamped on it.",
      "You need neither Microsoft Office nor any installation: the browser is enough. The resulting PDF lands straight in your GigaPDF document manager, where it can be merged with other files, digitally signed, encrypted, or archived as PDF/A — conversion is just the first link in a complete document chain.",
    ],
    howTo: {
      title: "How to convert a Word file to PDF",
      steps: [
        "Upload your .docx or .doc file to your workspace.",
        "Run the conversion: LibreOffice renders the document server-side.",
        "Check the resulting PDF in the built-in viewer.",
        "Chain the next step if needed: merging, signing, encryption, or watermarking.",
        "Download the PDF or share it by link straight from the document manager.",
      ],
    },
    capabilities: [
      "Conversion of .docx and legacy .doc (Word 97-2003)",
      "LibreOffice engine server-side: no install, no Microsoft Office required",
      "Faithful rendering of styles, tables, images, headers, and footers",
      "No watermark on the output PDF",
      "Immediate chaining: merge, digital signature, encryption, PDF/A",
      "Other office formats accepted by the same flow: Excel, PowerPoint, OpenDocument",
    ],
    faq: [
      {
        question: "Are old .doc files really supported?",
        answer:
          "Yes, and it's a genuinely useful trait of GigaPDF: LibreOffice reads the binary Word 97-2003 format alongside modern .docx. Old office archives convert without a manual round-trip through Word — valuable when cleaning up a document backlog.",
      },
      {
        question: "Will my document's layout be respected?",
        answer:
          "LibreOffice renders the vast majority of documents faithfully: styles, tables, anchored images, headers, footers, and numbering. Documents relying on proprietary fonts that aren't embedded, or on display macros, can drift slightly; a glance at the PDF in the built-in viewer settles it.",
      },
      {
        question: "Can I convert several Word documents in a row?",
        answer:
          "Yes. Upload your files in batches and convert them one after the other; through the API, the operation automates for recurring flows (1,000 calls a month included free). Every PDF produced is filed in your document manager, taggable and searchable.",
      },
      {
        question: "Can the resulting PDF still be edited?",
        answer:
          "Yes, twice over: you keep the original Word file in your workspace, and the PDF itself stays editable in GigaPDF's WYSIWYG editor for spot fixes — correcting a date, removing a mention — without regenerating the whole document.",
      },
    ],
    useCases: [
      "Freeze a CV, quote, or contract before sending, identical on every screen",
      "Batch-convert old .doc archives into readable PDFs",
      "Prepare Word documents for digital signing: convert, then PKCS#7 in one flow",
    ],
    relatedTools: ["pdf-to-word", "excel-to-pdf", "powerpoint-to-pdf", "sign-pdf"],
    relatedSolutions: ["freelancers", "human-resources", "nonprofits"],
    icon: "file-input",
  },
  {
    slug: "excel-to-pdf",
    name: "Excel to PDF",
    metaTitle: "Convert Excel to PDF Online (.xls, .xlsx) | GigaPDF",
    metaDescription:
      "Turn Excel workbooks into clean, printable PDFs with LibreOffice: .xlsx and legacy .xls. Free, open source conversion.",
    h1: "Convert an Excel workbook to PDF",
    intro: [
      "A spreadsheet sent as .xlsx is a liability: formulas on display, forgotten working tabs, hidden columns one click away from being revealed, and a layout that explodes when the recipient hits print. To communicate numbers — a quote, a dashboard, a budget — a PDF shows the result, only the result, framed exactly as intended.",
      "GigaPDF converts your workbooks with LibreOffice on the server: both .xlsx and the legacy .xls (Excel 97-2003) are accepted, computed values stand in for the formulas, and the print area defined in the workbook drives the PDF's pagination. Borders, cell colors, charts, and number formats come out the way the spreadsheet displays them.",
      "A tip inherited from print: the PDF's quality is decided inside the workbook, before converting. A defined print area, landscape orientation for wide tables, and a fit-to-one-page-wide setting produce a sharp final document. Once converted, the PDF merges with your other files, takes a password, or gets watermarked — all without leaving GigaPDF, for free.",
    ],
    howTo: {
      title: "How to convert an Excel file to PDF",
      steps: [
        "Prepare the workbook: print area and orientation set in your spreadsheet app.",
        "Upload the .xlsx or .xls file to your workspace.",
        "Run the conversion: LibreOffice computes the rendering and paginates the document.",
        "Inspect the PDF in the viewer: column breaks, legibility of the figures.",
        "Download, merge with other files, or share the PDF by link.",
      ],
    },
    capabilities: [
      "Conversion of .xlsx and legacy .xls (Excel 97-2003)",
      "Computed values in the PDF: formulas are never exposed",
      "Print areas and orientation from the workbook are honored",
      "Borders, colors, charts, and number formats rendered as displayed",
      "OpenDocument spreadsheets (.ods) handled by the same engine",
      "Merge, protect, and watermark the resulting PDF on the same platform",
    ],
    faq: [
      {
        question: "How do I keep a wide table from being chopped across pages?",
        answer:
          "Fix it in the workbook before converting: landscape orientation and a fit-to-one-page-wide setting in your spreadsheet's page layout options. LibreOffice applies those settings during conversion; a table with no layout defined gets default pagination, breaks included.",
      },
      {
        question: "Do my workbook's formulas appear in the PDF?",
        answer:
          "No, and that's one of the main reasons to convert: the PDF carries the computed values, not the formulas. Your calculation methods, working assumptions, and cell references stay in the source file, which stays with you.",
      },
      {
        question: "Are all the workbook's sheets converted?",
        answer:
          "Conversion follows the workbook's print configuration. To publish a single summary tab, set it as the print area before uploading — or delete the surplus pages from the PDF afterwards with GigaPDF's page-organization tool.",
      },
      {
        question: "Are Excel charts preserved?",
        answer:
          "Yes, charts render in the PDF exactly as they appear in the workbook. They become fixed graphics, which is the point — the recipient sees the curve, not the underlying data or the hidden series.",
      },
    ],
    useCases: [
      "Send a quote or budget without exposing formulas and pricing assumptions",
      "Freeze a monthly dashboard as a PDF for distribution and archiving",
      "Attach cleanly paginated financial annexes to a merged report",
    ],
    relatedTools: ["word-to-pdf", "powerpoint-to-pdf", "merge-pdf"],
    relatedSolutions: ["accountants", "freelancers", "nonprofits"],
    icon: "file-spreadsheet",
  },
  {
    slug: "powerpoint-to-pdf",
    name: "PowerPoint to PDF",
    metaTitle: "Convert PowerPoint to PDF (.ppt, .pptx) | GigaPDF",
    metaDescription:
      "Convert PowerPoint decks to faithful PDFs with LibreOffice: .pptx and legacy .ppt. Free, open source, no watermark.",
    h1: "Convert a PowerPoint presentation to PDF",
    intro: [
      "A deck sent as .pptx rarely arrives intact: substituted fonts, animations that make no sense at a standstill, slides shifting between PowerPoint versions — and a file anyone can edit. The deck that circulates after the meeting deserves better: a PDF where every slide is fixed exactly as you designed it.",
      "GigaPDF relies on LibreOffice server-side to convert .pptx as well as the older .ppt (PowerPoint 97-2003). Each slide becomes one PDF page: backgrounds, images, diagrams, and text blocks land at their exact positions. Animations and transitions, which belong to slideshow mode, are naturally absent from the fixed output — each slide is rendered in its final state.",
      "The resulting PDF is lighter to distribute than an image-heavy .pptx, opens on any device without PowerPoint, and prints properly. Need the reverse trip? GigaPDF also exports PDF to PPTX, handy for reviving an old deck whose source file vanished — both directions ship with the free plan.",
    ],
    howTo: {
      title: "How to convert a PowerPoint to PDF",
      steps: [
        "Upload your .pptx or .ppt presentation to your workspace.",
        "Run the conversion: LibreOffice renders each slide as a PDF page.",
        "Review the output in the viewer: fonts, images, and diagrams in place.",
        "Add a watermark or protection if the deck needs it before going out.",
        "Download the PDF or share it by link, readable without PowerPoint.",
      ],
    },
    capabilities: [
      "Conversion of .pptx and legacy .ppt (PowerPoint 97-2003)",
      "One slide = one PDF page, at the exact layout",
      "Backgrounds, images, diagrams, and text boxes rendered in place",
      "Reverse conversion available: export a PDF to PPTX",
      "OpenDocument presentations (.odp) handled by the same engine",
      "Watermark, protection, and link sharing on the same platform",
    ],
    faq: [
      {
        question: "What happens to my presentation's animations and transitions?",
        answer:
          "They go away, by nature: a PDF is a fixed medium with no slideshow mode. Each slide is rendered in its final state, all elements visible. If a slide reveals blocks progressively, check that their final stacking stays readable once frozen.",
      },
      {
        question: "Will my deck's special fonts be respected?",
        answer:
          "Embedded and standard fonts render faithfully. An exotic font missing on the conversion engine gets swapped for the closest match — just as PowerPoint would on a machine lacking it. A few seconds in the preview viewer is enough to confirm.",
      },
      {
        question: "Can I convert a PDF into PowerPoint, the other way around?",
        answer:
          "Yes. GigaPDF offers PDF-to-PPTX export: each page becomes a slide again, texts and images included, editable in PowerPoint or LibreOffice Impress. It's the way out when a deck's source file is lost and the content has to evolve.",
      },
      {
        question: "Is the PDF lighter than the original presentation?",
        answer:
          "Often, yes: the PDF carries no animations, no unused media, no stacks of slide masters. And if the output is still heavy — photo-rich decks — GigaPDF's MuPDF compression takes another pass at it.",
      },
    ],
    useCases: [
      "Hand out the deck after a training session or talk, fixed and readable anywhere",
      "Archive client presentations as searchable, versioned PDFs in the document manager",
      "Print a slide set cleanly for a meeting without a projector",
    ],
    relatedTools: ["word-to-pdf", "excel-to-pdf", "compress-pdf", "watermark-pdf"],
    relatedSolutions: ["teachers-trainers", "freelancers", "nonprofits"],
    icon: "presentation",
  },
  {
    slug: "opendocument-pdf",
    name: "OpenDocument & PDF",
    metaTitle: "Convert OpenDocument to PDF (ODT, ODS, ODP) | GigaPDF",
    metaDescription:
      "Convert ODT, ODS, and ODP to PDF — and go back from PDF to ODT or ODP. The LibreOffice-to-PDF bridge, free and open source.",
    h1: "OpenDocument to PDF and back: ODT, ODS, ODP",
    intro: [
      "Public administrations and organizations committed to free software work in OpenDocument: .odt texts, .ods spreadsheets, .odp presentations. An open, ISO-standardized format — but a minority one next to the Microsoft ecosystem, which complicates exchanges: recipients don't always have LibreOffice, and most online converters flatly ignore these formats.",
      "GigaPDF treats them as first-class citizens, for a structural reason: its conversion engine is LibreOffice itself, running server-side. All three formats convert to PDF with the fidelity of the native application — styles, tables, charts, and layouts rendered without the approximations of a third-party converter. The return trip exists too: a PDF exports to ODT to rework the text, or to ODP to pick a presentation back up, closing the loop with your free-software office suite.",
      "That open-source consistency runs the full length of the chain: GigaPDF is published under the AGPL and self-hosts. An organization that chose free software for its office suite can make the same choice for its document platform — conversion, editing, signing, and document management included, with no proprietary service in the loop.",
    ],
    howTo: {
      title: "How to convert between OpenDocument and PDF",
      steps: [
        "Upload your .odt, .ods, or .odp file to your workspace.",
        "Run the PDF conversion: server-side LibreOffice renders the document as-is.",
        "Check the output in the built-in viewer.",
        "For the reverse direction, open a PDF and export it as ODT (text) or ODP (slides).",
        "File, share, or sign the result directly in the document manager.",
      ],
    },
    capabilities: [
      "PDF conversion of .odt texts, .ods spreadsheets, and .odp presentations",
      "Native LibreOffice engine server-side: maximum OpenDocument fidelity",
      "Reverse export from PDF to ODT and ODP to rework content",
      "Spreadsheets: PDF data exported to XLSX, usable in LibreOffice Calc",
      "No watermark; conversion included in the free plan",
      "AGPL platform you can self-host: a free-software document chain end to end",
    ],
    faq: [
      {
        question: "Why is OpenDocument conversion more reliable here than elsewhere?",
        answer:
          "Because GigaPDF converts with LibreOffice itself — the reference application for the OpenDocument format — running on the server. Where other services go through approximate reinterpretation libraries (when they accept these formats at all), GigaPDF uses the native rendering: what LibreOffice displays is what the PDF contains.",
      },
      {
        question: "Can I convert a PDF back into an editable OpenDocument file?",
        answer:
          "Yes for texts and presentations: the ODT export rebuilds an editable text document and the ODP export produces slides you can pick up in Impress. For tabular data inside a PDF, the export goes to XLSX, which LibreOffice Calc opens and re-saves as .ods natively.",
      },
      {
        question: "Do .ods files with charts and formulas come out right?",
        answer:
          "Yes: spreadsheets convert with their computed values, cell formats, and charts, following the defined print area. As with Excel, the formulas stay in the source file — the PDF shows results, not the machinery.",
      },
      {
        question: "Is GigaPDF a fit for an administration under sovereignty constraints?",
        answer:
          "It's one of its natural habitats: auditable AGPL source code, full self-hosting on your servers, open formats in and out. No document ever needs to pass through a third-party cloud, and no proprietary license enters the chain.",
      },
    ],
    useCases: [
      "Publish LibreOffice documents as PDFs for recipients without the suite",
      "Recover as ODT a PDF whose source file is gone, without detouring through Word",
      "Equip a fully free-software organization: LibreOffice plus self-hosted GigaPDF",
    ],
    relatedTools: ["pdf-to-odt", "word-to-pdf", "pdf-a"],
    relatedSolutions: ["nonprofits", "students", "healthcare"],
    icon: "file-stack",
  },
  {
    slug: "pdf-to-odt",
    name: "PDF to ODT",
    metaTitle: "Convert PDF to ODT (LibreOffice Writer) | GigaPDF",
    metaDescription:
      "Turn a PDF into an editable ODT for LibreOffice Writer, text and images carried over. Free, open source conversion.",
    h1: "Convert a PDF to ODT, editable in LibreOffice Writer",
    intro: [
      "If you work in LibreOffice, converting a PDF to .docx is an absurd detour: you then have to import the Word file into Writer, adding another conversion layer and its inevitable drift. GigaPDF gives you the straight path: PDF to ODT, Writer's native format, in one transformation.",
      "The engine analyzes the PDF — paragraphs, images, page structure — and rebuilds an OpenDocument text file: the text becomes editable paragraphs with their attributes, images return to their place, and the file opens in Writer like any other .odt, ready to be restyled with your templates. For scanned PDFs, the built-in Tesseract OCR (English + French) supplies the text first; the conversion does the rest.",
      "The choice of format is not cosmetic: ODT is an open ISO standard (ISO 26300), readable today and in twenty years, with no vendor dependency. GigaPDF — open source, self-hostable, watermark-free — is the logical companion: your documents move from the frozen format back to the free one, with free tools.",
    ],
    howTo: {
      title: "How to convert a PDF to ODT",
      steps: [
        "Upload the PDF to your workspace.",
        "If it's a scanned document, apply OCR first to recognize the text.",
        "Pick the ODT export in the conversion menu.",
        "The engine rebuilds paragraphs and images into an OpenDocument file.",
        "Open the .odt in LibreOffice Writer and pick up the writing.",
      ],
    },
    capabilities: [
      "Native ODT export, no detour through the Word format",
      "Rebuilt editable paragraphs and carried-over images",
      "Scan → Tesseract OCR → ODT chain for digitized documents",
      "OpenDocument-conformant file, opened by Writer and any compatible editor",
      "No watermark on the converted document",
      "Other exports in the same spot: DOCX, ODP, TXT, HTML",
    ],
    faq: [
      {
        question: "Why convert straight to ODT instead of DOCX then opening in Writer?",
        answer:
          "Every format conversion brings its own approximations. Going through DOCX stacks a second one on top: PDF to DOCX, then DOCX into Writer's internal model. GigaPDF's direct ODT export performs just one, into the format Writer speaks natively — less drift, less rework.",
      },
      {
        question: "Does the converted document keep its formatting?",
        answer:
          "The text returns with its essential attributes — size, weight, alignment — and the images at their positions. As with any conversion out of PDF, a very graphic document may need touch-ups in Writer; a report, a letter, or a contract usually picks up straight away.",
      },
      {
        question: "Can I convert a scan to ODT?",
        answer:
          "Yes, by chaining two GigaPDF tools: OCR first, which recognizes the scan's text in English and French, then the ODT export, which structures it into a Writer document. Without the OCR step, a scan has no text to convert.",
      },
      {
        question: "Is the resulting ODT file standard?",
        answer:
          "Yes: it's a conformant OpenDocument file, readable by LibreOffice, OpenOffice, and any software honoring the ISO 26300 standard — including Word, which opens .odt files. You're locked into neither GigaPDF nor any vendor.",
      },
    ],
    useCases: [
      "Pick up in Writer an official document that was only published as a PDF",
      "Bring old PDF deliverables back into a LibreOffice editorial pipeline",
      "Convert scanned letters into reworkable ODT files through the built-in OCR",
    ],
    relatedTools: ["opendocument-pdf", "pdf-to-word", "ocr-pdf"],
    relatedSolutions: ["nonprofits", "students", "lawyers"],
    icon: "file-output",
  },
  {
    slug: "html-to-pdf",
    name: "HTML to PDF",
    metaTitle: "Convert HTML or a Web Page to PDF | GigaPDF",
    metaDescription:
      "Convert HTML or a URL to PDF rendered by Chromium: modern CSS, web fonts, long pages. Free, open source, with an API.",
    h1: "Convert HTML or a web page to PDF",
    intro: [
      "The web has become the source of most documents: invoices generated by applications, order confirmations, articles, reports produced by internal tools. Freezing them as PDFs — to archive, to prove, to send — demands an exact rendering. Modern HTML (flexbox, grid, web fonts, JavaScript-injected content) is far beyond what lightweight conversion libraries can reproduce.",
      "GigaPDF attacks the problem from the right end: rendering is handled by Chromium, the engine inside Chrome, driven server-side. You supply HTML code or simply a URL; the page is loaded, styles applied, web fonts fetched, and the document is printed to PDF exactly as the browser would do it. What you see online is what the file contains.",
      "It's also a first-rate automation tool: through the GigaPDF API (1,000 calls a month in the free plan), your applications generate their invoices, certificates, and reports by sending HTML — the most universal templating language there is — and get back PDFs ready to archive in the document manager. Self-hosted, the whole chain runs on your servers.",
    ],
    howTo: {
      title: "How to convert a web page to PDF",
      steps: [
        "Provide the source: a public URL or your complete HTML code.",
        "Chromium loads the page server-side: CSS, web fonts, and layout applied.",
        "The rendering is printed to PDF, faithful to the browser display.",
        "Collect the document in your workspace, ready to file or share.",
        "To automate, call the same conversion from your applications over the API.",
      ],
    },
    capabilities: [
      "Chromium rendering: a real browser engine, not an approximation",
      "Conversion from a URL or from supplied HTML code",
      "Modern CSS support (flexbox, grid) and web fonts",
      "Automated generation over the API: invoices, certificates, reports",
      "PDF filed straight into the document manager: folders, tags, search, sharing",
      "Runs entirely on your servers when self-hosted",
    ],
    faq: [
      {
        question: "Why does Chromium rendering make the difference?",
        answer:
          "Because lightweight HTML converters implement a dated subset of CSS: flexbox and grid layouts collapse, web fonts go missing, JavaScript never runs. Chromium is the engine that displays the actual web — the PDF matches what Chrome shows, pixel for pixel.",
      },
      {
        question: "Can I generate my invoices as PDFs automatically?",
        answer:
          "Yes, it's the textbook use case: your application builds the invoice in HTML (a template with your styles), posts it to the GigaPDF API, and receives the PDF. The free plan includes 1,000 API calls a month; the document can be archived, protected, or digitally signed in the same flow.",
      },
      {
        question: "Can pages behind a login be converted?",
        answer:
          "URL conversion loads the page as it is publicly reachable: content behind authentication won't appear. The robust route is to supply the HTML directly — your application has the data and can build the complete document before conversion.",
      },
      {
        question: "How do I control the pagination of the resulting PDF?",
        answer:
          "With standard print CSS, which Chromium honors: page-break and break-inside properties to govern the cuts, @media print rules to adapt styles, @page for margins. A well-prepared HTML template yields precisely paginated PDFs, reproducible on every run.",
      },
    ],
    useCases: [
      "Auto-generate invoices and certificates as PDFs from your applications via the API",
      "Archive a web page — an article, a listing, terms in force — exactly as displayed on a given date",
      "Produce PDF reports from styled HTML templates, identical on every run",
    ],
    relatedTools: ["pdf-a", "compress-pdf", "protect-pdf"],
    relatedSolutions: ["freelancers", "real-estate", "accountants"],
    icon: "globe",
  },
  {
    slug: "pdf-a",
    name: "PDF/A",
    metaTitle: "Convert PDF to PDF/A for Archiving | GigaPDF",
    metaDescription:
      "Convert PDFs to the PDF/A-1b or PDF/A-2b archival format, ISO 19005 compliant. Free, open source, and self-hostable.",
    h1: "Convert a PDF to PDF/A for long-term archiving",
    intro: [
      "An ordinary PDF promises nothing over time: fonts that aren't embedded and will render differently in ten years, content depending on external resources, dynamic elements. For documents that carry obligations — contracts, invoices, regulatory filings — the ISO 19005 standard defined PDF/A: a restricted PDF profile where everything needed for display lives inside the file, permanently.",
      "GigaPDF converts your documents to two conformance levels: PDF/A-1b, the historic profile most often demanded by public bodies, and PDF/A-2b, more recent, which allows JPEG2000 compression and transparency — frequently the better pick for contemporary documents. The conversion embeds the fonts, normalizes color spaces, and writes the XMP conformance metadata that validators check.",
      "Compliant archiving is often a hard requirement: public procurement, invoice retention rules, e-filing procedures, and electronic archiving systems demand PDF/A at the door. With GigaPDF, conformance is a one-click operation — or an API call to handle whole flows — included in the free plan and runnable on your own infrastructure.",
    ],
    howTo: {
      title: "How to convert a document to PDF/A",
      steps: [
        "Upload the PDF that needs to be made compliant.",
        "Choose the target level: PDF/A-1b (the classic requirement) or PDF/A-2b (the newer profile).",
        "Run the conversion: fonts embedded, colors normalized, conformance metadata written.",
        "Retrieve the compliant file, ready for submission or your archiving system.",
        "Keep the original in the document manager: versions, tags, and full-text search stay on.",
      ],
    },
    capabilities: [
      "Conversion to PDF/A-1b and PDF/A-2b (ISO 19005)",
      "Fonts embedded in the file: identical display over time",
      "Color spaces normalized and XMP conformance metadata written",
      "One-click single documents or whole flows via the API",
      "Pairs with OCR: a scan becomes a compliant, searchable archive",
      "Self-hosting available for strict internal archiving policies",
    ],
    faq: [
      {
        question: "PDF/A-1b or PDF/A-2b: which one should I choose?",
        answer:
          "Follow the recipient's requirement first: if an authority or archiving system mandates a level, the question is settled. Otherwise, PDF/A-2b is generally preferable for current documents — it accepts transparency and more efficient compression — while PDF/A-1b remains the safe bet against older systems.",
      },
      {
        question: "What actually changes inside my file?",
        answer:
          "Everything that would make display depend on the outside world gets resolved: fonts are embedded, colors bound to an explicit profile, conformance metadata written in XMP. Content the standard forbids — dynamic elements, external dependencies — is neutralized. Visually, the document stays the same.",
      },
      {
        question: "Is a PDF/A still editable or signable?",
        answer:
          "PDF/A is still a PDF: technically readable and editable everywhere. The spirit of archiving is to freeze the document — and best practice is to sign it digitally (PKCS#7, available in GigaPDF): any later modification becomes detectable, adding an integrity guarantee to the durability one.",
      },
      {
        question: "Can a scan be made PDF/A compliant and searchable at once?",
        answer:
          "Yes, that's the ideal archiving chain in GigaPDF: Tesseract OCR to recognize the text, the invisible searchable layer to make it usable, then PDF/A conversion. The final document is durable, compliant, and queryable in full text all at once.",
      },
    ],
    useCases: [
      "Bring invoices and accounting records to the format required for legal retention",
      "Submit compliant documents to e-filing systems and public procurement portals",
      "Build durable firm archives: OCR plus PDF/A plus digital signature",
    ],
    relatedTools: ["sign-pdf", "ocr-pdf", "searchable-pdf", "protect-pdf"],
    relatedSolutions: ["lawyers", "accountants", "healthcare"],
    icon: "archive",
  },
];

/** Index by slug for the dynamic pages. */
const TOOLS_BY_SLUG = new Map(TOOLS.map((tool) => [tool.slug, tool]));

export function getToolBySlug(slug: string): ToolData | undefined {
  return TOOLS_BY_SLUG.get(slug);
}

export function getAllToolSlugs(): string[] {
  return TOOLS.map((tool) => tool.slug);
}
