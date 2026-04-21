"""
Pydantic schemas for font extraction responses.

Defines the data models for embedded font metadata, list responses,
and font binary data responses used by the fonts extraction endpoints.
"""

from pydantic import BaseModel, ConfigDict, Field


class ExtractedFontMetadata(BaseModel):
    """Metadata for a single extracted font from a PDF document."""

    model_config = ConfigDict(populate_by_name=True)

    font_id: str = Field(
        description="Stable hash identifier (sha256 truncated) derived from postscript_name + subtype"
    )
    original_name: str = Field(
        description="Font name as found in the PDF internal dictionary"
    )
    postscript_name: str | None = Field(
        default=None,
        description="PostScript name of the font (e.g. 'Helvetica', 'ABCDEF+Calibri')",
    )
    font_family: str | None = Field(
        default=None,
        description="Font family name derived from postscript_name (subset prefix stripped)",
    )
    subtype: str = Field(
        description="Font subtype: TrueType, CIDFontType2, Type1, Type0, or other PDF subtypes"
    )
    is_embedded: bool = Field(
        description="True if the font program is embedded in the PDF (FontFile present)"
    )
    is_subset: bool = Field(
        description="True if the font is a subset (postscript_name starts with ABCDEF+ prefix)"
    )
    format: str | None = Field(
        default=None,
        description="Detected binary format of the embedded font: ttf, otf, cff, or None if not embedded",
    )
    size_bytes: int | None = Field(
        default=None,
        description="Size in bytes of the embedded font program, None if not embedded",
    )


class FontsListResponse(BaseModel):
    """Response containing all fonts found in a PDF document."""

    document_id: str = Field(description="Document identifier")
    fonts: list[ExtractedFontMetadata] = Field(
        description="List of fonts found in the document"
    )
    total: int = Field(description="Total number of fonts found")


class FontDataResponse(BaseModel):
    """Response containing the binary data of an embedded font."""

    font_id: str = Field(description="Font identifier")
    data_base64: str = Field(
        description="Base64-encoded binary data of the embedded font program"
    )
    format: str = Field(description="Font binary format: ttf, otf, or cff")
    mime_type: str = Field(
        description="MIME type corresponding to the font format (e.g. font/ttf)"
    )
    original_name: str = Field(description="Font name as found in the PDF")
