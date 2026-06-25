export {
  signPdf,
  signPdfTimestamped,
  signPdfLtv,
  verifyPdfSignatures,
  certifyPdf,
  PdfSignInvalidCertificateError,
  PdfSignTimestampError,
  PdfSignLtvError,
  FREETSA_TSA_URL,
} from './pdf-sign';
export type {
  SignPdfOptions,
  SignPdfLtvOptions,
  SignPdfResult,
  VerifySignaturesResult,
  CertifyPdfOptions,
  DocMdpLevel,
  SignatureInfo,
  SignatureReport,
} from './pdf-sign';
