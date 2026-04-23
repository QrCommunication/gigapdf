"""
Tests d'intégration pour le pipeline PDF avec vrais PDFs.

Ces tests NE MOCKENT PAS pdf_engine. Ils créent des PDFs minimaux via pikepdf
et valident que le pipeline open_document/get_all_page_dimensions/delete_page/
add_page/rotate_page/reorder_pages fonctionne bout en bout.

Rationale (post-mortem 04):
- Coverage Python était à 4% (2/48 fichiers testés)
- DocumentService.upload_document() n'avait aucun test
- Le conftest unit-level stubbait pdf_engine avec MagicMock(), ce qui masquait
  les bugs AttributeError/TypeError : MagicMock implémente __getitem__ par défaut,
  donc pdf_doc[i] ne lève pas d'erreur même si LegacyDocumentProxy ne supporte pas
  l'indexation par subscript.
- Ces tests d'intégration exercent le vrai PDFEngine + la vraie LegacyDocumentProxy
  pour attraper les régressions que les mocks rendent invisibles.
"""

import io

import pikepdf
import pytest
from fastapi.testclient import TestClient

from app.core.pdf_engine import PDFEngine, LegacyDocumentProxy


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def engine() -> PDFEngine:
    """Provide a fresh PDFEngine instance (not the global singleton) per test."""
    e = PDFEngine()
    yield e
    e.clear_all()


@pytest.fixture
def real_pdf_bytes() -> bytes:
    """Generate a minimal 3-page PDF using pikepdf."""
    pdf = pikepdf.Pdf.new()
    for _ in range(3):
        page = pikepdf.Dictionary(
            Type=pikepdf.Name("/Page"),
            MediaBox=[0, 0, 612, 792],
            Resources=pikepdf.Dictionary(),
        )
        pdf.pages.append(pikepdf.Page(page))
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


@pytest.fixture
def single_page_pdf_bytes() -> bytes:
    """Generate a minimal single-page PDF using pikepdf."""
    pdf = pikepdf.Pdf.new()
    page = pikepdf.Dictionary(
        Type=pikepdf.Name("/Page"),
        MediaBox=[0, 0, 595, 842],  # A4
        Resources=pikepdf.Dictionary(),
    )
    pdf.pages.append(pikepdf.Page(page))
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Class: LegacyDocumentProxy subscript regression
# ---------------------------------------------------------------------------

class TestLegacyDocumentProxyContract:
    """
    Tests qui auraient attrapé le bug LegacyDocumentProxy subscript.

    Ce bug aurait été vert avec MagicMock car MagicMock implémente __getitem__
    par défaut et retourne un autre MagicMock au lieu de lever TypeError.
    """

    def test_proxy_has_correct_page_count(self, engine, real_pdf_bytes):
        """open_document retourne un proxy avec le bon page_count."""
        document_id, proxy = engine.open_document(real_pdf_bytes)

        assert isinstance(proxy, LegacyDocumentProxy)
        assert proxy.page_count == 3

    def test_proxy_is_not_subscriptable(self, engine, real_pdf_bytes):
        """
        Régression: LegacyDocumentProxy n'est PAS subscriptable.

        Tout code qui utilisait pdf_doc[i] (pattern PyMuPDF) doit lever TypeError.
        Avec MagicMock, cette assertion n'aurait JAMAIS été testée car
        MagicMock.__getitem__ retourne silencieusement un autre MagicMock.
        """
        _, proxy = engine.open_document(real_pdf_bytes)

        with pytest.raises(TypeError, match="not subscriptable"):
            _ = proxy[0]

    def test_proxy_integer_slice_raises(self, engine, real_pdf_bytes):
        """Slice sur LegacyDocumentProxy lève TypeError (pas de __getitem__)."""
        _, proxy = engine.open_document(real_pdf_bytes)

        with pytest.raises(TypeError):
            _ = proxy[0:2]

    def test_proxy_tobytes_returns_valid_pdf(self, engine, real_pdf_bytes):
        """proxy.tobytes() retourne un PDF valide parseable par pikepdf."""
        _, proxy = engine.open_document(real_pdf_bytes)

        result = proxy.tobytes()

        assert isinstance(result, bytes)
        assert len(result) > 0
        # Must be a valid PDF readable by pikepdf
        with pikepdf.open(io.BytesIO(result)) as pdf:
            assert len(pdf.pages) == 3

    def test_proxy_metadata_property_returns_dict(self, engine, real_pdf_bytes):
        """proxy.metadata retourne un dict (pas un MagicMock)."""
        _, proxy = engine.open_document(real_pdf_bytes)

        meta = proxy.metadata

        assert isinstance(meta, dict)
        assert "title" in meta
        assert "author" in meta

    def test_proxy_is_encrypted_false_for_plain_pdf(self, engine, real_pdf_bytes):
        """PDFs non chiffrés : proxy.is_encrypted == False."""
        _, proxy = engine.open_document(real_pdf_bytes)

        assert proxy.is_encrypted is False


# ---------------------------------------------------------------------------
# Class: PDFEngine open and dimensions
# ---------------------------------------------------------------------------

class TestPDFEngineOpenDocument:
    """Tests du pipeline ouverture / lecture de dimensions."""

    def test_open_stores_document_id(self, engine, real_pdf_bytes):
        """open_document enregistre les bytes dans _documents[doc_id]."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        assert document_id in engine._documents

    def test_get_all_page_dimensions_count(self, engine, real_pdf_bytes):
        """get_all_page_dimensions retourne une entrée par page."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        dims = engine.get_all_page_dimensions(document_id)

        assert len(dims) == 3

    def test_get_all_page_dimensions_values(self, engine, real_pdf_bytes):
        """get_all_page_dimensions retourne les bonnes valeurs width/height."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        dims = engine.get_all_page_dimensions(document_id)

        for d in dims:
            assert d["width"] == pytest.approx(612.0)
            assert d["height"] == pytest.approx(792.0)
            assert d["rotation"] == 0

    def test_get_all_page_dimensions_page_numbers_are_1indexed(self, engine, real_pdf_bytes):
        """get_all_page_dimensions retourne des page_number 1-indexés."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        dims = engine.get_all_page_dimensions(document_id)

        assert [d["page_number"] for d in dims] == [1, 2, 3]

    def test_open_invalid_bytes_raises_pdf_error(self, engine):
        """
        Bytes non-PDF lèvent PDFCorruptedError ou PDFParseError.

        pikepdf lève PdfError (→ PDFCorruptedError) quand le fichier ne contient
        pas de trailer valide. PDFParseError est réservé aux erreurs d'I/O ou de
        type de source invalide. Les deux sont des sous-classes de l'erreur de
        parsing PDF côté middleware.
        """
        from app.middleware.error_handler import PDFCorruptedError, PDFParseError

        with pytest.raises((PDFCorruptedError, PDFParseError)):
            engine.open_document(b"this is not a pdf")

    def test_get_document_after_open(self, engine, real_pdf_bytes):
        """get_document retourne un proxy pour un doc ouvert."""
        document_id, original_proxy = engine.open_document(real_pdf_bytes)

        proxy = engine.get_document(document_id)

        assert isinstance(proxy, LegacyDocumentProxy)
        assert proxy.page_count == 3

    def test_get_document_unknown_id_raises_key_error(self, engine):
        """get_document lève KeyError pour un document_id inconnu."""
        with pytest.raises(KeyError, match="Document not found"):
            engine.get_document("nonexistent-uuid-1234")

    def test_close_document_removes_from_store(self, engine, real_pdf_bytes):
        """close_document retire le document de _documents."""
        document_id, _ = engine.open_document(real_pdf_bytes)
        assert document_id in engine._documents

        engine.close_document(document_id)

        assert document_id not in engine._documents

    def test_single_page_pdf_dimensions(self, engine, single_page_pdf_bytes):
        """PDF A4 single-page : 595 x 842."""
        document_id, _ = engine.open_document(single_page_pdf_bytes)

        dims = engine.get_all_page_dimensions(document_id)

        assert len(dims) == 1
        assert dims[0]["width"] == pytest.approx(595.0)
        assert dims[0]["height"] == pytest.approx(842.0)


# ---------------------------------------------------------------------------
# Class: PDFEngine page operations persist bytes
# ---------------------------------------------------------------------------

class TestPDFEnginePageOperations:
    """
    Tests que delete/add/rotate/reorder modifient vraiment _documents.

    Ces tests valident l'intégrité du store interne en réouvrant le PDF
    avec pikepdf après chaque opération.
    """

    def test_delete_page_reduces_count(self, engine, real_pdf_bytes):
        """delete_page(doc_id, 2) passe de 3 à 2 pages."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        engine.delete_page(document_id, 2)

        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as pdf:
            assert len(pdf.pages) == 2

    def test_delete_all_but_one_page(self, engine, real_pdf_bytes):
        """Supprimer 2 pages laisse 1 page."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        engine.delete_page(document_id, 3)
        engine.delete_page(document_id, 2)

        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as pdf:
            assert len(pdf.pages) == 1

    def test_delete_page_out_of_range_raises(self, engine, real_pdf_bytes):
        """delete_page avec page_number hors limites lève IndexError."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        with pytest.raises(IndexError):
            engine.delete_page(document_id, 10)

    def test_add_page_increases_count(self, engine, real_pdf_bytes):
        """add_page insère une page vierge et incrémente le count."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        engine.add_page(document_id, 0)

        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as pdf:
            assert len(pdf.pages) == 4

    def test_add_page_returns_legacy_page_proxy(self, engine, real_pdf_bytes):
        """add_page retourne un LegacyPageProxy (pas un MagicMock)."""
        from app.core.pdf_engine import LegacyPageProxy

        document_id, _ = engine.open_document(real_pdf_bytes)

        page_proxy = engine.add_page(document_id, 0)

        assert isinstance(page_proxy, LegacyPageProxy)
        assert page_proxy.rect.width == pytest.approx(612.0)
        assert page_proxy.rect.height == pytest.approx(792.0)

    def test_rotate_page_sets_rotate_key(self, engine, real_pdf_bytes):
        """rotate_page(doc_id, 1, 90) inscrit /Rotate=90 sur la page 1."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        engine.rotate_page(document_id, 1, 90)

        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as pdf:
            rotate = int(pdf.pages[0].get("/Rotate", 0))
        assert rotate == 90

    def test_rotate_page_invalid_angle_raises(self, engine, real_pdf_bytes):
        """rotate_page avec angle invalide lève ValueError."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        with pytest.raises(ValueError, match="rotation must be"):
            engine.rotate_page(document_id, 1, 45)

    def test_rotate_page_180(self, engine, real_pdf_bytes):
        """Rotation 180° persistée correctement."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        engine.rotate_page(document_id, 2, 180)

        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as pdf:
            rotate = int(pdf.pages[1].get("/Rotate", 0))
        assert rotate == 180

    def test_rotate_page_out_of_range_raises(self, engine, real_pdf_bytes):
        """rotate_page sur une page inexistante lève IndexError."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        with pytest.raises(IndexError):
            engine.rotate_page(document_id, 99, 90)

    def test_reorder_pages_preserves_count(self, engine, real_pdf_bytes):
        """reorder_pages([2, 0, 1]) conserve 3 pages."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        engine.reorder_pages(document_id, [2, 0, 1])

        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as pdf:
            assert len(pdf.pages) == 3

    def test_reorder_pages_invalid_permutation_raises(self, engine, real_pdf_bytes):
        """reorder_pages avec une permutation invalide lève ValueError."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        with pytest.raises(ValueError):
            engine.reorder_pages(document_id, [0, 1, 5])  # index 5 invalid for 3 pages

    def test_chain_delete_add_rotate_reorder(self, engine, real_pdf_bytes):
        """Pipeline complet : delete → add → rotate → reorder → résultat cohérent."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        # Delete page 3 → 2 pages remain
        engine.delete_page(document_id, 3)
        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as p:
            assert len(p.pages) == 2

        # Add blank page at position 0 → 3 pages total
        engine.add_page(document_id, 0)
        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as p:
            assert len(p.pages) == 3

        # Rotate page 1 (0-indexed=0) by 90°
        engine.rotate_page(document_id, 1, 90)
        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as p:
            assert int(p.pages[0].get("/Rotate", 0)) == 90

        # Reorder: reverse
        engine.reorder_pages(document_id, [2, 1, 0])
        with pikepdf.open(io.BytesIO(engine._documents[document_id])) as p:
            assert len(p.pages) == 3

    def test_save_document_returns_valid_pdf_bytes(self, engine, real_pdf_bytes):
        """save_document retourne des bytes ouvrable par pikepdf."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        saved = engine.save_document(document_id)

        assert isinstance(saved, bytes)
        with pikepdf.open(io.BytesIO(saved)) as pdf:
            assert len(pdf.pages) == 3


# ---------------------------------------------------------------------------
# Class: PDFEngine metadata operations
# ---------------------------------------------------------------------------

class TestPDFEngineMetadata:
    """Tests des opérations de métadonnées."""

    def test_get_metadata_returns_dict_with_expected_keys(self, engine, real_pdf_bytes):
        """get_metadata retourne un dict avec les clés attendues."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        meta = engine.get_metadata(document_id)

        required_keys = {"title", "author", "subject", "keywords", "page_count", "is_encrypted"}
        assert required_keys.issubset(set(meta.keys()))

    def test_get_metadata_page_count(self, engine, real_pdf_bytes):
        """get_metadata.page_count == 3 pour un PDF 3 pages."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        meta = engine.get_metadata(document_id)

        assert meta["page_count"] == 3

    def test_get_metadata_is_encrypted_false(self, engine, real_pdf_bytes):
        """get_metadata.is_encrypted == False pour un PDF non chiffré."""
        document_id, _ = engine.open_document(real_pdf_bytes)

        meta = engine.get_metadata(document_id)

        assert meta["is_encrypted"] is False

    def test_set_metadata_does_not_corrupt_pdf(self, engine, real_pdf_bytes):
        """
        set_metadata() doit conserver un PDF valide dans _documents.

        Note : set_metadata() contient un bug de persistance connu — le titre
        défini via pdf.docinfo['/Title'] à l'intérieur du context manager
        open_metadata() n'est pas reflété dans get_metadata() sur certaines
        versions de pikepdf car open_metadata() est conçu pour le XMP et
        peut ne pas propager les changements docinfo.

        Ce test valide uniquement l'invariant minimal : le PDF en mémoire
        reste parseable après appel à set_metadata(). Le bug de persistance
        du titre est suivi séparément.
        """
        document_id, _ = engine.open_document(real_pdf_bytes)

        # Should not raise and should leave a valid PDF in the store
        engine.set_metadata(document_id, title="Integration Test Title", author="Test Author")

        saved = engine._documents[document_id]
        assert isinstance(saved, bytes)
        with pikepdf.open(io.BytesIO(saved)) as pdf:
            assert len(pdf.pages) == 3
