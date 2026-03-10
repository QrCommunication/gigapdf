"""
Internationalization support for error messages.

Provides translation of error messages and API responses
based on Accept-Language header.
"""

from typing import Optional

# Translation dictionaries for supported languages
TRANSLATIONS: dict[str, dict[str, str]] = {
    "en": {
        # Error codes
        "PDF_PARSE_ERROR": "Failed to parse PDF document",
        "PDF_ENCRYPTED": "PDF is encrypted, password required",
        "PDF_INVALID_PASSWORD": "Invalid PDF password",
        "PDF_CORRUPTED": "PDF file is corrupted",
        "ELEMENT_NOT_FOUND": "Element not found: {element_id}",
        "PAGE_NOT_FOUND": "Page not found: {page_number}",
        "DOCUMENT_NOT_FOUND": "Document not found: {document_id}",
        "INVALID_OPERATION": "Operation not permitted",
        "QUOTA_EXCEEDED": "Storage quota exceeded",
        "JOB_NOT_FOUND": "Job not found: {job_id}",
        "JOB_FAILED": "Job failed: {reason}",
        "AUTH_REQUIRED": "Authentication required",
        "AUTH_INVALID": "Invalid or expired token",
        "VALIDATION_ERROR": "Request validation failed",
        "RATE_LIMIT_EXCEEDED": "Rate limit exceeded. Try again in {seconds} seconds",
        "API_QUOTA_EXCEEDED": "Monthly API quota exceeded. Upgrade your plan or wait until next month",
        "STORAGE_QUOTA_EXCEEDED": "Storage quota exceeded. Upgrade your plan or delete files",
        "INTERNAL_ERROR": "An internal error occurred",
        # Success messages
        "DOCUMENT_UPLOADED": "Document uploaded successfully",
        "DOCUMENT_DELETED": "Document deleted successfully",
        "PAGE_ADDED": "Page added successfully",
        "PAGE_DELETED": "Page deleted successfully",
        "ELEMENT_CREATED": "Element created successfully",
        "ELEMENT_UPDATED": "Element updated successfully",
        "ELEMENT_DELETED": "Element deleted successfully",
        "EXPORT_STARTED": "Export started",
        "OCR_STARTED": "OCR processing started",
    },
    "fr": {
        # Codes d'erreur
        "PDF_PARSE_ERROR": "Impossible d'analyser le document PDF",
        "PDF_ENCRYPTED": "Le PDF est chiffré, mot de passe requis",
        "PDF_INVALID_PASSWORD": "Mot de passe PDF invalide",
        "PDF_CORRUPTED": "Le fichier PDF est corrompu",
        "ELEMENT_NOT_FOUND": "Élément introuvable : {element_id}",
        "PAGE_NOT_FOUND": "Page introuvable : {page_number}",
        "DOCUMENT_NOT_FOUND": "Document introuvable : {document_id}",
        "INVALID_OPERATION": "Opération non autorisée",
        "QUOTA_EXCEEDED": "Quota de stockage dépassé",
        "JOB_NOT_FOUND": "Tâche introuvable : {job_id}",
        "JOB_FAILED": "Échec de la tâche : {reason}",
        "AUTH_REQUIRED": "Authentification requise",
        "AUTH_INVALID": "Jeton invalide ou expiré",
        "VALIDATION_ERROR": "Échec de la validation de la requête",
        "RATE_LIMIT_EXCEEDED": "Limite de requêtes dépassée. Réessayez dans {seconds} secondes",
        "API_QUOTA_EXCEEDED": "Quota API mensuel dépassé. Passez à un forfait supérieur ou attendez le mois prochain",
        "STORAGE_QUOTA_EXCEEDED": "Quota de stockage dépassé. Passez à un forfait supérieur ou supprimez des fichiers",
        "INTERNAL_ERROR": "Une erreur interne s'est produite",
        # Messages de succès
        "DOCUMENT_UPLOADED": "Document téléversé avec succès",
        "DOCUMENT_DELETED": "Document supprimé avec succès",
        "PAGE_ADDED": "Page ajoutée avec succès",
        "PAGE_DELETED": "Page supprimée avec succès",
        "ELEMENT_CREATED": "Élément créé avec succès",
        "ELEMENT_UPDATED": "Élément mis à jour avec succès",
        "ELEMENT_DELETED": "Élément supprimé avec succès",
        "EXPORT_STARTED": "Export démarré",
        "OCR_STARTED": "Traitement OCR démarré",
    },
    "es": {
        # Códigos de error
        "PDF_PARSE_ERROR": "No se pudo analizar el documento PDF",
        "PDF_ENCRYPTED": "El PDF está cifrado, se requiere contraseña",
        "PDF_INVALID_PASSWORD": "Contraseña de PDF inválida",
        "PDF_CORRUPTED": "El archivo PDF está corrupto",
        "ELEMENT_NOT_FOUND": "Elemento no encontrado: {element_id}",
        "PAGE_NOT_FOUND": "Página no encontrada: {page_number}",
        "DOCUMENT_NOT_FOUND": "Documento no encontrado: {document_id}",
        "INVALID_OPERATION": "Operación no permitida",
        "QUOTA_EXCEEDED": "Cuota de almacenamiento excedida",
        "JOB_NOT_FOUND": "Trabajo no encontrado: {job_id}",
        "JOB_FAILED": "Trabajo fallido: {reason}",
        "AUTH_REQUIRED": "Autenticación requerida",
        "AUTH_INVALID": "Token inválido o expirado",
        "VALIDATION_ERROR": "Error de validación de solicitud",
        "RATE_LIMIT_EXCEEDED": "Límite de solicitudes excedido. Intente de nuevo en {seconds} segundos",
        "INTERNAL_ERROR": "Ocurrió un error interno",
    },
    "de": {
        # Fehlercodes
        "PDF_PARSE_ERROR": "PDF-Dokument konnte nicht analysiert werden",
        "PDF_ENCRYPTED": "PDF ist verschlüsselt, Passwort erforderlich",
        "PDF_INVALID_PASSWORD": "Ungültiges PDF-Passwort",
        "PDF_CORRUPTED": "PDF-Datei ist beschädigt",
        "ELEMENT_NOT_FOUND": "Element nicht gefunden: {element_id}",
        "PAGE_NOT_FOUND": "Seite nicht gefunden: {page_number}",
        "DOCUMENT_NOT_FOUND": "Dokument nicht gefunden: {document_id}",
        "INVALID_OPERATION": "Vorgang nicht erlaubt",
        "QUOTA_EXCEEDED": "Speicherplatzkontingent überschritten",
        "JOB_NOT_FOUND": "Auftrag nicht gefunden: {job_id}",
        "JOB_FAILED": "Auftrag fehlgeschlagen: {reason}",
        "AUTH_REQUIRED": "Authentifizierung erforderlich",
        "AUTH_INVALID": "Ungültiger oder abgelaufener Token",
        "VALIDATION_ERROR": "Anforderungsvalidierung fehlgeschlagen",
        "RATE_LIMIT_EXCEEDED": "Ratenlimit überschritten. Versuchen Sie es in {seconds} Sekunden erneut",
        "INTERNAL_ERROR": "Ein interner Fehler ist aufgetreten",
    },
    "pt": {
        # Códigos de erro
        "PDF_PARSE_ERROR": "Falha ao analisar o documento PDF",
        "PDF_ENCRYPTED": "O PDF está criptografado, senha necessária",
        "PDF_INVALID_PASSWORD": "Senha do PDF inválida",
        "PDF_CORRUPTED": "O arquivo PDF está corrompido",
        "ELEMENT_NOT_FOUND": "Elemento não encontrado: {element_id}",
        "PAGE_NOT_FOUND": "Página não encontrada: {page_number}",
        "DOCUMENT_NOT_FOUND": "Documento não encontrado: {document_id}",
        "INVALID_OPERATION": "Operação não permitida",
        "QUOTA_EXCEEDED": "Cota de armazenamento excedida",
        "JOB_NOT_FOUND": "Trabalho não encontrado: {job_id}",
        "JOB_FAILED": "Trabalho falhou: {reason}",
        "AUTH_REQUIRED": "Autenticação necessária",
        "AUTH_INVALID": "Token inválido ou expirado",
        "VALIDATION_ERROR": "Falha na validação da solicitação",
        "RATE_LIMIT_EXCEEDED": "Limite de taxa excedido. Tente novamente em {seconds} segundos",
        "INTERNAL_ERROR": "Ocorreu um erro interno",
    },
    "it": {
        # Codici di errore
        "PDF_PARSE_ERROR": "Impossibile analizzare il documento PDF",
        "PDF_ENCRYPTED": "Il PDF è crittografato, password richiesta",
        "PDF_INVALID_PASSWORD": "Password PDF non valida",
        "PDF_CORRUPTED": "Il file PDF è corrotto",
        "ELEMENT_NOT_FOUND": "Elemento non trovato: {element_id}",
        "PAGE_NOT_FOUND": "Pagina non trovata: {page_number}",
        "DOCUMENT_NOT_FOUND": "Documento non trovato: {document_id}",
        "INVALID_OPERATION": "Operazione non consentita",
        "QUOTA_EXCEEDED": "Quota di archiviazione superata",
        "AUTH_REQUIRED": "Autenticazione richiesta",
        "AUTH_INVALID": "Token non valido o scaduto",
        "INTERNAL_ERROR": "Si è verificato un errore interno",
    },
    "nl": {
        # Foutcodes
        "PDF_PARSE_ERROR": "Kan PDF-document niet analyseren",
        "PDF_ENCRYPTED": "PDF is versleuteld, wachtwoord vereist",
        "PDF_INVALID_PASSWORD": "Ongeldig PDF-wachtwoord",
        "PDF_CORRUPTED": "PDF-bestand is beschadigd",
        "DOCUMENT_NOT_FOUND": "Document niet gevonden: {document_id}",
        "AUTH_REQUIRED": "Authenticatie vereist",
        "INTERNAL_ERROR": "Er is een interne fout opgetreden",
    },
    "ru": {
        # Коды ошибок
        "PDF_PARSE_ERROR": "Не удалось проанализировать PDF-документ",
        "PDF_ENCRYPTED": "PDF зашифрован, требуется пароль",
        "PDF_INVALID_PASSWORD": "Неверный пароль PDF",
        "PDF_CORRUPTED": "PDF-файл поврежден",
        "DOCUMENT_NOT_FOUND": "Документ не найден: {document_id}",
        "AUTH_REQUIRED": "Требуется аутентификация",
        "INTERNAL_ERROR": "Произошла внутренняя ошибка",
    },
    "zh": {
        # 错误代码
        "PDF_PARSE_ERROR": "无法解析PDF文档",
        "PDF_ENCRYPTED": "PDF已加密，需要密码",
        "PDF_INVALID_PASSWORD": "PDF密码无效",
        "PDF_CORRUPTED": "PDF文件已损坏",
        "DOCUMENT_NOT_FOUND": "未找到文档：{document_id}",
        "AUTH_REQUIRED": "需要身份验证",
        "INTERNAL_ERROR": "发生内部错误",
    },
    "ja": {
        # エラーコード
        "PDF_PARSE_ERROR": "PDFドキュメントを解析できませんでした",
        "PDF_ENCRYPTED": "PDFは暗号化されています。パスワードが必要です",
        "PDF_INVALID_PASSWORD": "PDFパスワードが無効です",
        "PDF_CORRUPTED": "PDFファイルが破損しています",
        "DOCUMENT_NOT_FOUND": "ドキュメントが見つかりません：{document_id}",
        "AUTH_REQUIRED": "認証が必要です",
        "INTERNAL_ERROR": "内部エラーが発生しました",
    },
    "ko": {
        # 오류 코드
        "PDF_PARSE_ERROR": "PDF 문서를 분석할 수 없습니다",
        "PDF_ENCRYPTED": "PDF가 암호화되어 있습니다. 비밀번호가 필요합니다",
        "PDF_INVALID_PASSWORD": "PDF 비밀번호가 잘못되었습니다",
        "PDF_CORRUPTED": "PDF 파일이 손상되었습니다",
        "DOCUMENT_NOT_FOUND": "문서를 찾을 수 없습니다: {document_id}",
        "AUTH_REQUIRED": "인증이 필요합니다",
        "INTERNAL_ERROR": "내부 오류가 발생했습니다",
    },
    "ar": {
        # رموز الخطأ
        "PDF_PARSE_ERROR": "فشل في تحليل مستند PDF",
        "PDF_ENCRYPTED": "PDF مشفر، كلمة المرور مطلوبة",
        "PDF_INVALID_PASSWORD": "كلمة مرور PDF غير صالحة",
        "PDF_CORRUPTED": "ملف PDF تالف",
        "DOCUMENT_NOT_FOUND": "المستند غير موجود: {document_id}",
        "AUTH_REQUIRED": "المصادقة مطلوبة",
        "INTERNAL_ERROR": "حدث خطأ داخلي",
    },
}

# Supported languages
SUPPORTED_LANGUAGES = set(TRANSLATIONS.keys())
DEFAULT_LANGUAGE = "en"


def get_translation(
    key: str,
    language: str = DEFAULT_LANGUAGE,
    **kwargs,
) -> str:
    """
    Get translated message for a key.

    Args:
        key: Translation key (e.g., "PDF_PARSE_ERROR").
        language: Target language code.
        **kwargs: Format arguments for the message.

    Returns:
        str: Translated and formatted message.
    """
    # Normalize language code
    lang = language.lower().split("-")[0]  # "fr-FR" -> "fr"

    if lang not in SUPPORTED_LANGUAGES:
        lang = DEFAULT_LANGUAGE

    translations = TRANSLATIONS.get(lang, TRANSLATIONS[DEFAULT_LANGUAGE])
    message = translations.get(key)

    # Fallback to English if key not found in target language
    if message is None:
        message = TRANSLATIONS[DEFAULT_LANGUAGE].get(key, key)

    # Format with kwargs
    if kwargs:
        try:
            message = message.format(**kwargs)
        except KeyError:
            pass  # Keep original message if formatting fails

    return message


def parse_accept_language(header: Optional[str]) -> str:
    """
    Parse Accept-Language header and return best matching language.

    Args:
        header: Accept-Language header value.

    Returns:
        str: Best matching language code.
    """
    if not header:
        return DEFAULT_LANGUAGE

    # Parse languages with quality values
    languages = []
    for part in header.split(","):
        part = part.strip()
        if not part:
            continue

        if ";q=" in part:
            lang, q = part.split(";q=")
            try:
                quality = float(q)
            except ValueError:
                quality = 1.0
        else:
            lang = part
            quality = 1.0

        # Normalize language code
        lang = lang.strip().lower().split("-")[0]
        languages.append((lang, quality))

    # Sort by quality descending
    languages.sort(key=lambda x: x[1], reverse=True)

    # Find first supported language
    for lang, _ in languages:
        if lang in SUPPORTED_LANGUAGES:
            return lang

    return DEFAULT_LANGUAGE


class Translator:
    """
    Translator instance for a specific language.

    Usage:
        t = Translator("fr")
        message = t("PDF_PARSE_ERROR")
    """

    def __init__(self, language: str = DEFAULT_LANGUAGE):
        """
        Initialize translator.

        Args:
            language: Target language code.
        """
        self.language = language.lower().split("-")[0]
        if self.language not in SUPPORTED_LANGUAGES:
            self.language = DEFAULT_LANGUAGE

    def __call__(self, key: str, **kwargs) -> str:
        """
        Translate a key.

        Args:
            key: Translation key.
            **kwargs: Format arguments.

        Returns:
            str: Translated message.
        """
        return get_translation(key, self.language, **kwargs)

    def get(self, key: str, default: Optional[str] = None, **kwargs) -> str:
        """
        Get translation with default fallback.

        Args:
            key: Translation key.
            default: Default value if not found.
            **kwargs: Format arguments.

        Returns:
            str: Translated message or default.
        """
        result = get_translation(key, self.language, **kwargs)
        if result == key and default is not None:
            return default
        return result
