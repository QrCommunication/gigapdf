export { encryptPDF, type EncryptOptions, type EncryptionAlgorithm } from './pdf-encrypt';
export { decryptPDF } from './pdf-decrypt';
export { getPermissions, setPermissions, type PermissionsResult } from './permissions';
export {
  encryptPDFForCertificates,
  decryptPDFWithPrivateKey,
  normalizeToDer,
  type EncryptForCertificatesOptions,
} from './pdf-certificates';
