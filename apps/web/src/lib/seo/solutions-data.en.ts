/**
 * Programmatic SEO data — English profession pages (/en/solutions/[slug]).
 *
 * Static content written natively in English. Each page describes concrete
 * workflows for the target profession, backed exclusively by real GigaPDF
 * capabilities (cf. tools-data.en.ts). No variable templates.
 *
 * Slugs are English-specific; the FR ↔ EN mapping lives in ./slug-map.ts.
 * relatedTools reference EN tool slugs only.
 */

import type { SolutionData } from "./solutions-data";

export const SOLUTIONS: SolutionData[] = [
  {
    slug: "lawyers",
    name: "Lawyers & legal teams",
    metaTitle: "GigaPDF for Lawyers: True Redaction & Signing",
    metaDescription:
      "Real redaction (text removed from the file), PKCS#7 signing, PDF/A, and AES-256 encryption: the PDF tool for law firms. Open source, self-hostable.",
    h1: "The PDF tool for lawyers: redact, sign, archive with confidence",
    intro: [
      "The scandal is documented and keeps repeating: briefs and exhibits 'redacted' with black rectangles whose text reappears with a simple copy-paste, because the tool drew a mask over the content instead of removing it. For a firm, that is privileged information breached in one click. The first requirement of a legal PDF tool sits right there: a deletion must actually delete.",
      "GigaPDF performs real redaction, powered by GigaPDF's in-house engine: the text operators inside the redacted zone are physically stripped from the file's content stream. After processing, the text no longer exists — not in copy-paste, not in extraction, not in the zone's metadata. Around it stand the three other pillars of the legal document: PKCS#7 digital signing with your own P12 certificate (provable integrity, verifiable identity), PDF/A-1b and 2b compliant archiving, and AES-256 encryption for the exhibits that travel.",
      "Then comes the question every firm should put to its vendors: where do the documents go? GigaPDF answers it structurally — auditable open-source code, and complete self-hosting: the instance runs on the firm's own server, and client matters never pass through a third-party cloud. The free plan includes every feature, 5 GB, and 1000 documents.",
    ],
    workflows: [
      {
        title: "Redact an exhibit before disclosure",
        description:
          "Open the exhibit in the editor, draw the zones to black out over the privileged passages, and apply: the in-house engine deletes the text from the file itself. Verify by attempting a copy-paste over the zone — it returns nothing — then disclose the redacted exhibit, while the original stays intact in your workspace with its version history.",
      },
      {
        title: "Sign pleadings with your own certificate",
        description:
          "Load the P12 certificate issued through your bar or professional ecosystem, position the signature field, and confirm: GigaPDF seals the document with PKCS#7 (adbe.pkcs7.detached). The recipient checks in their viewer that the document is intact and signed by your hand — any later alteration breaks the signature.",
      },
      {
        title: "Build a hearing bundle",
        description:
          "Merge pleadings and exhibits into a single bundle, reorder the pages by dragging thumbnails, run OCR on the scanned exhibits to make them searchable, then compress the whole thing for e-filing platforms. The bundle is tagged by matter and retrievable through full-text search in the document manager.",
      },
      {
        title: "Archive a closed matter in compliance",
        description:
          "Convert the final documents to PDF/A-1b or 2b — fonts embedded, display guaranteed over time —, sign them digitally to freeze their integrity, and AES-256 encrypt those that remain sensitive. The archive is durable, verifiable, and confidential.",
      },
    ],
    capabilities: [
      "Real in-house redaction: text removed from the file, not masked",
      "PKCS#7 digital signing with the firm's P12/PFX certificate",
      "Compliant archiving in PDF/A-1b and PDF/A-2b (ISO 19005)",
      "AES-256 encryption plus print, copy, and modification permissions",
      "English and French OCR with full-text search across scanned exhibits",
      "Source-available self-hosting: client matters stay on your servers",
    ],
    faq: [
      {
        question: "How do I verify that the redaction really removed the text?",
        answer:
          "Run the test that traps bad tools: select the redacted zone and try a copy-paste, or search for one of the blacked-out words. With GigaPDF's in-house redaction, nothing comes out — the text operators were stripped from the content stream, so the word no longer exists in the file.",
      },
      {
        question: "Does GigaPDF's PKCS#7 signature carry evidentiary weight?",
        answer:
          "GigaPDF implements the standard mechanism (adbe.pkcs7.detached), verifiable in Adobe Reader and conforming viewers. The legal reach depends on the certificate used: with a qualified certificate from a trust provider, you fall under frameworks such as eIDAS for advanced or qualified signatures. The tool supplies the technique; your certificate supplies the qualification.",
      },
      {
        question: "Can GigaPDF run on the firm's own server?",
        answer:
          "Yes, fully: GigaPDF is open source, source-available under PolyForm Noncommercial, and built for self-hosting. Editing, redaction, signing, OCR, and document management then run on your infrastructure — no exhibit leaves the firm, which considerably simplifies the privilege and data-protection analysis.",
      },
      {
        question: "How do I find one exhibit among hundreds of documents?",
        answer:
          "GigaPDF indexes document content in full text — including scans that went through OCR. Search a name, a date, or a phrase: every exhibit containing it surfaces, wherever it's filed. Matter folders and tags complete the safety net.",
      },
    ],
    relatedTools: ["sign-pdf", "protect-pdf", "pdf-a", "ocr-pdf", "edit-pdf"],
    icon: "scale",
  },
  {
    slug: "accountants",
    name: "Accountants",
    metaTitle: "GigaPDF for Accountants: OCR & Client Records",
    metaDescription:
      "Merge client records, OCR scanned invoices, search every document in full text: the PDF document base for accounting firms. Free, open source.",
    h1: "Accountants: tame the flood of client paperwork",
    intro: [
      "Daily life at an accounting firm means records arriving in every possible state: invoices photographed on a phone, statements scanned at an angle, forty-page PDF bundles mixing fiscal years and vendors, unreadable receipts. Before any entry gets booked, there's a thankless layer of sorting, splitting, and reordering — and every document that can't be found at audit time costs hours.",
      "GigaPDF equips precisely that document layer. In-house OCR (English and French) makes scanned invoices usable: amounts, reference numbers, and legal mentions become searchable text indexed by the document manager. Splitting cuts bundles into individual records, merging rebuilds files by year or by client, and tags cross-reference the filing — the same document visible under 'Client X', '2025', and 'VAT' without a single duplicate.",
      "Everything fits in the free plan — 5 GB, 1000 documents, 1,000 monthly API calls to automate recurring flows — and a firm that wants its clients' financial data off third-party clouds installs GigaPDF on its own server: the code is open source, source-available under PolyForm Noncommercial.",
    ],
    workflows: [
      {
        title: "Process a bundle of client records",
        description:
          "Upload the scanned bundle, cut it into individual records from the thumbnail view, straighten crooked pages with rotation, then run OCR on the lot: every invoice becomes searchable by vendor, amount, or number. Tag by client and fiscal year — the record turns up in two seconds instead of two binders.",
      },
      {
        title: "Prepare an audit or review file",
        description:
          "Pull the relevant records through full-text search, merge them into one ordered file, compress the result to fit transmission platforms, and protect it with AES-256 encryption before sending. Version history traces each successive state of the file.",
      },
      {
        title: "Lock down the financial statements",
        description:
          "Convert spreadsheet-built statements to PDF — values replace formulas, the print area frames the pagination —, add the firm's watermark when appropriate, then archive as PDF/A for legal retention. PKCS#7 digital signing can seal the final deliverables.",
      },
      {
        title: "Automate the recurring intake",
        description:
          "Over the API (1,000 monthly calls included), wire up your tools: automatic conversion of incoming records, systematic OCR of scans, filing into client folders. The document layer keeps itself current without manual handling.",
      },
    ],
    capabilities: [
      "In-house OCR on scanned invoices and statements, accented text included",
      "Full-text search across record content, not just file names",
      "Bundle splitting and file merging without recompression",
      "Cross-tags by client, fiscal year, and record type",
      "Excel and Word to PDF conversion plus PDF/A archiving for retention",
      "API included to automate the firm's recurring flows",
    ],
    faq: [
      {
        question: "Does the OCR read invoices accurately?",
        answer:
          "Yes: GigaPDF's in-house OCR engine runs the English and French models together, so amounts, accented text, and legal mentions on crisp printed documents come through correctly. Crumpled receipts photographed at an angle remain the hard case for any OCR — scan flat when the stakes justify it.",
      },
      {
        question: "How do I organize records for dozens of clients without duplicating everything?",
        answer:
          "Through the document manager's folders-plus-tags combination: a primary filing by client, and transverse tags (fiscal year, VAT, fixed assets, to reconcile…) that cut across it without copying files. Full-text search backs it all up for the badly named records.",
      },
      {
        question: "Can I track the changes made to a file?",
        answer:
          "Yes. Every save creates a version in the document's history: you can review earlier states and restore the one preceding a bad manipulation. The trash also holds deleted documents for 30 days — a welcome net during closing season.",
      },
      {
        question: "Is my clients' financial data safe?",
        answer:
          "You get three levels: AES-256 encryption on sensitive documents, controlled link sharing instead of attachments, and — the strongest — self-hosting the GigaPDF instance on the firm's server, the code being open source and auditable. The data then depends on no outside provider.",
      },
    ],
    relatedTools: ["ocr-pdf", "merge-pdf", "split-pdf", "excel-to-pdf", "pdf-a"],
    icon: "calculator",
  },
  {
    slug: "human-resources",
    name: "Human resources",
    metaTitle: "GigaPDF for HR Teams: Contracts & E-Signatures",
    metaDescription:
      "Contracts, onboarding forms, digital signatures, encrypted payslips, and a 30-day trash: the PDF tool for HR teams. Open source.",
    h1: "Human resources: secure the employee document cycle",
    intro: [
      "HR documents stack up every constraint at once: they are contractual (mistakes are expensive), confidential (salaries, personal data), voluminous (every employee generates a file), and urgent (a hire won't wait). Between the contract to get signed, the form to complete, the payslip to deliver, and the amendment to archive, HR teams spend an unreasonable share of their time shuffling files.",
      "GigaPDF gathers that cycle into one tool. Contracts drafted in Word (.doc and .docx) convert to faithful PDFs, get signed digitally with PKCS#7 — a verifiable signature, the document sealed against modification — and go out AES-256 encrypted, with the password traveling through a different channel than the attachment. Onboarding forms are filled in the browser, then flattened to freeze the answers before archiving.",
      "The document manager brings the discipline data-protection rules expect: a folder per employee, tags per document type, version history across successive amendments, and a trash with 30-day retention that catches accidental deletions without contradicting your purge policies. Self-hosted, the entire personnel file stays on company infrastructure.",
    ],
    workflows: [
      {
        title: "Get an employment contract signed",
        description:
          "Convert the Word contract to PDF, check the layout in the viewer, sign with PKCS#7 using the company certificate, then send it through a share link. Each successive signature seals the document's state — any later change is detectable in any conforming viewer.",
      },
      {
        title: "Assemble an onboarding file",
        description:
          "Send out the PDF forms to complete; the candidate fills them in the browser, no printer involved. On return, flatten the forms to freeze the answers, merge them with the supporting documents into a single file, tag by employee, and archive. API field extraction spares the retyping into your HR system.",
      },
      {
        title: "Distribute sensitive documents",
        description:
          "Payslips, amendments, or disciplinary letters get AES-256 encrypted before sending: without the password — shared through a separate channel — the file is unreadable wherever it lands. PDF permissions additionally block printing and copying on view-only documents.",
      },
      {
        title: "Maintain the employee file over the years",
        description:
          "Each amendment creates a version; the history reproduces the file's state at any date. Departures trigger your purges: the 30-day trash separates deliberate deletion from accidental loss, and long-retention documents move to PDF/A.",
      },
    ],
    capabilities: [
      "Word (.doc, .docx) to faithful PDF conversion for contracts and amendments",
      "Verifiable PKCS#7 digital signing, document sealed against modification",
      "Forms filled in the browser, then flattened for archiving",
      "AES-256 encryption of employee documents plus granular permissions",
      "Folders, tags, versions, and a trash with 30-day retention",
      "Self-hosting: the personnel file stays on company servers",
    ],
    faq: [
      {
        question: "Is an electronically signed employment contract valid?",
        answer:
          "Most jurisdictions recognize electronic signatures on employment contracts; the strength depends on the signature level, hence on the certificate. GigaPDF provides the verifiable PKCS#7 standard: with a certificate from a qualified provider, you document the contract's integrity and the signer's identity — the two points that actually get disputed.",
      },
      {
        question: "How do I email a confidential HR document without the risk?",
        answer:
          "Encrypt the PDF with AES-256 in GigaPDF before sending, and pass the password through a distinct channel (SMS, phone). The attachment can then be forwarded, archived, or intercepted: without the password its content is cryptographically unreadable. Revocable link sharing is the alternative to attachments.",
      },
      {
        question: "What if an employee file is deleted by mistake?",
        answer:
          "The document manager's trash keeps deleted documents for 30 days: restoration is immediate and complete, versions included. Past that window, deletion becomes final — behavior aligned with privacy purge policies, which require that 'deleted' eventually means deleted.",
      },
      {
        question: "Can we keep HR documents off foreign clouds entirely?",
        answer:
          "Yes, radically: GigaPDF is open source (source-available) and installs on your own servers. Conversion, signing, encryption, and document management then run as a closed circuit on your infrastructure — a decisive argument in impact assessments and conversations with your data-protection officer.",
      },
    ],
    relatedTools: ["sign-pdf", "pdf-forms", "protect-pdf", "word-to-pdf", "edit-pdf"],
    icon: "users",
  },
  {
    slug: "real-estate",
    name: "Real estate",
    metaTitle: "GigaPDF for Real Estate: Leases & Inspections",
    metaDescription:
      "Digitally signed leases, annotated inspection reports, merged tenant files: the PDF tool for agencies and property managers. Free, open source.",
    h1: "Real estate: from signed leases to annotated inspection reports",
    intro: [
      "A rental or a sale is a document avalanche on short deadlines: application files arriving in scattered pieces, leases to sign before the applicant walks, inspection reports that must be documented precisely or the deposit dispute is lost, disclosures and annexes to attach without forgetting one. Agencies and property managers juggle scans, photos, and attachments all day.",
      "GigaPDF gives that flow a structure. Tenant files merge into single, ordered bundles — ID, proof of income, guarantees — instead of six attachments. The lease and its annexes get signed digitally with PKCS#7: a sealed document, integrity verifiable by every party, no in-person meeting required. The inspection report is annotated straight on the PDF — remarks pinned room by room, photos kept with the property's file — and the move-in and move-out versions sit side by side in the history.",
      "It all lives in the document manager: one folder per property, status tags (in progress, signed, archived), full-text search that finds a tenant's name across hundreds of documents, and link sharing that replaces oversized attachments. Free up to 5 GB and 1000 documents, every feature included.",
    ],
    workflows: [
      {
        title: "Assemble a tenant application file",
        description:
          "Gather the pieces received in bulk — phone photos, scans, PDFs —, convert and merge them into one ordered file, compress it under mailbox limits, and pass it to the owner by link. A clean file gets decided faster than an email thread with six attachments.",
      },
      {
        title: "Sign a lease remotely",
        description:
          "Generate the lease as a PDF from your word processor, merge the mandatory disclosures and annexes, then have each party sign digitally: PKCS#7 signatures stack, each sealing the document's state. No more meetings for three initials — and verifiable integrity if it's ever contested.",
      },
      {
        title: "Document a defensible inspection report",
        description:
          "Annotate the inspection PDF room by room: positioned remarks, meter readings, photos attached to the property file. At move-out, re-issue a copy of the move-in document, annotate the differences, and compare the two versions — the deposit conversation rests on dated, versioned documents.",
      },
      {
        title: "Run a portfolio or property-management book",
        description:
          "One folder per unit, tags per building and per status, meeting notices and minutes converted to PDF and archived as PDF/A, house rules distributed by link with the agency's watermark. Full-text search digs up a clause or a name across the whole portfolio.",
      },
    ],
    capabilities: [
      "Application documents merged into single ordered bundles",
      "Multi-party PKCS#7 digital signing of leases and mandates",
      "Native annotations on inspection reports, readable in any viewer",
      "Compression of scanned files for transmission and storage",
      "Per-property document base: folders, tags, versions, search, link sharing",
      "Agency watermark on distributed documents",
    ],
    faq: [
      {
        question: "Is an electronically signed lease valid?",
        answer:
          "Residential leases can generally be signed electronically. GigaPDF applies standard PKCS#7 signatures: each party signs with their certificate, the document is sealed at every step, and any later modification is detectable. The recognition level follows the certificate used — a qualified certificate places you under frameworks like eIDAS.",
      },
      {
        question: "How do I annotate an inspection report on site, without printing?",
        answer:
          "Open the PDF in GigaPDF from a browser — the editor needs no install —, add your remarks pinned room by room, highlight the points of attention, and record the meter readings. The annotated document saves with a timestamped version, and the annotations stay visible in every mainstream viewer.",
      },
      {
        question: "Application files exceed my mailbox's size limit — what now?",
        answer:
          "Two tools settle it: in-house compression, which cleans bulky scans without hurting readability, and above all link sharing, which replaces the attachment — the recipient views the file online while you keep control of access.",
      },
      {
        question: "How do I prove a document wasn't altered after signing?",
        answer:
          "That is exactly what the digital signature guarantees: it cryptographically binds the file's precise content to the signer's identity. Open the PDF in a conforming viewer such as Adobe Reader: the signature panel states whether the document is intact since each signature. In a landlord-tenant dispute, that verifiability changes the balance of power.",
      },
    ],
    relatedTools: ["sign-pdf", "annotate-pdf", "merge-pdf", "compress-pdf", "organize-pdf-pages"],
    icon: "building",
  },
  {
    slug: "healthcare",
    name: "Healthcare professionals",
    metaTitle: "GigaPDF for Healthcare: Encrypted Documents",
    metaDescription:
      "AES-256 encryption for medical documents and full self-hosting: the open-source PDF platform built with health data in mind.",
    h1: "Healthcare: encrypted documents on a sovereign platform",
    intro: [
      "Health data is the most protected category in privacy law, for a simple reason: a leaked report, prescription, or lab result cannot be 'reset' like a password. For a practice, a clinic, or a hospital, every digital tool that touches a patient document is a compliance question — and consumer PDF services that route files through servers nobody can vouch for are exactly what to avoid.",
      "GigaPDF gives two structural answers. First, AES-256 encryption at the document level — an encrypted report is unreadable without its password, in the mailbox and on the misplaced USB stick alike, while PDF permissions additionally restrict printing and copying. Second, the more radical one: self-hosting. The code being open source, source-available under PolyForm Noncommercial, the complete instance — editing, OCR, document management, sharing — installs on the care organization's infrastructure, and patient documents never leave its perimeter.",
      "Day to day, the platform smooths the document work itself: OCR turns paper letters and reports into searchable records, patient files merge into single bundles, consent forms are completed online and flattened, and long-retention documents move to PDF/A. Every feature ships in the free plan.",
    ],
    workflows: [
      {
        title: "Send a medical report with confidence",
        description:
          "Encrypt the document with AES-256 before sending, give the colleague or patient the password through a separate channel, and restrict printing and copying if warranted. Even forwarded or archived by a third-party mail server, the file stays cryptographically unreadable without the password.",
      },
      {
        title: "Digitize a patient's paper history",
        description:
          "Scan the old letters, reports, and results, upload them, run OCR (English + French), then add the searchable layer: each document keeps its original look — visible stamps and signatures — while becoming queryable. Full-text search surfaces a precedent in seconds instead of a filing cabinet.",
      },
      {
        title: "Collect consent forms",
        description:
          "Prepare the consent form as a PDF, have it filled in the browser — no printer on the patient's side —, then flatten the answers to freeze the document before filing. A digital signature can seal the collected consent.",
      },
      {
        title: "Deploy a sovereign instance",
        description:
          "Install GigaPDF on the organization's servers: every processing step — editing, OCR, encryption, document management, internal sharing — executes inside your perimeter. The source code is auditable by your IT security officer or contractor, and no patient document crosses into a third-party cloud.",
      },
    ],
    capabilities: [
      "AES-256 encryption of medical documents plus granular permissions",
      "Complete self-hosting: patient data stays inside your perimeter",
      "Open-source code, auditable by your security officer or contractor",
      "OCR and searchable layer for digitized paper archives",
      "Consent forms completed online, then flattened",
      "PDF/A archiving for documents under long retention",
    ],
    faq: [
      {
        question: "Does GigaPDF fit the requirements that apply to health data?",
        answer:
          "The architecture makes it possible: self-hosted, documents never leave your infrastructure, which removes the third-party transfer question; AES-256 protects documents in motion; the source code is auditable. Overall compliance — certified hosting where required, access policies, audit trails — remains a property of your infrastructure and organization; GigaPDF slots in without forcing an external cloud.",
      },
      {
        question: "Why encrypt the PDF itself rather than rely on secure messaging?",
        answer:
          "Because the document outlives the transport: it gets downloaded, archived, sometimes forwarded. File-level encryption (AES-256) protects it wherever it sits, independently of the channel. Secure messaging and document encryption stack — defense in depth.",
      },
      {
        question: "Can OCR handle scanned medical reports?",
        answer:
          "Yes for typed documents: the OCR engine recognizes printed text in English and French, and the searchable layer makes the archive queryable without touching its appearance. Handwritten notes — common in older files — are not recognized: that is a limit of OCR, not a flaw in your scanning.",
      },
      {
        question: "What becomes of a document deleted by mistake?",
        answer:
          "The document manager's trash holds it for 30 days: full restoration, versions included. That window covers handling errors without contradicting your purge policies — beyond it, deletion is final. Version history separately protects against accidental overwrites.",
      },
    ],
    relatedTools: ["protect-pdf", "ocr-pdf", "searchable-pdf", "pdf-forms", "pdf-a"],
    icon: "heart-pulse",
  },
  {
    slug: "students",
    name: "Students",
    metaTitle: "GigaPDF for Students: Free PDF Tools, No Marks",
    metaDescription:
      "Annotate lecture notes, compress reports, convert your thesis, merge application files: a complete, genuinely free PDF tool. No watermark.",
    h1: "Students: a complete PDF tool that is genuinely free",
    intro: [
      "Student life runs on PDFs: handouts to annotate, papers to highlight for the thesis, reports due in a mandated format, application files to assemble — all on a software budget of exactly zero. The market's 'free' tools know it well, capping you at two operations a day or stamping their ad on the homework you submit.",
      "GigaPDF takes the opposite stance: every feature is included in the free plan — 5 GB of storage, 1000 documents — with no watermark added and no operation counter. Highlight and annotate your lectures in the browser, on any machine including the university library's: there is nothing to install. Convert your thesis from Word to a spotless PDF before submission, squeeze the screenshot-loaded internship report under the upload platform's limit, merge CV, cover letter, and transcripts into one application file.",
      "And because GigaPDF is open source (source-available), it doubles as study material: the code of the editor, the PDF engine, and the document manager is public. Computer-science students can look under the hood — or contribute, which never hurts a CV.",
    ],
    workflows: [
      {
        title: "Annotate lectures and sources",
        description:
          "Upload handouts and papers, highlight the key passages, add margin notes: annotations are native, so they show in any PDF reader, offline on your tablet included. Full-text search then finds a concept across your whole corpus — no more leafing through twenty files the night before the exam.",
      },
      {
        title: "Submit an assignment in the required format",
        description:
          "Convert the paper written in Word or an OpenDocument suite (.docx, .odt) to PDF: the layout freezes, identical on the grader's screen. If the submission platform caps file size, in-house compression lightens the file without touching text sharpness. No advertising lands on your work.",
      },
      {
        title: "Assemble an application file",
        description:
          "CV, cover letter, transcripts, certificates: merge everything into one ordered PDF, rearrange pages by drag and drop, and send a clean file — or a share link when the attachment is too heavy. Recruiters and admissions officers notice.",
      },
      {
        title: "Work on a thesis with others",
        description:
          "Share the thesis PDF with your partner or supervisor: real-time collaboration lets everyone annotate together, each seeing the others' remarks live. Version history keeps the successive states — priceless when a review round goes sideways.",
      },
    ],
    capabilities: [
      "Everything free: 5 GB, 1000 documents, no watermark, no counters",
      "Native annotations: highlights, notes, drawings, readable everywhere",
      "Word, OpenDocument, Excel, and PowerPoint to PDF conversion",
      "In-house compression to fit submission platform limits",
      "Merging and organizing of application files",
      "Real-time collaboration on group work",
    ],
    faq: [
      {
        question: "Is it really free, or is there a catch?",
        answer:
          "The free plan includes every capability — editing, annotation, conversion, OCR, signing — with volume as the only limit: 5 GB of storage, 1000 documents, and 1,000 API calls a month. No watermark on your files, no daily operation quota. The project is open source: the model is transparent, and so is the code.",
      },
      {
        question: "Can I use GigaPDF on university computers?",
        answer:
          "Yes: everything runs in the browser, no installation and no administrator rights. Log in to your account from the library, the computer lab, or home — your documents, annotations, and folders follow you.",
      },
      {
        question: "How do I shrink an internship report the platform refuses?",
        answer:
          "Run the compression: the in-house engine purges useless structural data and linearizes the file. On a report packed with screenshots and rebuilt through successive exports, the gain is often decisive — and the text stays perfectly sharp, unlike compressors that rasterize everything.",
      },
      {
        question: "Will my annotations show in my grader's PDF reader?",
        answer:
          "Yes: GigaPDF writes standard PDF annotations, displayed by Adobe Reader, browsers, macOS Preview, and e-readers. Conversely, to hand in a clean copy, flatten the annotations or simply delete them before the final export.",
      },
    ],
    relatedTools: ["annotate-pdf", "compress-pdf", "word-to-pdf", "merge-pdf"],
    icon: "graduation-cap",
  },
  {
    slug: "teachers-trainers",
    name: "Teachers & trainers",
    metaTitle: "GigaPDF for Teachers: Course Packs & Grading",
    metaDescription:
      "Build course packs, grade with annotations, watermark exam papers: the free PDF tool for teachers and independent trainers.",
    h1: "Teachers and trainers: own your course materials",
    intro: [
      "Preparing a course is document assembly work: a scanned textbook chapter, three exercises pulled from different files, a worksheet written in Word, two pages of past papers — and it all has to become one coherent, paginated, distributable pack. Then come the papers to grade, the exam questions to keep from leaking early, and the materials to maintain in a student version and an answer-key version.",
      "GigaPDF handles that chain end to end. Merging assembles the mixed sources into a single pack — Word, PowerPoint, and OpenDocument files converting along the way —, the thumbnail view reorders the pages, and splitting extracts the student version (questions only) from the full version (with answers). The watermark marks exam papers 'CONFIDENTIAL — DO NOT DISTRIBUTE' or puts your organization's name on materials that circulate.",
      "For grading, native annotations replace the red pen: highlights, margin remarks, final comments — straight onto the PDF paper, readable in whatever viewer the student uses. All of it costs nothing, and independent trainers under traceability obligations can archive their deliverables as PDF/A and sign them digitally.",
    ],
    workflows: [
      {
        title: "Compose a multi-source course pack",
        description:
          "Convert your Word, PowerPoint, and OpenDocument files to PDF, merge them with the scanned textbook pages, reorder everything on the thumbnail board, and compress the final pack for the LMS or training platform. One clean file, continuously paginated, current in your document manager with its versions.",
      },
      {
        title: "Grade digital papers",
        description:
          "Students submit their work as PDFs; you annotate in the browser — errors highlighted, remarks pinned in place, a closing comment — then return them by share link. The annotations are native: each student sees them in their usual reader, no imposed app.",
      },
      {
        title: "Protect an exam paper",
        description:
          "Watermark the paper diagonally 'CONFIDENTIAL' with the exam date, encrypt the file with AES-256 for transmission to proctors — the password traveling by another channel — and keep the original intact in your workspace. After the exam, release the public version freely.",
      },
      {
        title: "Maintain student and answer-key versions",
        description:
          "Keep the complete document (questions + answers) as the single source, then split out the question pages for the student version. At every update of the master document, regenerate the variant — version history keeps track of the successive vintages.",
      },
    ],
    capabilities: [
      "Merging of mixed sources (Word, PowerPoint, OpenDocument, scans) into single packs",
      "Native annotations for grading, readable in any reader",
      "Text or logo watermark on distributed papers and materials",
      "Question/answer-key split from a single master document",
      "Pack compression for LMS and training platforms",
      "PDF/A archiving and digital signing of training deliverables",
    ],
    faq: [
      {
        question: "How do I assemble a pack from files in different formats?",
        answer:
          "Upload everything to GigaPDF: .docx, .pptx, .odt, and .odp convert to PDF through the server-side in-house engine, scans come in as they are. Then merge the lot in the order you want — the thumbnail view refines it page by page. The final pack is one homogeneous, paginated PDF.",
      },
      {
        question: "Can I grade papers without printing them?",
        answer:
          "Yes, entirely: highlighting, margin remarks, freehand sketches for graphical corrections — everything happens in the editor, and the annotations are saved to the PDF standard. The student reads them in any viewer. You save the printing, the hauling, and the rescanning of paper stacks.",
      },
      {
        question: "Is a watermark enough to protect an exam paper?",
        answer:
          "The watermark deters and traces — a leaked paper carries your marking — but the real pre-exam protection is AES-256 encryption: without the password, the file is unreadable. Combine the two: encryption for the confidential phase, watermark for the controlled release.",
      },
      {
        question: "Does GigaPDF suit a training organization with several trainers?",
        answer:
          "Yes: materials are shared by link or email between trainers, real-time collaboration lets a team build a pack together, and the document manager — folders per module, tags per session, versions — serves as the common reference. Self-hosted, the organization keeps everything on its own infrastructure.",
      },
    ],
    relatedTools: ["merge-pdf", "annotate-pdf", "watermark-pdf", "powerpoint-to-pdf", "split-pdf"],
    icon: "book-open",
  },
  {
    slug: "freelancers",
    name: "Freelancers & independents",
    metaTitle: "GigaPDF for Freelancers: Invoices & Contracts",
    metaDescription:
      "Quotes and invoices as clean PDFs, deliverables carrying your brand, full Office conversion: the free PDF tool for independents, with API.",
    h1: "Freelancers: professional documents on a zero software budget",
    intro: [
      "Working independently means being your own back office: quotes to send within the hour, invoices to lock down properly, deliverables to brand, contracts to get signed — with tools paid out of your own pocket. Every software subscription subtracts straight from income, and the 'freemium' PDF services that stamp their own advertising on your client documents project precisely the image you're trying to avoid.",
      "GigaPDF lines up the features an independent actually needs, at no cost and with no imposed marking. Quotes and invoices composed in Word or Excel convert to spotless PDFs — values frozen, formulas hidden. Deliverables go out with your logo as a discreet watermark, and working versions carry a DRAFT marking that keeps an unvalidated mockup from being treated as final. Service contracts get signed digitally with PKCS#7 — a real, verifiable signature, not a pasted image.",
      "For technical profiles, the API (1,000 monthly calls included) automates document production: PDF invoices generated from your HTML templates rendered by the in-house engine, on-the-fly conversion, archiving. And the document manager doubles as your filing system: a folder per client, status tags, full-text search that digs up any clause.",
    ],
    workflows: [
      {
        title: "Produce clean quotes and invoices",
        description:
          "Compose the quote in Word or the summary in Excel, convert to PDF — layout frozen, formulas hidden —, then protect the file against modification before sending. For recurring flows, generate invoices straight from HTML over the API: the in-house engine renders your template identically, every time.",
      },
      {
        title: "Deliver documents that carry your brand",
        description:
          "Set your logo as a translucent watermark on deliverables — visible without hindering reading — and mark intermediate versions DRAFT when they go out for validation. No GigaPDF marking joins yours: the document stays one hundred percent your image.",
      },
      {
        title: "Get a service contract signed",
        description:
          "Convert the contract to PDF, sign it with your P12 certificate, then pass it to the client by share link for their own signature. Each PKCS#7 signature seals the document's state: if disagreement comes later, the signed contract's integrity is checkable in any viewer.",
      },
      {
        title: "Keep the paperwork side in order",
        description:
          "File issued and received invoices by folder and tag (client, quarter, to collect), run OCR on scanned receipts to find them by amount or vendor, and archive the fiscal year as PDF/A for legal retention. At closing, merge the records into bundles for your accountant.",
      },
    ],
    capabilities: [
      "Word, Excel, and PowerPoint to PDF conversion with no imposed marking",
      "Watermark in your brand: logo, opacity, and position adjustable",
      "PKCS#7 digital signing of contracts with your certificate",
      "Automated invoice generation over the API with in-house HTML rendering",
      "Per-client document base: folders, tags, full-text search, versions",
      "OCR on scanned receipts for the bookkeeping",
    ],
    faq: [
      {
        question: "What does GigaPDF add over free online converters?",
        answer:
          "Three concrete differences: no advertising on your client documents; one tool instead of six different sites (conversion, merging, signing, watermark, compression, document management); and a persistent workspace where documents are filed, versioned, and searchable — instead of throwaway files re-downloaded every time.",
      },
      {
        question: "Can I automate my invoicing without paying for a dedicated SaaS?",
        answer:
          "If you can produce HTML, yes: build your invoice template (your CSS, your identity), post it to the GigaPDF API, which renders it to PDF with its in-house engine, and archive the result in the document manager. The free plan includes 1,000 API calls a month — ample for an independent practice's invoicing.",
      },
      {
        question: "Does the digital signature protect me in a client dispute?",
        answer:
          "It documents two decisive things: that the contract hasn't changed since signing, and who signed it. That's the gap between word-against-word and a file whose integrity verifies technically. The precise legal reach follows the certificate used — a qualified certificate places you under frameworks like eIDAS.",
      },
      {
        question: "How do I mark a mockup so it isn't used without payment?",
        answer:
          "Watermark the validation copy — a bold diagonal DRAFT or SPECIMEN — and send the clean version only on payment. The watermark is written into the page content, not dropped as a deletable annotation; to harden further, add encryption with modification blocked.",
      },
    ],
    relatedTools: ["word-to-pdf", "watermark-pdf", "sign-pdf", "html-to-pdf", "excel-to-pdf"],
    icon: "briefcase",
  },
  {
    slug: "nonprofits",
    name: "Nonprofits",
    metaTitle: "GigaPDF for Nonprofits: Grants & Signed Minutes",
    metaDescription:
      "Every PDF feature free for your nonprofit: grant applications, signed minutes, online membership forms, volunteer collaboration. Open source.",
    h1: "Nonprofits: a complete PDF tool at the right price — zero",
    intro: [
      "A nonprofit produces the paperwork of a mid-size company on a piggy-bank budget: grant applications assembled piece by piece, board and general-assembly minutes to approve and archive, notices to circulate, memberships to collect — carried by volunteers who rotate, work from their own machines, and own neither an Acrobat license nor a file server.",
      "GigaPDF matches that situation point for point, in philosophy as much as in features: the free plan includes every capability — not a demo edition — with 5 GB and 1000 documents, enough for an organization's document life. Merging assembles grant applications (bylaws, budget, bank details, activity reports) into single bundles in the funder's required order; minutes get signed digitally; membership forms are filled online; and link sharing distributes documents to the board without attachments.",
      "Real-time collaboration lets several volunteers prepare an application on the same document, each from home. And the alignment reaches the license itself: GigaPDF is a source-available open-source project — auditable and self-hostable, which a well-equipped organization can even host on its own.",
    ],
    workflows: [
      {
        title: "Put together a grant application",
        description:
          "Gather bylaws, projected budget, bank details, activity report, and accounts — usually a mix of Word, Excel, and scans —, convert everything to PDF, merge in the order the funder demands, and compress under the submission portal's limit. The full application comes together with several people working live, each on their part.",
      },
      {
        title: "Approve and archive meeting minutes",
        description:
          "Convert the minutes drafted in Word to PDF, have the chair and secretary sign digitally — stacked PKCS#7 signatures, verifiable integrity —, then archive as PDF/A in the governance folder. The organization's memory survives board turnover.",
      },
      {
        title: "Collect memberships without a printer",
        description:
          "Distribute the membership form as a fillable PDF: the member completes it in the browser and sends it back. Flatten the answers on receipt to freeze each form, file them by season with tags, and extract the values over the API if you maintain a member register.",
      },
      {
        title: "Organize documentation across volunteers",
        description:
          "A folder per activity, tags per year and per governance body, link sharing for the board and committee: every volunteer reaches the current documents without an email chain. The 30-day trash and version history forgive the fumbles — inevitable when everyone is a volunteer.",
      },
    ],
    capabilities: [
      "Complete free plan: every feature, 5 GB, 1000 documents",
      "Merging and compression of multi-piece grant applications",
      "PKCS#7 digital signing of minutes and official documents",
      "Membership forms filled online, then flattened",
      "Link sharing and real-time collaboration between volunteers",
      "Source-available open-source project, self-hostable by equipped organizations",
    ],
    faq: [
      {
        question: "Is the free plan really enough for a nonprofit?",
        answer:
          "For the vast majority, yes: 5 GB and 1000 documents cover a season's grant applications, minutes, notices, and membership forms, and every feature — signing, OCR, conversion, collaboration — is included without crippling. No advertising appears on your official documents.",
      },
      {
        question: "How do several volunteers work on the same application?",
        answer:
          "Share the document by link with the people involved: real-time collaboration lets everyone annotate and complete it together, each seeing the others' contributions live. No more contradictory copies circulating by email — there is one reference document, and its version history keeps the record.",
      },
      {
        question: "Are digitally signed minutes accepted for our filings?",
        answer:
          "The PKCS#7 signature GigaPDF applies is the standard verifiable in every viewer: it proves the minutes' integrity and the signers' identity through their certificates. For routine filings — bank, registry, funders — that level of traceability goes well beyond a scanned initial, and PDF/A archiving guarantees long-term readability.",
      },
      {
        question: "What happens when the board changes hands?",
        answer:
          "That's where the document base earns its keep: documents, versions, and filing stay in place, independent of individuals. The incoming board receives access to the shared folders and finds the complete history — bylaws, minutes, agreements — through full-text search, with no dependence on the outgoing treasurer's hard drive.",
      },
    ],
    relatedTools: ["merge-pdf", "pdf-forms", "sign-pdf", "compress-pdf", "word-to-pdf"],
    icon: "users-round",
  },
  {
    slug: "architects-construction",
    name: "Architects & construction",
    metaTitle: "GigaPDF for Architects: Plan Markups & Big Files",
    metaDescription:
      "Mark up drawings, stamp approvals, compress heavy sets, make scanned specs searchable: the PDF tool for design and construction teams.",
    h1: "Architects and construction: from marked-up drawings to managed sets",
    intro: [
      "Construction documents come in their own weight class: large-format drawings running to dozens of megabytes, tender packages stacking specifications, plans, and annexes by the hundreds of pages, review cycles where every remark must sit at a precise spot on the drawing — and scanned spec books from past projects where nobody can find a requirement anymore.",
      "GigaPDF goes after those four pains. Native annotations carry the review cycle: remarks pinned to the millimeter on the drawing, clouds and arrows traced freehand, approval stamps applied as annotations — all readable by the contractor in any viewer, and traceable revision by revision through version history. In-house compression deflates reworked sets so procurement platforms accept them; rotation and reordering straighten scanned bundles mixing portrait and landscape.",
      "As for the paper archives, the OCR-plus-searchable-layer chain brings them back to life: a scanned spec book keeps its exact appearance — stamps and approvals visible — while becoming queryable in full text. Hunting a requirement across ten years of projects stops being an expedition. Everything is free, and self-hostable for practices that keep their projects in-house.",
    ],
    workflows: [
      {
        title: "Review and mark up drawings",
        description:
          "Open the drawing PDF received from the contractor, pin your remarks at the exact spots they concern, circle the zones to rework freehand, and apply the approval stamp as an annotation. Return it by share link: the contractor sees every remark in their usual reader, and the reviewed version stays in the document's history.",
      },
      {
        title: "Assemble a submittable tender package",
        description:
          "Merge specifications, drawings, and annexes into ordered files by trade, rearrange the pages on the thumbnail board, then compress: the in-house compression pass strips the dead data piled up by successive exports and linearizes the file for online viewing. The package clears the e-procurement platforms' limits.",
      },
      {
        title: "Make the project archives searchable",
        description:
          "Run the scanned specs, meeting minutes, and correspondence through OCR (English + French), then through the searchable layer: the documents' appearance — approvals, stamps, signatures — is preserved, while the document manager's full-text search retrieves a requirement, a material, or a contractor's name across the entire archive.",
      },
      {
        title: "Track revisions and issue status",
        description:
          "Every change to a document creates a version: the history reconstructs a drawing's or spec section's successive revisions. Tags per project, trade, and status (issued, reviewed, approved for construction) structure the base, and a watermark flags preliminary issues so a superseded revision never reaches the site.",
      },
    ],
    capabilities: [
      "Native annotations on drawings: pinned remarks, freehand markup, stamps",
      "In-house compression of heavy sets and linearization for online viewing",
      "OCR plus searchable layer: scanned documents become queryable, looks untouched",
      "Merging, rotation, and reordering of mixed portrait/landscape bundles",
      "Versions and tags per project, trade, and issue status",
      "Watermark on preliminary issues and link sharing with contractors",
    ],
    faq: [
      {
        question: "Does GigaPDF handle large-format drawings?",
        answer:
          "Yes: PDF imposes no page size, and A1 or A0 drawings open, annotate, and compress like any other document. For heavy sets, in-house compression and link sharing — which sidesteps email and its limits — are the two tools that change the daily routine.",
      },
      {
        question: "How do I apply an approval stamp to a drawing?",
        answer:
          "Through annotations: place your stamp — approval wording, date, reservations — at the chosen spot on the drawing, completed as needed with pinned remarks and markup. The annotation is native, so the contractor sees it whatever their reader. To freeze the approval permanently, flattening fuses the annotations into the page.",
      },
      {
        question: "Can we find a requirement inside old scanned specs?",
        answer:
          "That's the textbook case for the OCR-plus-searchable-layer chain: once processed, your digitized specs answer full-text search — a material, a standard, a contractor's name — while keeping their original appearance. The practice's archive becomes a queryable base instead of a graveyard of scans.",
      },
      {
        question: "How do we keep a superseded revision off the site?",
        answer:
          "Three guards combine: a 'PRELIMINARY ISSUE' or 'SUPERSEDED' watermark written into the pages of non-construction versions, status tags in the document manager separating reviewed from approved-for-construction, and link sharing — which always points at the current document, where an attachment freezes a stale state in inboxes.",
      },
    ],
    relatedTools: ["annotate-pdf", "compress-pdf", "searchable-pdf", "organize-pdf-pages", "watermark-pdf"],
    icon: "hard-hat",
  },
];

/** Index by slug for the dynamic pages. */
const SOLUTIONS_BY_SLUG = new Map(SOLUTIONS.map((solution) => [solution.slug, solution]));

export function getSolutionBySlug(slug: string): SolutionData | undefined {
  return SOLUTIONS_BY_SLUG.get(slug);
}

export function getAllSolutionSlugs(): string[] {
  return SOLUTIONS.map((solution) => solution.slug);
}
