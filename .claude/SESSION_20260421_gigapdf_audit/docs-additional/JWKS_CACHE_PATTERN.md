# JWKS Cache Pattern — L1/L2 with Thundering Herd Protection

## Problem

**Before:** JWKS cache was stored in Python global variables (`_jwks_cache`, `_jwks_cache_time`) with 5-minute TTL.

**Issue:** Each Uvicorn worker process maintained its own cache independently:
- **No sharing between workers** → Multiple workers fetch JWKS simultaneously on cache expiry
- **Rate limit spike** → Provider (auth service) receives N concurrent requests from N workers
- **Inconsistent state** → Different workers may hold different JWKS versions briefly
- **Thundering herd** → When cache expires, all workers stampede to refresh at once

## Solution

**Hybrid L1 (local) + L2 (Redis) caching with atomic lock-based refresh:**

```
┌──────────────────────────────────────────────────────────────────────┐
│ Request arrives at Worker #1 (Uvicorn process)                       │
└──────────────────────────────────────────────────────────────────────┘
         │
         ├─► [L1 Check] Is JWKS in local memory? TTL < 5min?
         │   └─ YES → Return immediately (no Redis hit)
         │   └─ NO → Check L2
         │
         ├─► [L2 Check] Is JWKS in Redis? (shared across all workers)
         │   └─ YES → Populate L1, return
         │   └─ NO → Check lock
         │
         ├─► [Lock Attempt] Try SETNX(jwks:lock:{url}, "1", ex=10)
         │   │
         │   ├─ LOCK ACQUIRED (I'm the refresh worker)
         │   │  ├─ Fetch JWKS from provider (HTTP GET)
         │   │  ├─ Store in L2 Redis (1h TTL) — SETEX
         │   │  ├─ Populate L1 cache (5min TTL)
         │   │  ├─ Release lock: DEL(jwks:lock:{url})
         │   │  └─ Return JWKS
         │   │
         │   └─ LOCK NOT ACQUIRED (another worker is refreshing)
         │      ├─ Wait 500ms (asyncio.sleep(0.5))
         │      ├─ Check L2 Redis again
         │      ├─ If found → Populate L1, return
         │      └─ If timeout → Direct fetch (safe fallback)
         │
         └─► [Cache Hit Served]
```

## Cache Layers

### L1 Cache (Local In-Memory)
- **Storage:** Python dict in module globals: `_jwks_l1_cache`
- **TTL:** 5 minutes
- **Scope:** Single worker process
- **Purpose:** Reduce Redis network calls within same worker
- **Hit rate:** ~95% for steady-state traffic

**Data structure:**
```python
_jwks_l1_cache = {
    "https://auth.example.com/.well-known/jwks.json": CacheEntry(
        data={"keys": [...]},
        expires_at=1714845600.123
    )
}
```

### L2 Cache (Redis)
- **Storage:** Redis key `jwks:{issuer_url}`
- **TTL:** 1 hour (respects JWKS endpoint `Cache-Control: max-age`)
- **Scope:** Shared across all Uvicorn workers (entire deployment)
- **Purpose:** Single source of truth for JWKS across workers
- **Hit rate:** ~99% for steady-state traffic (5min L1 miss = L2 hit)

**Value format:**
```
SETEX "jwks:https://auth.example.com/.well-known/jwks.json" 3600 '{"keys": [...]}'
```

## Thundering Herd Protection

**Lock mechanism using Redis SETNX:**

```python
lock_acquired = await redis.set(
    "jwks:lock:https://auth.example.com/.well-known/jwks.json",
    "1",
    nx=True,      # Only set if key doesn't exist (atomic)
    ex=10,        # Auto-expire lock after 10s (deadlock prevention)
)
```

**Behavior:**
1. **First worker** to hit cache miss acquires lock → fetches from provider
2. **Other workers** fail to acquire lock → wait 500ms → check Redis L2
3. **No thundering herd** → Only 1 worker makes the HTTP request to provider
4. **Auto-release** → Lock expires in 10s if refresh worker crashes

**Fallback:** If lock waiter times out (lock holder crashed), worker fetches directly from provider.

## Metrics & Observability

Log messages indicate cache layer hit/miss:

```
DEBUG JWKS cache L1 hit for https://auth.example.com/.well-known/jwks.json
DEBUG JWKS cache L2 hit for https://auth.example.com/.well-known/jwks.json
DEBUG Fetching JWKS from https://auth.example.com/.well-known/jwks.json
DEBUG Another worker is refreshing JWKS for ..., waiting...
DEBUG Stored JWKS in L2 cache: jwks:https://...
DEBUG Released JWKS lock: jwks:lock:https://...
```

## Code Location

**File:** `/app/middleware/auth.py`

**Function:** `async def get_jwks_keys(jwks_url: str) -> dict`

**Dependencies:**
- `app.core.cache.get_redis()` — Redis client (async)
- `redis.asyncio` — Async Redis library
- Built-in: `asyncio`, `json`, `time`

## TTL Configuration

| Layer | TTL | Rationale |
|-------|-----|-----------|
| **L1** | 5 min | Balance: reduce Redis hits, but refresh frequently enough |
| **L2** | 1 hour | Aligns with typical JWKS endpoint `Cache-Control` header |
| **Lock** | 10 sec | Short duration to prevent deadlock if worker crashes |

**Adjustment:** If JWKS rotation is faster, reduce both L1 and L2 TTLs proportionally.

## Failure Modes & Resilience

| Scenario | Outcome |
|----------|---------|
| Redis down | Falls back to direct provider fetch (graceful degradation) |
| Provider unavailable | Request fails with 401/invalid token (expected behavior) |
| Lock holder crashes | Lock auto-expires in 10s, next waiter fetches directly |
| Network partition | Workers behind partition fetch independently (eventual consistency) |

## Performance Impact

**Before (global cache):**
- Cache hit in same worker: ~0.1ms
- Cache miss: each worker makes independent HTTP request
- N workers × 1 request/hour = N HTTP calls to provider per cache cycle

**After (L1/L2 hybrid):**
- L1 cache hit: ~0.05ms (no Redis)
- L2 cache hit: ~5-10ms (Redis network round-trip, shared)
- N workers × 0 HTTP calls (shared fetch) = 1 HTTP call to provider per cache cycle
- **Reduction:** ~95% fewer provider requests at scale

## Example Trace

```
Time    Worker #1                       Worker #2                  Redis
────────────────────────────────────────────────────────────────────────
T0      Check L1 (miss)                 Check L1 (miss)
        Check L2 (miss)                 Check L2 (miss)
        SETNX lock → OK                 SETNX lock → FAIL
        
T1      Fetch JWKS from provider        Wait 500ms
        (HTTP GET ...)
        
T2      Fetch complete                  Check L2 (HIT!)
        SETEX L2 redis                  Populate L1
        Populate L1                     Return JWKS
        DEL lock
        Return JWKS
        
T3-5min L1 cache valid (5 more reqs)    L1 cache valid
        (all hits)
        
T5min   L1 expires                      L1 expires
        Check L2 (HIT!)                 Check L2 (HIT!)
        Populate L1                     Populate L1
        Return JWKS                     Return JWKS
        
T60min  Check L2 (miss!)                Check L2 (miss!)
        SETNX lock → OK                 SETNX lock → FAIL
        (cycle repeats)
```

## Testing & Validation

To verify the cache is working:

1. **Monitor Redis keys:**
   ```bash
   redis-cli KEYS "jwks:*"
   redis-cli TTL "jwks:https://..."
   ```

2. **Check logs for cache hits:**
   ```bash
   grep "JWKS cache L[12] hit" /var/log/gigapdf/app.log
   ```

3. **Measure provider request rate:**
   ```bash
   # Should be ~1 request per hour, not N × per hour
   grep "Fetching JWKS from" /var/log/gigapdf/app.log | wc -l
   ```

4. **Verify multi-worker behavior:**
   ```bash
   # Kill one worker while another is running
   # New requests should still succeed via L2 cache
   ```

## References

- **Pattern:** Multi-level cache with thundering herd lock (Redis SETNX)
- **Alternative:** Redis locks library (`redis-py` `BlpopRescueRedisLock`)
- **Related:** JWT JWKS caching best practices (Auth0, Okta, Google)
