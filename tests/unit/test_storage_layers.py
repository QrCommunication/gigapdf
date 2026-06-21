"""
Unit tests for the document-layers persistence building blocks.

No DB / S3 / network — pure model + schema checks:
- DocumentLayers SQLAlchemy model: table shape, 1:1 FK (CASCADE, UNIQUE).
- DocumentLayersData Pydantic schema: permissive defaults + round-trip.
- _DEFAULT_LAYERS_DATA: the empty fallback returned when no row exists.
"""

import pytest

from app.api.v1.storage import DocumentLayersData, _DEFAULT_LAYERS_DATA
from app.models.database import DocumentLayers


class TestDocumentLayersModel:
    """The SQLAlchemy model mirrors the 023 migration."""

    def test_table_name(self):
        assert DocumentLayers.__tablename__ == "document_layers"

    def test_has_expected_columns(self):
        cols = set(DocumentLayers.__table__.columns.keys())
        assert {
            "id",
            "stored_document_id",
            "data",
            "created_at",
            "updated_at",
        } <= cols

    def test_stored_document_id_is_unique_one_to_one(self):
        # UNIQUE enforces the 1:1 relationship with stored_documents.
        assert DocumentLayers.__table__.c.stored_document_id.unique is True

    def test_fk_targets_stored_documents_with_cascade(self):
        fks = list(DocumentLayers.__table__.c.stored_document_id.foreign_keys)
        assert len(fks) == 1
        fk = fks[0]
        assert fk.column.table.name == "stored_documents"
        assert fk.ondelete == "CASCADE"

    def test_data_column_is_not_nullable(self):
        assert DocumentLayers.__table__.c.data.nullable is False


class TestDocumentLayersData:
    """The opaque-ish editor-layers schema is permissive but well-typed."""

    def test_defaults_to_empty_layers_and_membership(self):
        data = DocumentLayersData()
        assert data.layers == []
        assert data.membership == {}

    def test_accepts_arbitrary_layer_objects(self):
        blob = {
            "layers": [
                {"id": "layer-1", "name": "Background", "visible": True, "extra": 42},
            ],
            "membership": {"elem-a": "layer-1", "elem-b": "layer-1"},
        }
        data = DocumentLayersData(**blob)
        assert data.model_dump() == blob

    def test_membership_values_are_coerced_to_strings(self):
        # dict[str, str] — keys/values are layer/element IDs (strings).
        data = DocumentLayersData(membership={"elem-a": "layer-1"})
        assert data.membership == {"elem-a": "layer-1"}

    def test_rejects_non_list_layers(self):
        with pytest.raises(Exception):
            DocumentLayersData(layers="not-a-list")


class TestDefaultBlob:
    def test_default_blob_shape(self):
        assert _DEFAULT_LAYERS_DATA == {"layers": [], "membership": {}}
