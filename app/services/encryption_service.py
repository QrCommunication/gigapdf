"""
Document Encryption Service - AES-256-GCM encryption for documents at rest.

This module provides enterprise-grade encryption for documents stored in S3.
Each document is encrypted with a unique Data Encryption Key (DEK), which is
then encrypted using a Key Encryption Key (KEK) derived from the master secret.

Security Features:
- AES-256-GCM authenticated encryption
- Unique key per document
- Key derivation using PBKDF2
- Secure random IV/nonce generation
- Integrity verification via GCM authentication tag
"""

import os
import base64
import hashlib
import logging
import secrets
from typing import Tuple, Optional
from datetime import datetime, timezone

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend

from app.config import get_settings

logger = logging.getLogger(__name__)

# Encryption constants
KEY_SIZE = 32  # 256 bits for AES-256
NONCE_SIZE = 12  # 96 bits recommended for GCM
TAG_SIZE = 16  # 128 bits authentication tag
SALT_SIZE = 16  # 128 bits for key derivation salt
PBKDF2_ITERATIONS = 100_000  # OWASP recommended minimum

# Version byte for future algorithm upgrades
ENCRYPTION_VERSION = b'\x01'


class EncryptionError(Exception):
    """Raised when encryption/decryption fails."""
    pass


class EncryptionService:
    """
    Service for encrypting and decrypting documents using AES-256-GCM.

    Uses envelope encryption:
    1. Generate a unique Data Encryption Key (DEK) for each document
    2. Encrypt the document with the DEK
    3. Encrypt the DEK with the Key Encryption Key (KEK)
    4. Store the encrypted DEK with the document metadata
    """

    def __init__(self):
        """Initialize encryption service with master key from settings."""
        self.settings = get_settings()
        self._master_key = None
        self._initialize_master_key()

    def _initialize_master_key(self):
        """
        Derive the Key Encryption Key (KEK) from the application secret.

        The KEK is used to encrypt/decrypt Data Encryption Keys (DEKs).
        """
        master_secret = self.settings.app_secret_key.encode('utf-8')

        # Use a fixed salt for KEK derivation (derived from secret itself)
        # This ensures the same KEK is derived on each startup
        kek_salt = hashlib.sha256(b"gigapdf-kek-salt-" + master_secret).digest()[:SALT_SIZE]

        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=KEY_SIZE,
            salt=kek_salt,
            iterations=PBKDF2_ITERATIONS,
            backend=default_backend()
        )

        self._master_key = kdf.derive(master_secret)
        logger.info("Encryption service initialized with derived KEK")

    def generate_document_key(self) -> Tuple[bytes, bytes]:
        """
        Generate a new Data Encryption Key (DEK) for a document.

        Returns:
            Tuple of (plaintext DEK, encrypted DEK for storage)
        """
        # Generate a cryptographically secure random key
        dek = secrets.token_bytes(KEY_SIZE)

        # Encrypt the DEK with the KEK
        encrypted_dek = self._encrypt_key(dek)

        return dek, encrypted_dek

    def _encrypt_key(self, key: bytes) -> bytes:
        """
        Encrypt a key using the master KEK.

        Args:
            key: The plaintext key to encrypt.

        Returns:
            Encrypted key with nonce prepended.
        """
        nonce = secrets.token_bytes(NONCE_SIZE)
        aesgcm = AESGCM(self._master_key)
        ciphertext = aesgcm.encrypt(nonce, key, None)

        # Format: version (1 byte) + nonce (12 bytes) + ciphertext+tag
        return ENCRYPTION_VERSION + nonce + ciphertext

    def _decrypt_key(self, encrypted_key: bytes) -> bytes:
        """
        Decrypt a key using the master KEK.

        Args:
            encrypted_key: The encrypted key with nonce.

        Returns:
            Plaintext key.
        """
        if len(encrypted_key) < 1 + NONCE_SIZE + TAG_SIZE:
            raise EncryptionError("Invalid encrypted key format")

        version = encrypted_key[0:1]
        if version != ENCRYPTION_VERSION:
            raise EncryptionError(f"Unsupported encryption version: {version.hex()}")

        nonce = encrypted_key[1:1 + NONCE_SIZE]
        ciphertext = encrypted_key[1 + NONCE_SIZE:]

        aesgcm = AESGCM(self._master_key)
        try:
            return aesgcm.decrypt(nonce, ciphertext, None)
        except Exception as e:
            raise EncryptionError(f"Key decryption failed: {e}")

    def encrypt_document(
        self,
        document_data: bytes,
        document_id: str,
        user_id: str
    ) -> Tuple[bytes, bytes]:
        """
        Encrypt a document using envelope encryption.

        Args:
            document_data: The plaintext document bytes.
            document_id: Unique document identifier (for audit).
            user_id: User identifier (for audit).

        Returns:
            Tuple of (encrypted document, encrypted DEK for storage)
        """
        try:
            # Generate unique key for this document
            dek, encrypted_dek = self.generate_document_key()

            # Generate random nonce
            nonce = secrets.token_bytes(NONCE_SIZE)

            # Create additional authenticated data (AAD) for integrity
            aad = self._create_aad(document_id, user_id)

            # Encrypt the document
            aesgcm = AESGCM(dek)
            ciphertext = aesgcm.encrypt(nonce, document_data, aad)

            # Format: version (1 byte) + nonce (12 bytes) + ciphertext+tag
            encrypted_document = ENCRYPTION_VERSION + nonce + ciphertext

            # Securely clear the DEK from memory
            dek = b'\x00' * KEY_SIZE

            logger.info(
                f"Document encrypted: {document_id[:8]}... "
                f"(original: {len(document_data)} bytes, "
                f"encrypted: {len(encrypted_document)} bytes)"
            )

            return encrypted_document, encrypted_dek

        except Exception as e:
            logger.error(f"Document encryption failed for {document_id[:8]}...: {e}")
            raise EncryptionError(f"Encryption failed: {e}")

    def decrypt_document(
        self,
        encrypted_document: bytes,
        encrypted_dek: bytes,
        document_id: str,
        user_id: str
    ) -> bytes:
        """
        Decrypt a document using envelope encryption.

        Args:
            encrypted_document: The encrypted document bytes.
            encrypted_dek: The encrypted Data Encryption Key.
            document_id: Unique document identifier (for AAD verification).
            user_id: User identifier (for AAD verification).

        Returns:
            Decrypted document bytes.
        """
        try:
            # Decrypt the DEK
            dek = self._decrypt_key(encrypted_dek)

            # Parse the encrypted document
            if len(encrypted_document) < 1 + NONCE_SIZE + TAG_SIZE:
                raise EncryptionError("Invalid encrypted document format")

            version = encrypted_document[0:1]
            if version != ENCRYPTION_VERSION:
                raise EncryptionError(f"Unsupported encryption version: {version.hex()}")

            nonce = encrypted_document[1:1 + NONCE_SIZE]
            ciphertext = encrypted_document[1 + NONCE_SIZE:]

            # Recreate AAD for verification
            aad = self._create_aad(document_id, user_id)

            # Decrypt the document
            aesgcm = AESGCM(dek)
            plaintext = aesgcm.decrypt(nonce, ciphertext, aad)

            # Securely clear the DEK from memory
            dek = b'\x00' * KEY_SIZE

            logger.info(
                f"Document decrypted: {document_id[:8]}... "
                f"(encrypted: {len(encrypted_document)} bytes, "
                f"decrypted: {len(plaintext)} bytes)"
            )

            return plaintext

        except Exception as e:
            logger.error(f"Document decryption failed for {document_id[:8]}...: {e}")
            raise EncryptionError(f"Decryption failed: {e}")

    def _create_aad(self, document_id: str, user_id: str) -> bytes:
        """
        Create Additional Authenticated Data for GCM mode.

        AAD ensures the document can only be decrypted with the correct
        document_id and user_id, preventing key confusion attacks.

        Args:
            document_id: Document identifier.
            user_id: User identifier.

        Returns:
            AAD bytes.
        """
        return f"gigapdf:doc:{document_id}:user:{user_id}".encode('utf-8')

    def rotate_document_key(
        self,
        encrypted_document: bytes,
        old_encrypted_dek: bytes,
        document_id: str,
        user_id: str
    ) -> Tuple[bytes, bytes]:
        """
        Re-encrypt a document with a new DEK (key rotation).

        This should be used periodically for security or when the master
        key is rotated.

        Args:
            encrypted_document: Currently encrypted document.
            old_encrypted_dek: Current encrypted DEK.
            document_id: Document identifier.
            user_id: User identifier.

        Returns:
            Tuple of (newly encrypted document, new encrypted DEK)
        """
        # Decrypt with old key
        plaintext = self.decrypt_document(
            encrypted_document,
            old_encrypted_dek,
            document_id,
            user_id
        )

        # Re-encrypt with new key
        new_encrypted_doc, new_encrypted_dek = self.encrypt_document(
            plaintext,
            document_id,
            user_id
        )

        logger.info(f"Document key rotated: {document_id[:8]}...")

        return new_encrypted_doc, new_encrypted_dek

    def get_encryption_metadata(self) -> dict:
        """
        Get metadata about the encryption configuration.

        Returns:
            Dict with encryption metadata for security audits.
        """
        return {
            "algorithm": "AES-256-GCM",
            "key_size_bits": KEY_SIZE * 8,
            "nonce_size_bits": NONCE_SIZE * 8,
            "tag_size_bits": TAG_SIZE * 8,
            "key_derivation": "PBKDF2-SHA256",
            "kdf_iterations": PBKDF2_ITERATIONS,
            "envelope_encryption": True,
            "version": ENCRYPTION_VERSION.hex(),
        }


# Encode/decode helpers for database storage
def encode_encrypted_key(encrypted_key: bytes) -> str:
    """Encode encrypted key bytes to base64 string for database storage."""
    return base64.b64encode(encrypted_key).decode('ascii')


def decode_encrypted_key(encoded_key: str) -> bytes:
    """Decode base64 string back to encrypted key bytes."""
    return base64.b64decode(encoded_key.encode('ascii'))


# Global service instance
encryption_service = EncryptionService()
