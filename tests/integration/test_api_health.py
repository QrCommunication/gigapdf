"""
Integration tests for health check endpoint.
"""

import pytest
from fastapi.testclient import TestClient


class TestHealthEndpoint:
    """Tests for the health check endpoint."""

    def test_health_returns_200(self, client: TestClient):
        """Test that health endpoint returns 200."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_returns_correct_structure(self, client: TestClient):
        """Test that health endpoint returns correct structure."""
        response = client.get("/health")
        data = response.json()

        assert "status" in data
        assert "version" in data
        assert "service" in data

    def test_health_returns_healthy_status(self, client: TestClient):
        """Test that health endpoint returns healthy status."""
        response = client.get("/health")
        data = response.json()

        assert data["status"] == "healthy"
        assert data["service"] == "giga-pdf"
