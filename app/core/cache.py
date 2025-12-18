"""
Redis cache for previews and sessions.

Provides caching layer for expensive operations like
page preview generation.
"""

import hashlib
import json
import logging
from typing import Any, Optional

import redis.asyncio as redis

from app.config import get_settings

logger = logging.getLogger(__name__)

# Global Redis client
_redis_client: Optional[redis.Redis] = None


async def get_redis() -> redis.Redis:
    """Get or create Redis client."""
    global _redis_client

    if _redis_client is None:
        settings = get_settings()
        _redis_client = redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=False,  # We handle binary data
        )

    return _redis_client


async def close_redis() -> None:
    """Close Redis connection."""
    global _redis_client

    if _redis_client is not None:
        await _redis_client.close()
        _redis_client = None

    logger.info("Redis connection closed")


class PreviewCache:
    """
    Cache for page preview images.

    Stores rendered page previews to avoid regeneration.
    """

    PREFIX = "preview"
    DEFAULT_TTL = 3600  # 1 hour

    def __init__(self, redis_client: redis.Redis):
        """Initialize cache with Redis client."""
        self.redis = redis_client

    def _make_key(
        self,
        document_id: str,
        page_number: int,
        dpi: int,
        format: str,
    ) -> str:
        """Generate cache key for preview."""
        return f"{self.PREFIX}:{document_id}:{page_number}:{dpi}:{format}"

    async def get(
        self,
        document_id: str,
        page_number: int,
        dpi: int,
        format: str,
    ) -> Optional[bytes]:
        """
        Get cached preview.

        Args:
            document_id: Document identifier.
            page_number: Page number.
            dpi: Resolution.
            format: Image format.

        Returns:
            Optional[bytes]: Cached image data or None.
        """
        key = self._make_key(document_id, page_number, dpi, format)
        try:
            data = await self.redis.get(key)
            if data:
                logger.debug(f"Preview cache hit: {key}")
            return data
        except Exception as e:
            logger.warning(f"Preview cache get error: {e}")
            return None

    async def set(
        self,
        document_id: str,
        page_number: int,
        dpi: int,
        format: str,
        data: bytes,
        ttl: Optional[int] = None,
    ) -> bool:
        """
        Cache preview data.

        Args:
            document_id: Document identifier.
            page_number: Page number.
            dpi: Resolution.
            format: Image format.
            data: Image bytes.
            ttl: Time to live in seconds.

        Returns:
            bool: True if cached successfully.
        """
        key = self._make_key(document_id, page_number, dpi, format)
        try:
            await self.redis.setex(key, ttl or self.DEFAULT_TTL, data)
            logger.debug(f"Preview cached: {key} ({len(data)} bytes)")
            return True
        except Exception as e:
            logger.warning(f"Preview cache set error: {e}")
            return False

    async def invalidate_document(self, document_id: str) -> int:
        """
        Invalidate all previews for a document.

        Args:
            document_id: Document identifier.

        Returns:
            int: Number of keys deleted.
        """
        pattern = f"{self.PREFIX}:{document_id}:*"
        try:
            keys = []
            async for key in self.redis.scan_iter(match=pattern):
                keys.append(key)

            if keys:
                deleted = await self.redis.delete(*keys)
                logger.info(f"Invalidated {deleted} preview cache entries for {document_id}")
                return deleted
            return 0
        except Exception as e:
            logger.warning(f"Preview cache invalidate error: {e}")
            return 0

    async def invalidate_page(
        self,
        document_id: str,
        page_number: int,
    ) -> int:
        """
        Invalidate all previews for a specific page.

        Args:
            document_id: Document identifier.
            page_number: Page number.

        Returns:
            int: Number of keys deleted.
        """
        pattern = f"{self.PREFIX}:{document_id}:{page_number}:*"
        try:
            keys = []
            async for key in self.redis.scan_iter(match=pattern):
                keys.append(key)

            if keys:
                deleted = await self.redis.delete(*keys)
                logger.info(f"Invalidated {deleted} preview cache entries for page {page_number}")
                return deleted
            return 0
        except Exception as e:
            logger.warning(f"Preview cache invalidate error: {e}")
            return 0


class SessionCache:
    """
    Cache for document session state.

    Stores session metadata for quick access.
    """

    PREFIX = "session"
    DEFAULT_TTL = 7200  # 2 hours

    def __init__(self, redis_client: redis.Redis):
        """Initialize cache with Redis client."""
        self.redis = redis_client

    def _make_key(self, document_id: str) -> str:
        """Generate cache key for session."""
        return f"{self.PREFIX}:{document_id}"

    async def get_metadata(self, document_id: str) -> Optional[dict]:
        """Get cached session metadata."""
        key = self._make_key(document_id)
        try:
            data = await self.redis.get(key)
            if data:
                return json.loads(data)
            return None
        except Exception as e:
            logger.warning(f"Session cache get error: {e}")
            return None

    async def set_metadata(
        self,
        document_id: str,
        metadata: dict,
        ttl: Optional[int] = None,
    ) -> bool:
        """Cache session metadata."""
        key = self._make_key(document_id)
        try:
            await self.redis.setex(
                key,
                ttl or self.DEFAULT_TTL,
                json.dumps(metadata),
            )
            return True
        except Exception as e:
            logger.warning(f"Session cache set error: {e}")
            return False

    async def delete(self, document_id: str) -> bool:
        """Delete cached session metadata."""
        key = self._make_key(document_id)
        try:
            await self.redis.delete(key)
            return True
        except Exception as e:
            logger.warning(f"Session cache delete error: {e}")
            return False

    async def touch(self, document_id: str, ttl: Optional[int] = None) -> bool:
        """Extend session TTL."""
        key = self._make_key(document_id)
        try:
            await self.redis.expire(key, ttl or self.DEFAULT_TTL)
            return True
        except Exception as e:
            logger.warning(f"Session cache touch error: {e}")
            return False


class RateLimiter:
    """
    Rate limiting using Redis.

    Implements sliding window rate limiting.
    """

    PREFIX = "ratelimit"

    def __init__(self, redis_client: redis.Redis):
        """Initialize rate limiter with Redis client."""
        self.redis = redis_client

    async def is_allowed(
        self,
        key: str,
        limit: int,
        window_seconds: int,
    ) -> tuple[bool, int, int]:
        """
        Check if request is allowed under rate limit.

        Args:
            key: Rate limit key (e.g., user_id or IP).
            limit: Maximum requests in window.
            window_seconds: Time window in seconds.

        Returns:
            tuple: (is_allowed, remaining, reset_in_seconds)
        """
        full_key = f"{self.PREFIX}:{key}"

        try:
            # Get current count
            pipe = self.redis.pipeline()
            pipe.incr(full_key)
            pipe.ttl(full_key)
            results = await pipe.execute()

            count = results[0]
            ttl = results[1]

            # Set expiry on first request
            if ttl == -1:
                await self.redis.expire(full_key, window_seconds)
                ttl = window_seconds

            remaining = max(0, limit - count)
            is_allowed = count <= limit

            return is_allowed, remaining, ttl

        except Exception as e:
            logger.warning(f"Rate limiter error: {e}")
            # Fail open on error
            return True, limit, window_seconds

    async def reset(self, key: str) -> bool:
        """Reset rate limit for a key."""
        full_key = f"{self.PREFIX}:{key}"
        try:
            await self.redis.delete(full_key)
            return True
        except Exception as e:
            logger.warning(f"Rate limiter reset error: {e}")
            return False


# Helper functions to get cache instances
async def get_preview_cache() -> PreviewCache:
    """Get preview cache instance."""
    redis_client = await get_redis()
    return PreviewCache(redis_client)


async def get_session_cache() -> SessionCache:
    """Get session cache instance."""
    redis_client = await get_redis()
    return SessionCache(redis_client)


async def get_rate_limiter() -> RateLimiter:
    """Get rate limiter instance."""
    redis_client = await get_redis()
    return RateLimiter(redis_client)
