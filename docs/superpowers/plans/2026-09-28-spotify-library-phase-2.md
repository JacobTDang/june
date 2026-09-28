# Spotify Library, Phase 2 (Play from the Library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Songs in a user's Spotify library get matched to playable videos through mp3server in the background, and a Library tab in a room's add-music panel queues them (one song, or a whole playlist).

**Architecture:**
- **mp3server:** accepts a shared service token on its import routes and a new `POST /match`. It returns each matched video's own length, and paces bulk searches to one every 3 seconds.
- **june's sync run** ends with a matching step. It collects finished import jobs into `songs`, then submits up to 500 pending songs as one new import.
- **Rooms** read matched songs and queue them with the matched video's length. A click on an unmatched song matches it on the spot through `/match`.

**Tech Stack:**
- **june:** Next.js 16 (server actions), React 19, TypeScript strict, Zod 4, Supabase (RLS, `SECURITY DEFINER` functions), Vitest.
- **mp3server:** FastAPI, SQLAlchemy async, Alembic, arq, yt-dlp, pytest.

**Spec:** `docs/superpowers/specs/2026-09-25-spotify-library-design.md`, sections "Matching (phase 2)" and "Playing in rooms (phase 2)". Phase 3 (keeping audio at home) has its own plan.

## Global Constraints

- **Two repos.** Tasks 1–4 are in `/Users/jacobdang/Projects/mp3server`, on branch `library-matching` created from `main`. Tasks 5–12 are in `/Users/jacobdang/Projects/june`, on branch `library-matching` (it holds this plan). Task 13 ships both.
- **No new dependencies** in either repo.
- **The june Supabase project serves dev and prod.** Applying a migration there is a production change; this plan's is additive.
- **Production audio is the homelab VM**, published at `https://june-audio.taild5ebc0.ts.net`. Oracle (`june-audio.duckdns.org`) is a cold standby and is not deployed to.
- **Service token names:** `SERVICE_TOKEN` in mp3server's `.env`; `MP3SERVER_SERVICE_TOKEN` in june (server-only). Both hold the same value, at least 32 characters (`openssl rand -hex 32`).
- **The service token works only on:** `POST /imports`, `GET /imports/{id}` and `POST /match`. Every other mp3server route still requires a Supabase JWT.
- **Search pacing:** at most one resolver search every 3 seconds (`resolve_min_interval_s = 3.0`). The resolver runs one job at a time. Cache hits don't wait.
- **Batches:** at most 500 songs per import (`MATCH_BATCH_LIMIT = 500`, matching mp3server's `import_max_tracks`).
- **`/match` timeout from june:** 20 seconds.
- **The room clock needs the audio's length.** A queued library song uses `songs.video_duration_ms`, never Spotify's `duration_ms`. A match without a video length is not playable.
- **Row copy, verbatim:** " · matching…" for pending/matching, " · no match found" for not_found/failed, " · ?" for low-confidence matches.
- **june tests:** Vitest under `test/`, relative imports, `fetch` injected, no network. Mock data only in tests. Pure modules never import `server-only`, `next/*` or a Supabase client. IO modules start with `import "server-only";`, except `"use server"` action modules.
- **mp3server tests:** `.venv/bin/pytest`, with the fixtures in `tests/conftest.py` (in-memory SQLite, `FakeQueue`, `FakeYDL`). Network tests stay behind `-m network`.
- **CSS uses the scales:** `test/design/tokens.test.ts` fails on any font-size, spacing, weight, tracking or leading that isn't a `var(--…)` scale token.
- **Fail loud.** Every caught error is recorded where the user sees it, or logged with `console.error` / `logger.error`. No empty `catch`.
- **Commits:** a plain descriptive message covering what changed and why. Never mention Claude; no `Co-Authored-By` line. Push after every commit.

---

### Task 1 (mp3server): A service token for imports

**Files:**
- Modify: `src/mp3server/config.py`, `src/mp3server/auth.py`, `src/mp3server/routes/imports.py`, `tests/conftest.py`, `.env.example`
- Test: `tests/test_service_token.py`

**Interfaces:**
- Produces:
  - `Settings.service_token: str | None`: blank means unset; shorter than 32 characters is rejected.
  - `auth.SERVICE_PRINCIPAL: uuid.UUID`.
  - `auth.is_service_token(presented: str, configured: str | None) -> bool`.
  - `auth.get_import_caller(request: Request) -> uuid.UUID`: a FastAPI dependency.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/jacobdang/Projects/mp3server
git checkout main && git pull
git checkout -b library-matching
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_service_token.py`:

```python
import uuid

import pytest
from sqlalchemy import select

from mp3server.auth import SERVICE_PRINCIPAL, is_service_token
from mp3server.config import Settings
from mp3server.models import Job, JobKind

TOKEN = "t" * 40
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def body():
    return {"tracks": [{"title": "Glory Box", "artist": "Portishead", "duration_ms": 305_000}]}


@pytest.fixture
def service_settings(settings):
    settings.service_token = TOKEN
    return settings


async def test_the_service_token_can_create_and_read_an_import(client, service_settings):
    created = await client.post("/imports", json=body(), headers=HEADERS)
    assert created.status_code == 202
    read = await client.get(f"/imports/{created.json()['id']}", headers=HEADERS)
    assert read.status_code == 200


async def test_an_import_made_with_the_service_token_belongs_to_the_service_principal(
    client, service_settings, db
):
    await client.post("/imports", json=body(), headers=HEADERS)
    parent = await db.scalar(select(Job).where(Job.kind == JobKind.IMPORT))
    assert parent.user_id == SERVICE_PRINCIPAL


async def test_a_wrong_service_token_is_refused(client, service_settings):
    response = await client.post(
        "/imports", json=body(), headers={"Authorization": "Bearer " + "x" * 40}
    )
    assert response.status_code == 401


async def test_the_service_token_is_refused_when_none_is_configured(client, settings):
    settings.service_token = None
    response = await client.post("/imports", json=body(), headers=HEADERS)
    assert response.status_code == 401


async def test_the_service_token_opens_no_other_route(client, service_settings):
    job_id = uuid.uuid4()
    assert (await client.get("/downloads", headers=HEADERS)).status_code == 401
    assert (
        await client.post("/downloads", json={"url": "https://youtu.be/dQw4w9WgXcQ"}, headers=HEADERS)
    ).status_code == 401
    assert (await client.post("/files/by-video/abc/link", headers=HEADERS)).status_code == 401
    assert (await client.delete(f"/imports/{job_id}", headers=HEADERS)).status_code == 401
    assert (
        await client.get("/imports/spotify", params={"url": "x"}, headers=HEADERS)
    ).status_code == 401


def test_is_service_token():
    assert is_service_token(TOKEN, TOKEN)
    assert not is_service_token("y" * 40, TOKEN)
    assert not is_service_token(TOKEN, None)


def test_a_short_service_token_is_rejected():
    with pytest.raises(ValueError, match="at least 32"):
        Settings(
            _env_file=None,
            database_url="sqlite+aiosqlite://",
            supabase_jwt_secret="s",
            service_token="short",
        )


def test_a_blank_service_token_means_unset():
    settings = Settings(
        _env_file=None,
        database_url="sqlite+aiosqlite://",
        supabase_jwt_secret="s",
        service_token="  ",
    )
    assert settings.service_token is None
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `.venv/bin/pytest tests/test_service_token.py -q`
Expected: FAIL, with `ImportError: cannot import name 'SERVICE_PRINCIPAL'`.

- [ ] **Step 4: Write the implementation**

In `src/mp3server/config.py`, add the field after `cors_allow_origins`:

```python
    # Shared with june's server so its background library matching can submit
    # and read imports, where no user token exists. Only the routes that
    # depend on get_import_caller accept it. Unset disables it.
    service_token: str | None = None
```

Add `"service_token"` to the `_blank_means_unset` validator's field list:

```python
    @field_validator(
        "supabase_jwt_secret", "supabase_url", "download_link_secret", "cookies_file",
        "service_token",
        mode="before",
    )
```

Add a validator after `_reject_malformed_user_ids`:

```python
    @field_validator("service_token")
    @classmethod
    def _reject_a_weak_service_token(cls, raw: str | None) -> str | None:
        if raw is not None and len(raw) < 32:
            raise ValueError("SERVICE_TOKEN must be at least 32 characters")
        return raw
```

In `src/mp3server/auth.py`, add `import hmac` to the imports, and append:

```python
# The identity june's server acts as. A fixed UUID that is not a Supabase user
# id, so it can never collide with one, and jobs it creates are easy to spot.
SERVICE_PRINCIPAL = uuid.UUID("00000000-0000-4000-8000-00000000a001")


def is_service_token(presented: str, configured: str | None) -> bool:
    """Constant-time comparison with the configured service token."""
    return configured is not None and hmac.compare_digest(
        presented.encode(), configured.encode()
    )


async def get_import_caller(request: Request) -> uuid.UUID:
    """A signed-in june user, or june's own server presenting SERVICE_TOKEN.

    Only the import and match routes depend on this. Everything else keeps
    get_current_user_id, so the service token can't mint stream links or
    touch downloads.
    """
    creds: HTTPAuthorizationCredentials | None = await _bearer(request)
    if creds is not None and is_service_token(
        creds.credentials, request.app.state.settings.service_token
    ):
        return SERVICE_PRINCIPAL
    return await get_current_user_id(request)
```

In `src/mp3server/routes/imports.py`, change the auth import to:

```python
from mp3server.auth import get_current_user_id, get_import_caller
```

Change `create_import` and `get_import`, and only those two, to depend on it:

```python
    user_id: uuid.UUID = Depends(get_import_caller),
```

`preview_spotify_playlist` and `cancel_import` keep `Depends(get_current_user_id)`.

In `tests/conftest.py`, the `authed` fixture must override both dependencies, because `get_import_caller` calls `get_current_user_id` directly rather than through `Depends`:

```python
from mp3server.auth import get_current_user_id, get_import_caller
```

```python
@pytest.fixture
def authed(app, user_id):
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    app.dependency_overrides[get_import_caller] = lambda: user_id
    yield user_id
    app.dependency_overrides.pop(get_current_user_id, None)
    app.dependency_overrides.pop(get_import_caller, None)
```

In `.env.example`, add after the `DOWNLOAD_LINK_TTL_SECONDS` line:

```bash

# Shared with june's server (as MP3SERVER_SERVICE_TOKEN) for background library
# matching. Accepted only by POST /imports, GET /imports/{id} and POST /match.
# At least 32 characters: openssl rand -hex 32. Empty disables it.
SERVICE_TOKEN=
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `.venv/bin/pytest tests/test_service_token.py -q`
Expected: PASS, 8 tests.

Run: `.venv/bin/pytest -q`
Expected: every test passes, including the existing `tests/test_api_imports.py`.

- [ ] **Step 6: Commit**

```bash
git add src/mp3server/config.py src/mp3server/auth.py src/mp3server/routes/imports.py tests/conftest.py tests/test_service_token.py .env.example
git commit -m "Accept a service token on the import routes

june's server matches users' Spotify libraries in the background, where
there is no user token. A shared SERVICE_TOKEN now opens POST /imports and
GET /imports/{id} as a fixed service principal; every other route still
needs a Supabase JWT."
git push -u origin library-matching
```

---

### Task 2 (mp3server): Return the matched video's length

**Files:**
- Create: `migrations/versions/0005_matched_duration.py`
- Modify: `src/mp3server/matching.py`, `src/mp3server/models.py`, `src/mp3server/jobs/imports.py`, `src/mp3server/worker.py`, `src/mp3server/routes/imports.py`
- Test: `tests/test_matching.py`, `tests/test_worker_resolve.py`, `tests/test_api_imports.py` (additions)

**Interfaces:**
- Produces:
  - `matching.Match` gains `duration_ms: int | None`.
  - `ImportTrack.matched_duration_ms: int | None`.
  - `jobs.imports.CachedResolution(video_id, matched_title, confidence, matched_duration_ms)`.
  - `jobs.imports.find_cached_resolution(db: AsyncSession, key: str) -> CachedResolution | None`.
  - `TrackState.matched_duration_ms: int | None` in `GET /imports/{id}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_matching.py`:

```python
def test_a_match_carries_the_videos_own_length():
    album = matching.Candidate("album", "Glory Box", "Portishead", 306)
    assert matching.pick_candidate([album], 305_000, "Portishead").duration_ms == 306_000


def test_a_match_with_no_known_length_says_so():
    bare = matching.Candidate("v", "T", "X", None)
    assert matching.pick_candidate([bare], None, "X").duration_ms is None
```

If `tests/test_matching.py` doesn't already `from mp3server import matching`, add that import.

Append to `tests/test_worker_resolve.py`:

```python
async def test_resolve_track_stores_the_matched_videos_length(ctx, db, settings, user_id, monkeypatch):
    _, child_id = await make_import(
        db, settings, user_id, TrackRequest("Glory Box", "Portishead", 305_000)
    )
    monkeypatch.setattr(
        worker.ytdl, "search",
        lambda q, limit, cookies, proxy=None: [Candidate("album", "Glory Box", "Portishead", 306)],
    )
    await worker.resolve_track(ctx, str(child_id))
    row = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == child_id))
    assert row.matched_duration_ms == 306_000


async def test_a_cached_resolution_without_a_length_is_searched_again(
    ctx, db, settings, user_id, monkeypatch
):
    _, first = await make_import(
        db, settings, user_id, TrackRequest("Glory Box", "Portishead", 305_000)
    )
    monkeypatch.setattr(
        worker.ytdl, "search",
        lambda q, limit, cookies, proxy=None: [Candidate("album", "Glory Box", "Portishead", 306)],
    )
    await worker.resolve_track(ctx, str(first))
    # As it would have been stored before lengths were kept.
    old = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == first))
    old.matched_duration_ms = None
    await db.commit()

    searched = []

    def fake_search(q, limit, cookies, proxy=None):
        searched.append(q)
        return [Candidate("album", "Glory Box", "Portishead", 306)]

    monkeypatch.setattr(worker.ytdl, "search", fake_search)
    _, second = await make_import(
        db, settings, user_id, TrackRequest("Glory Box", "Portishead", 305_000)
    )
    await worker.resolve_track(ctx, str(second))

    assert searched == ["Portishead Glory Box"]
    again = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == second))
    assert again.matched_duration_ms == 306_000
```

Append to `tests/test_api_imports.py`:

```python
async def test_get_import_reports_the_matched_length(client, authed, db):
    created = (await client.post("/imports", json=body(1))).json()
    rows = await imports_route.service.get_import_rows(db, uuid.UUID(created["id"]))
    job, track = rows[0]
    job.status = JobStatus.COMPLETED
    job.video_id = "v1"
    track.matched_duration_ms = 200_500
    await db.commit()

    payload = (await client.get(f"/imports/{created['id']}")).json()
    assert payload["tracks"][0]["matched_duration_ms"] == 200_500
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `.venv/bin/pytest tests/test_matching.py tests/test_worker_resolve.py tests/test_api_imports.py -q`
Expected: FAIL. `Match` has no `duration_ms`, and `ImportTrack` has no `matched_duration_ms`.

- [ ] **Step 3: Write the implementation**

In `src/mp3server/matching.py`, add the field to `Match`:

```python
@dataclass(frozen=True)
class Match:
    video_id: str
    title: str
    confidence: str
    # The video's own length. Whoever plays it times playback by this, not by
    # the length the source named, which can be a few seconds off.
    duration_ms: int | None
```

Add a helper above `pick_candidate`:

```python
def _length_ms(candidate: Candidate) -> int | None:
    if candidate.duration_seconds is None:
        return None
    return candidate.duration_seconds * 1000
```

The two `Match(...)` constructions in `pick_candidate` become:

```python
        return Match(
            video_id=best.video_id, title=best.title, confidence=LOW,
            duration_ms=_length_ms(best),
        )
```

```python
    return Match(
        video_id=best.video_id, title=best.title, confidence=confidence,
        duration_ms=_length_ms(best),
    )
```

In `src/mp3server/models.py`, add to `ImportTrack` after `confidence`:

```python
    # the matched video's own length; null only on rows written before it
    # was kept, which the resolution cache then refuses to reuse
    matched_duration_ms: Mapped[int | None] = mapped_column(Integer)
```

Create `migrations/versions/0005_matched_duration.py`:

```python
"""the matched video's own length, so a client can time playback by the audio"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "import_tracks", sa.Column("matched_duration_ms", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("import_tracks", "matched_duration_ms")
```

In `src/mp3server/jobs/imports.py`, append:

```python
@dataclass(frozen=True)
class CachedResolution:
    video_id: str
    matched_title: str | None
    confidence: str | None
    matched_duration_ms: int


async def find_cached_resolution(db: AsyncSession, key: str) -> CachedResolution | None:
    """The newest completed resolution for a norm_key, if one can be reused.

    An empty key is never looked up: norm_key returns "" when a pair can't be
    normalized safely, and every such track shares it, so a hit would hand back
    an unrelated song. Only completed resolutions count (a miss must be retried,
    not remembered). A resolution with no recorded length counts as a miss:
    without it a client can't time playback, so the track is searched again
    and the answer fills in.
    """
    if not key:
        return None
    row = (
        await db.execute(
            select(
                Job.video_id,
                ImportTrack.matched_title,
                ImportTrack.confidence,
                ImportTrack.matched_duration_ms,
            )
            .join(ImportTrack, ImportTrack.job_id == Job.id)
            .where(
                ImportTrack.norm_key == key,
                Job.status == JobStatus.COMPLETED,
                Job.video_id.is_not(None),
                ImportTrack.matched_duration_ms.is_not(None),
            )
            .order_by(Job.finished_at.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    video_id, matched_title, confidence, matched_duration_ms = row
    return CachedResolution(video_id, matched_title, confidence, matched_duration_ms)
```

In `src/mp3server/worker.py`, import it:

```python
from mp3server.jobs.imports import find_cached_resolution
```

In `resolve_track`, replace everything from the comment `# An empty key means the pair could not be normalized safely` through the end of the `cached = (...)` lookup with:

```python
        cached = await find_cached_resolution(db, key)
```

Replace the `if cached is not None:` block after the `async with` with:

```python
    if cached is not None:
        await _complete_resolution(
            session_factory, jid, cached.video_id, cached.matched_title,
            cached.confidence, cached.matched_duration_ms,
        )
        logger.info("job %s resolved from cache (%s)", job_id, cached.video_id)
        return
```

The final `_complete_resolution` call becomes:

```python
    await _complete_resolution(
        session_factory, jid, match.video_id, match.title, match.confidence,
        match.duration_ms,
    )
```

`_complete_resolution` takes and stores the length:

```python
async def _complete_resolution(
    session_factory, jid: uuid.UUID, video_id: str,
    matched_title: str | None, confidence: str | None,
    matched_duration_ms: int | None,
) -> None:
    async with session_factory() as db:
        job = await _require_job(db, jid)
        job.video_id = video_id
        job.status = JobStatus.COMPLETED
        job.progress = 100
        job.finished_at = utcnow()
        track = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == jid))
        if track is not None:
            track.matched_title = matched_title
            track.confidence = confidence
            track.matched_duration_ms = matched_duration_ms
        await db.commit()
        await finalize_parent(db, job.parent_id)
```

In `src/mp3server/routes/imports.py`, add to `TrackState`:

```python
    matched_duration_ms: int | None = None
```

In `_status_for`, pass it:

```python
                matched_duration_ms=track.matched_duration_ms,
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `.venv/bin/pytest -q`
Expected: every test passes, including the five new ones.

Then check the migration chain loads:

Run: `.venv/bin/python -c "from alembic.config import Config; from alembic.script import ScriptDirectory; print(ScriptDirectory.from_config(Config('alembic.ini')).get_current_head())"`
Expected: `0005`

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/matching.py src/mp3server/models.py src/mp3server/jobs/imports.py src/mp3server/worker.py src/mp3server/routes/imports.py migrations/versions/0005_matched_duration.py tests/test_matching.py tests/test_worker_resolve.py tests/test_api_imports.py
git commit -m "Report each matched video's own length

A client queueing a matched track times playback by the audio, and a
source's length can be a few seconds off. The resolver stores the chosen
video's length (migration 0005), GET /imports returns it, and a cached
resolution recorded before lengths were kept counts as a miss so the track
is searched again."
git push
```

---

### Task 3 (mp3server): Pace the resolver's searches

**Files:**
- Create: `src/mp3server/pacing.py`
- Modify: `src/mp3server/config.py`, `src/mp3server/worker.py`, `tests/test_worker_resolve.py`, `tests/test_api_imports.py`, `tests/test_network_smoke.py`, `.env.example`
- Test: `tests/test_pacing.py`, plus additions to `tests/test_worker_resolve.py`

**Interfaces:**
- Produces:
  - `pacing.SearchPacer(interval_s: float, clock=time.monotonic, sleep=asyncio.sleep)`, with `async wait() -> None`.
  - `Settings.resolve_min_interval_s: float = 3.0`.
  - The worker ctx key `"search_pacer"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_pacing.py`:

```python
import pytest

from mp3server.pacing import SearchPacer


class FakeTime:
    def __init__(self):
        self.now = 100.0
        self.slept = []

    def clock(self):
        return self.now

    async def sleep(self, seconds):
        self.slept.append(round(seconds, 3))
        self.now += seconds


async def test_the_first_search_goes_straight_through():
    t = FakeTime()
    await SearchPacer(3.0, t.clock, t.sleep).wait()
    assert t.slept == []


async def test_back_to_back_searches_are_spaced_by_the_interval():
    t = FakeTime()
    pacer = SearchPacer(3.0, t.clock, t.sleep)
    await pacer.wait()
    await pacer.wait()
    await pacer.wait()
    assert t.slept == [3.0, 3.0]


async def test_only_the_rest_of_the_interval_is_waited():
    t = FakeTime()
    pacer = SearchPacer(3.0, t.clock, t.sleep)
    await pacer.wait()
    t.now += 1.0
    await pacer.wait()
    assert t.slept == [2.0]


async def test_a_search_after_a_long_gap_does_not_wait():
    t = FakeTime()
    pacer = SearchPacer(3.0, t.clock, t.sleep)
    await pacer.wait()
    t.now += 10.0
    await pacer.wait()
    assert t.slept == []


async def test_a_zero_interval_never_waits():
    t = FakeTime()
    pacer = SearchPacer(0, t.clock, t.sleep)
    await pacer.wait()
    await pacer.wait()
    assert t.slept == []


def test_a_negative_interval_is_rejected():
    with pytest.raises(ValueError):
        SearchPacer(-1)
```

In `tests/test_worker_resolve.py`, import the pacer and give the `ctx` fixture one that never waits:

```python
from mp3server.pacing import SearchPacer
```

```python
@pytest.fixture
def ctx(settings, session_factory, fake_queue):
    return {
        "settings": settings,
        "session_factory": session_factory,
        "redis": fake_queue,
        "search_pacer": SearchPacer(0),
    }
```

Append:

```python
class RecordingPacer:
    def __init__(self, log):
        self.log = log

    async def wait(self):
        self.log.append("wait")


async def test_resolve_track_waits_its_turn_before_searching(ctx, db, settings, user_id, monkeypatch):
    log = []
    ctx["search_pacer"] = RecordingPacer(log)

    def fake_search(q, limit, cookies, proxy=None):
        log.append("search")
        return [Candidate("v", "T", "X", 100)]

    monkeypatch.setattr(worker.ytdl, "search", fake_search)
    _, child_id = await make_import(db, settings, user_id, TrackRequest("T", "X", 100_000))
    await worker.resolve_track(ctx, str(child_id))
    assert log == ["wait", "search"]


async def test_a_cache_hit_does_not_wait_for_a_search_slot(ctx, db, settings, user_id, monkeypatch):
    monkeypatch.setattr(
        worker.ytdl, "search", lambda q, limit, cookies, proxy=None: [Candidate("v", "T", "X", 100)]
    )
    _, first = await make_import(db, settings, user_id, TrackRequest("T", "X", 100_000))
    await worker.resolve_track(ctx, str(first))

    log = []
    ctx["search_pacer"] = RecordingPacer(log)
    _, second = await make_import(db, settings, user_id, TrackRequest("T", "X", 100_000))
    await worker.resolve_track(ctx, str(second))
    assert log == []


def test_the_resolve_worker_runs_one_job_at_a_time():
    assert worker.ResolveWorkerSettings.max_jobs == 1
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `.venv/bin/pytest tests/test_pacing.py tests/test_worker_resolve.py -q`
Expected: FAIL, with `ModuleNotFoundError: No module named 'mp3server.pacing'`.

- [ ] **Step 3: Write the implementation**

Create `src/mp3server/pacing.py`:

```python
"""Spacing out YouTube searches from one process."""

import asyncio
import time
from typing import Awaitable, Callable


class SearchPacer:
    """Lets callers through at most once per interval, in arrival order.

    Matching whole libraries is the first bulk YouTube traffic from the home
    IP, and a burst of searches is what gets an IP flagged, after which every
    download breaks, not just imports. Cache hits never call this.
    """

    def __init__(
        self,
        interval_s: float,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if interval_s < 0:
            raise ValueError("interval_s must not be negative")
        self._interval = interval_s
        self._clock = clock
        self._sleep = sleep
        self._lock = asyncio.Lock()
        self._next_at: float | None = None

    async def wait(self) -> None:
        async with self._lock:
            now = self._clock()
            if self._next_at is not None and self._next_at > now:
                await self._sleep(self._next_at - now)
                now = self._next_at
            self._next_at = now + self._interval
```

In `src/mp3server/config.py`, add after `resolve_queue_name`:

```python
    # One resolver search per this many seconds: bulk library matching must
    # not look like a scraper to YouTube (cache hits don't count)
    resolve_min_interval_s: float = 3.0
```

In `src/mp3server/worker.py`, import it:

```python
from mp3server.pacing import SearchPacer
```

In `startup`, after `ctx["storage"] = ...`:

```python
    ctx["search_pacer"] = SearchPacer(settings.resolve_min_interval_s)
```

In `resolve_track`, immediately before the `try:` that calls `ytdl.search`:

```python
    await ctx["search_pacer"].wait()
```

In `ResolveWorkerSettings`, the docstring's first paragraph ends "so it stays cheap and can run more jobs at once than the download worker." Replace that paragraph with:

```python
    """Resolution runs apart from downloads on purpose.

    WorkerSettings.max_jobs is 2, and a bulk import would otherwise occupy every
    slot while a room waits for the track it is about to play. This process only
    searches metadata — no ffmpeg, no disk — and runs one job at a time, because
    its searches are paced (SearchPacer) so bulk matching doesn't get the IP
    flagged.
```

Leave the second paragraph ("No cron jobs here…") as it is. Change `max_jobs`:

```python
    # One at a time: searches are paced per process anyway, and a single
    # worker keeps them in submission order
    max_jobs = int(os.environ.get("MAX_PARALLEL_RESOLVE_JOBS", "1"))
```

Two other tests build a resolver ctx by hand and would now fail with `KeyError: 'search_pacer'`. In `tests/test_api_imports.py` (the cancelled-import test, around line 191) and `tests/test_network_smoke.py` (around line 78), change the ctx line to:

```python
    ctx = {
        "settings": settings,
        "session_factory": session_factory,
        "redis": fake_queue,
        "search_pacer": SearchPacer(0),
    }
```

Add `from mp3server.pacing import SearchPacer` next to each file's other imports. In `test_network_smoke.py` the imports sit inside the test function, so put it there.

In `.env.example`, add after the `RESOLVE_QUEUE_NAME=arq:resolve` line:

```bash
# Seconds between resolver searches, so bulk matching doesn't look like a
# scraper to YouTube. Cache hits don't wait.
RESOLVE_MIN_INTERVAL_S=3
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `.venv/bin/pytest -q`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/pacing.py src/mp3server/config.py src/mp3server/worker.py tests/test_pacing.py tests/test_worker_resolve.py .env.example
git commit -m "Pace the resolver to one search every three seconds

Matching whole Spotify libraries is the first bulk YouTube traffic from the
home IP, and a flagged IP breaks every download. The resolver now runs one
job at a time and waits its turn before each search; cache hits skip the
wait."
git push
```

---

### Task 4 (mp3server): `POST /match` for one track, now

**Files:**
- Create: `src/mp3server/routes/match.py`
- Modify: `src/mp3server/main.py`
- Test: `tests/test_api_match.py`

**Interfaces:**
- Consumes:
  - `get_import_caller` (Task 1)
  - `find_cached_resolution`, `Match.duration_ms` (Task 2)
- Produces: `POST /match`
  - Body: `{title, artist, duration_ms?}`
  - Returns: `{state: "resolved"|"not_found", video_id, matched_title, confidence, matched_duration_ms}`
  - Returns 502 when the search itself fails.

- [ ] **Step 1: Write the failing test**

Create `tests/test_api_match.py`:

```python
from yt_dlp.utils import DownloadError

from mp3server.jobs import imports
from mp3server.jobs.imports import TrackRequest
from mp3server.matching import Candidate
from mp3server.models import JobStatus, utcnow
from mp3server.routes import match as match_route

TOKEN = "s" * 40
BODY = {"title": "Glory Box", "artist": "Portishead", "duration_ms": 305_000}


async def test_match_returns_the_best_video_with_its_length(client, authed, monkeypatch):
    monkeypatch.setattr(
        match_route.ytdl, "search",
        lambda q, limit, cookies, proxy=None: [Candidate("album", "Glory Box", "Portishead", 306)],
    )
    response = await client.post("/match", json=BODY)
    assert response.status_code == 200
    assert response.json() == {
        "state": "resolved",
        "video_id": "album",
        "matched_title": "Glory Box",
        "confidence": "high",
        "matched_duration_ms": 306_000,
    }


async def test_match_says_not_found_when_nothing_is_close(client, authed, monkeypatch):
    monkeypatch.setattr(
        match_route.ytdl, "search",
        lambda q, limit, cookies, proxy=None: [Candidate("edit", "Glory Box", "Portishead", 213)],
    )
    payload = (await client.post("/match", json=BODY)).json()
    assert payload["state"] == "not_found"
    assert payload["video_id"] is None


async def test_match_reuses_a_previous_resolution_without_searching(
    client, authed, db, user_id, settings, monkeypatch
):
    parent, _ = await imports.create_import(
        db, user_id, [TrackRequest("Glory Box", "Portishead", 305_000)], settings
    )
    job, track = (await imports.get_import_rows(db, parent.id))[0]
    job.status = JobStatus.COMPLETED
    job.video_id = "cached"
    job.finished_at = utcnow()
    track.matched_title = "Glory Box"
    track.confidence = "high"
    track.matched_duration_ms = 305_500
    await db.commit()

    def must_not_search(*args, **kwargs):
        raise AssertionError("a cached track must not be searched")

    monkeypatch.setattr(match_route.ytdl, "search", must_not_search)
    payload = (await client.post("/match", json=BODY)).json()
    assert payload["video_id"] == "cached"
    assert payload["matched_duration_ms"] == 305_500


async def test_match_reports_a_failed_search_as_502(client, authed, monkeypatch):
    def fail(*args, **kwargs):
        raise DownloadError("ERROR: Sign in to confirm you're not a bot")

    monkeypatch.setattr(match_route.ytdl, "search", fail)
    response = await client.post("/match", json=BODY)
    assert response.status_code == 502
    assert "not a bot" in response.json()["detail"]


async def test_match_accepts_the_service_token(client, settings, monkeypatch):
    settings.service_token = TOKEN
    monkeypatch.setattr(
        match_route.ytdl, "search",
        lambda q, limit, cookies, proxy=None: [Candidate("album", "Glory Box", "Portishead", 306)],
    )
    response = await client.post(
        "/match", json=BODY, headers={"Authorization": f"Bearer {TOKEN}"}
    )
    assert response.status_code == 200


async def test_match_requires_a_caller(client):
    assert (await client.post("/match", json=BODY)).status_code == 401


async def test_match_rejects_a_blank_title(client, authed):
    response = await client.post("/match", json={"title": "", "artist": "X"})
    assert response.status_code == 422
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv/bin/pytest tests/test_api_match.py -q`
Expected: FAIL, with `ImportError: cannot import name 'match' from 'mp3server.routes'`.

- [ ] **Step 3: Write the implementation**

Create `src/mp3server/routes/match.py`:

```python
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from yt_dlp.utils import DownloadError

from mp3server import matching, ytdl
from mp3server.auth import get_import_caller
from mp3server.config import Settings
from mp3server.deps import get_app_settings, get_db
from mp3server.jobs.imports import find_cached_resolution
from mp3server.matching import norm_key

router = APIRouter(prefix="/match", tags=["match"])


class MatchRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    artist: str = Field(min_length=1, max_length=500)
    duration_ms: int | None = Field(default=None, ge=0)


class MatchResult(BaseModel):
    state: str  # "resolved" | "not_found"
    video_id: str | None = None
    matched_title: str | None = None
    confidence: str | None = None
    matched_duration_ms: int | None = None


@router.post("", response_model=MatchResult, dependencies=[Depends(get_import_caller)])
async def match_one(
    body: MatchRequest,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> MatchResult:
    """Find one track's video now, for someone waiting on a click.

    Runs in the API process rather than on the resolve queue, so it never sits
    behind a paced bulk import. It reads the resolution cache but doesn't
    write to it: june keeps the answer on its own songs row, so the same song
    is never asked for twice.
    """
    cached = await find_cached_resolution(db, norm_key(body.artist, body.title))
    if cached is not None:
        return MatchResult(
            state="resolved",
            video_id=cached.video_id,
            matched_title=cached.matched_title,
            confidence=cached.confidence,
            matched_duration_ms=cached.matched_duration_ms,
        )

    try:
        candidates = await asyncio.to_thread(
            ytdl.search,
            " ".join(f"{body.artist} {body.title}".split()),
            settings.resolve_search_limit,
            settings.cookies_file,
            ytdl.proxy_if_reachable(settings.ytdl_proxy),
        )
    except DownloadError as exc:
        raise HTTPException(status_code=502, detail=f"search failed: {exc}") from exc

    # 0 means "unknown", as it does for imports
    match = matching.pick_candidate(candidates, body.duration_ms or None, body.artist)
    if match is None:
        return MatchResult(state="not_found")
    return MatchResult(
        state="resolved",
        video_id=match.video_id,
        matched_title=match.title,
        confidence=match.confidence,
        matched_duration_ms=match.duration_ms,
    )
```

In `src/mp3server/main.py`, import and register it:

```python
from mp3server.routes import captions, downloads, files, health, imports, match
```

```python
    app.include_router(imports.router)
    app.include_router(match.router)
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `.venv/bin/pytest -q`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/routes/match.py src/mp3server/main.py tests/test_api_match.py
git commit -m "Add POST /match to find one track's video immediately

A click on an unmatched library song can't wait behind a paced bulk import,
so /match searches inline in the API process. It reads the resolution cache
first, returns the video's own length, and reports a failed search as 502
rather than as no match. It accepts the service token like the import routes."
git push
```

---

### Task 5 (june): A client for mp3server's import and match routes

**Files:**
- Create: `src/audio/imports.ts`
- Modify: `src/lib/spotify/config.ts`
- Test: `test/audio/imports.test.ts`

**Interfaces:**
- Produces:
  - `interface TrackToMatch { title: string; artist: string; durationMs: number | null }`
  - `type ImportStatus`, `type ImportTrackState`, `type MatchResult` (inferred from Zod schemas)
  - `class ImportServiceError extends Error { status: number }`
  - `interface ImportService`:
    - `createImport(tracks: TrackToMatch[]): Promise<{ id: string; total: number }>`
    - `getImport(id: string): Promise<ImportStatus | null>`: null on 404
    - `matchOne(track: TrackToMatch): Promise<MatchResult>`
  - `createImportService(config: { baseUrl: string; serviceToken: string; fetch?: FetchLike; timeoutMs?: number }): ImportService`
  - `mp3serverServiceConfig(): { baseUrl: string; serviceToken: string }` in `src/lib/spotify/config.ts`

- [ ] **Step 1: Create the branch**

The branch already exists: this plan was committed on it.

```bash
cd /Users/jacobdang/Projects/june
git checkout library-matching && git pull
```

- [ ] **Step 2: Write the failing test**

Create `test/audio/imports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createImportService, ImportServiceError } from "../../src/audio/imports";

type Reply = { status?: number; body: unknown };

function stubFetch(handler: (url: URL, init?: RequestInit) => Reply) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (url: URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const TOKEN = "t".repeat(40);
const base = { baseUrl: "https://audio.example/", serviceToken: TOKEN };
const header = (init?: RequestInit) => (init?.headers as Record<string, string>).Authorization;

describe("createImportService", () => {
  it("needs a base URL and a service token", () => {
    expect(() => createImportService({ baseUrl: "", serviceToken: TOKEN })).toThrow(/baseUrl/);
    expect(() => createImportService({ baseUrl: "https://a", serviceToken: "" })).toThrow(/serviceToken/);
  });

  it("creates an import with the service token and snake_case lengths", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 202, body: { id: "job-1", kind: "import", status: "running", total: 2 } }));
    const created = await createImportService({ ...base, fetch }).createImport([
      { title: "Glory Box", artist: "Portishead", durationMs: 305_000 },
      { title: "Roads", artist: "Portishead", durationMs: null },
    ]);

    expect(created).toEqual({ id: "job-1", total: 2 });
    expect(calls[0]!.url.toString()).toBe("https://audio.example/imports");
    expect(calls[0]!.init!.method).toBe("POST");
    expect(header(calls[0]!.init)).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      tracks: [
        { title: "Glory Box", artist: "Portishead", duration_ms: 305_000 },
        { title: "Roads", artist: "Portishead", duration_ms: null },
      ],
    });
  });

  it("reads an import's per-track results", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: {
        id: "job-1",
        status: "partial",
        total: 2,
        done: 2,
        tracks: [
          { title: "Glory Box", artist: "Portishead", state: "resolved", video_id: "v1", matched_title: "Glory Box", confidence: "high", matched_duration_ms: 306_000 },
          { title: "Roads", artist: "Portishead", state: "not_found" },
        ],
      },
    }));
    const status = await createImportService({ ...base, fetch }).getImport("job-1");

    expect(status?.tracks[0]?.video_id).toBe("v1");
    expect(status?.tracks[0]?.matched_duration_ms).toBe(306_000);
    expect(status?.tracks[1]?.state).toBe("not_found");
    expect(calls[0]!.url.pathname).toBe("/imports/job-1");
  });

  it("says an import the server no longer has is gone", async () => {
    const { fetch } = stubFetch(() => ({ status: 404, body: { detail: "import not found" } }));
    expect(await createImportService({ ...base, fetch }).getImport("old")).toBeNull();
  });

  it("matches one track", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { state: "resolved", video_id: "v1", matched_title: "Glory Box", confidence: "low", matched_duration_ms: 318_000 },
    }));
    const result = await createImportService({ ...base, fetch }).matchOne({
      title: "Glory Box",
      artist: "Portishead",
      durationMs: 305_000,
    });

    expect(result.state).toBe("resolved");
    expect(result.confidence).toBe("low");
    expect(calls[0]!.url.pathname).toBe("/match");
  });

  it("keeps the server's detail on an error", async () => {
    const { fetch } = stubFetch(() => ({ status: 502, body: { detail: "search failed: not a bot" } }));
    const error = await createImportService({ ...base, fetch })
      .matchOne({ title: "x", artist: "y", durationMs: null })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ImportServiceError);
    expect(error).toMatchObject({ status: 502, message: expect.stringMatching(/not a bot/) });
  });

  it("fails on a shape it doesn't expect", async () => {
    const { fetch } = stubFetch(() => ({ body: { nope: true } }));
    await expect(
      createImportService({ ...base, fetch }).matchOne({ title: "x", artist: "y", durationMs: null }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run test/audio/imports.test.ts`
Expected: FAIL, with `Failed to resolve import ../../src/audio/imports`.

- [ ] **Step 4: Write the implementation**

Create `src/audio/imports.ts`:

```ts
import { z } from "zod";

/**
 * mp3server's import and match routes, called server-to-server with the
 * shared service token, for the background library matching and for matching
 * one song when someone clicks it. Validated at the boundary like the rest of
 * src/audio.
 */

export const importTrackStateSchema = z.object({
  title: z.string(),
  artist: z.string(),
  // "pending" | "resolved" | "not_found" | "failed" | "canceled"; kept as a
  // string so a future state fails where it's interpreted, not here
  state: z.string(),
  video_id: z.string().nullish(),
  matched_title: z.string().nullish(),
  confidence: z.string().nullish(),
  matched_duration_ms: z.number().int().nullish(),
  error: z.string().nullish(),
});

export const importStatusSchema = z.object({
  id: z.string(),
  status: z.string(),
  total: z.number().int(),
  done: z.number().int(),
  tracks: z.array(importTrackStateSchema),
});

const importCreatedSchema = z.object({ id: z.string(), total: z.number().int() });

export const matchResultSchema = z.object({
  state: z.enum(["resolved", "not_found"]),
  video_id: z.string().nullish(),
  matched_title: z.string().nullish(),
  confidence: z.string().nullish(),
  matched_duration_ms: z.number().int().nullish(),
});

export type ImportTrackState = z.infer<typeof importTrackStateSchema>;
export type ImportStatus = z.infer<typeof importStatusSchema>;
export type MatchResult = z.infer<typeof matchResultSchema>;

export interface TrackToMatch {
  title: string;
  artist: string;
  durationMs: number | null;
}

export interface ImportService {
  createImport(tracks: TrackToMatch[]): Promise<{ id: string; total: number }>;
  /** Null when the server no longer has the import (pruned past retention). */
  getImport(id: string): Promise<ImportStatus | null>;
  matchOne(track: TrackToMatch): Promise<MatchResult>;
}

export class ImportServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ImportServiceError";
    this.status = status;
  }
}

type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export interface ImportServiceConfig {
  baseUrl: string;
  serviceToken: string;
  fetch?: FetchLike;
  /** Per request; a stuck search must not hold a sync run or a click. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : JSON.stringify(body);
  } catch {
    return response.statusText || "unknown error";
  }
}

function toWire(track: TrackToMatch) {
  return { title: track.title, artist: track.artist, duration_ms: track.durationMs };
}

export function createImportService(config: ImportServiceConfig): ImportService {
  if (!config.baseUrl) throw new Error("createImportService: baseUrl is required");
  if (!config.serviceToken) throw new Error("createImportService: serviceToken is required");
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${config.serviceToken}` };
    const init: RequestInit = { method: body === undefined ? "GET" : "POST", headers, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return doFetch(new URL(`${baseUrl}${path}`), init);
  }

  async function fail(path: string, response: Response): Promise<never> {
    throw new ImportServiceError(
      response.status,
      `mp3server ${response.status} on ${path}: ${await errorDetail(response)}`,
    );
  }

  return {
    async createImport(tracks) {
      const response = await call("/imports", { tracks: tracks.map(toWire) });
      if (!response.ok) return fail("/imports", response);
      return importCreatedSchema.parse(await response.json());
    },

    async getImport(id) {
      const path = `/imports/${encodeURIComponent(id)}`;
      const response = await call(path);
      if (response.status === 404) return null;
      if (!response.ok) return fail(path, response);
      return importStatusSchema.parse(await response.json());
    },

    async matchOne(track) {
      const response = await call("/match", toWire(track));
      if (!response.ok) return fail("/match", response);
      return matchResultSchema.parse(await response.json());
    },
  };
}
```

In `src/lib/spotify/config.ts`, append:

```ts
/** Where june's server reaches mp3server for library matching. The base URL
 *  is the same one the browser uses; the token is server-only. */
export function mp3serverServiceConfig(): { baseUrl: string; serviceToken: string } {
  const baseUrl = process.env.NEXT_PUBLIC_MP3SERVER_URL;
  const serviceToken = process.env.MP3SERVER_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken) {
    throw new Error(
      "Library matching is not configured (set NEXT_PUBLIC_MP3SERVER_URL and MP3SERVER_SERVICE_TOKEN).",
    );
  }
  return { baseUrl, serviceToken };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run test/audio/imports.test.ts`
Expected: PASS, 7 tests.

Run: `npm test && npm run typecheck`
Expected: every test passes; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/audio/imports.ts src/lib/spotify/config.ts test/audio/imports.test.ts
git commit -m "Add a server-side client for mp3server's import and match routes

Library matching runs from june's server with the shared service token:
submit a batch of songs as one import, read its per-track results (null
once the server has pruned it), or match one song now. Responses are
validated at the boundary, and errors keep mp3server's own detail."
git push -u origin library-matching
```

---

### Task 6 (june): Decide what matching writes, as pure functions

**Files:**
- Create: `src/lib/spotify/match-plan.ts`
- Test: `test/lib/spotify-match-plan.test.ts`

**Interfaces:**
- Consumes: `TrackToMatch`, `ImportStatus`, `MatchResult` (Task 5)
- Produces:
  - `MATCH_BATCH_LIMIT = 500`
  - `interface PendingSong { id: string; title: string; artists: string[]; durationMs: number | null }`
  - `interface MatchingSong { id: string; position: number }`
  - `type SongMatchUpdate`, one of:
    - `{ songId: string; state: "matched"; videoId: string; videoDurationMs: number; confidence: "high" | "low" }`
    - `{ songId: string; state: "not_found" | "failed" | "pending" }`
  - `importBatch(songs: readonly PendingSong[]): TrackToMatch[]`
  - `updatesFromImport(songs: readonly MatchingSong[], status: ImportStatus | null): SongMatchUpdate[]`
  - `matchResultUpdate(songId: string, result: MatchResult): SongMatchUpdate`
  - `matchUpdateRow(update: SongMatchUpdate): { song_id: string; state: string; video_id: string | null; video_duration_ms: number | null; confidence: string | null }`

- [ ] **Step 1: Write the failing test**

Create `test/lib/spotify-match-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ImportStatus } from "../../src/audio/imports";
import {
  importBatch,
  matchResultUpdate,
  matchUpdateRow,
  updatesFromImport,
} from "../../src/lib/spotify/match-plan";

function status(tracks: ImportStatus["tracks"]): ImportStatus {
  return { id: "job-1", status: "partial", total: tracks.length, done: tracks.length, tracks };
}

const resolved = (video: string, ms: number | null, confidence = "high") => ({
  title: "t",
  artist: "a",
  state: "resolved",
  video_id: video,
  matched_title: "t",
  confidence,
  matched_duration_ms: ms,
});

describe("importBatch", () => {
  it("sends each song's title, first artist and Spotify length", () => {
    expect(
      importBatch([
        { id: "s1", title: "Glory Box", artists: ["Portishead", "Guest"], durationMs: 305_000 },
        { id: "s2", title: "Roads", artists: ["Portishead"], durationMs: null },
      ]),
    ).toEqual([
      { title: "Glory Box", artist: "Portishead", durationMs: 305_000 },
      { title: "Roads", artist: "Portishead", durationMs: null },
    ]);
  });

  it("refuses a song with no artist rather than sending a blank one", () => {
    expect(() => importBatch([{ id: "s1", title: "X", artists: [], durationMs: null }])).toThrow(/s1/);
  });
});

describe("updatesFromImport", () => {
  const songs = [
    { id: "s1", position: 0 },
    { id: "s2", position: 1 },
    { id: "s3", position: 2 },
    { id: "s4", position: 3 },
    { id: "s5", position: 4 },
  ];

  it("maps each position's result onto its song", () => {
    const updates = updatesFromImport(
      songs,
      status([
        resolved("v1", 306_000),
        resolved("v2", 200_000, "low"),
        { title: "t", artist: "a", state: "not_found" },
        { title: "t", artist: "a", state: "failed", error: "boom" },
        { title: "t", artist: "a", state: "canceled" },
      ]),
    );
    expect(updates).toEqual([
      { songId: "s1", state: "matched", videoId: "v1", videoDurationMs: 306_000, confidence: "high" },
      { songId: "s2", state: "matched", videoId: "v2", videoDurationMs: 200_000, confidence: "low" },
      { songId: "s3", state: "not_found" },
      { songId: "s4", state: "failed" },
      { songId: "s5", state: "pending" },
    ]);
  });

  it("leaves songs whose track is still pending alone", () => {
    const updates = updatesFromImport(
      [{ id: "s1", position: 0 }],
      status([{ title: "t", artist: "a", state: "pending" }]),
    );
    expect(updates).toEqual([]);
  });

  it("treats a match with no video length as failed, since it can't be timed", () => {
    expect(updatesFromImport([{ id: "s1", position: 0 }], status([resolved("v1", null)]))).toEqual([
      { songId: "s1", state: "failed" },
    ]);
  });

  it("sends every song back to pending when the import is gone", () => {
    expect(updatesFromImport(songs.slice(0, 2), null)).toEqual([
      { songId: "s1", state: "pending" },
      { songId: "s2", state: "pending" },
    ]);
  });

  it("fails loudly when a position is missing from the import", () => {
    expect(() => updatesFromImport([{ id: "s9", position: 7 }], status([resolved("v1", 1000)]))).toThrow(
      /position 7/,
    );
  });
});

describe("matchResultUpdate", () => {
  it("maps a resolved match", () => {
    expect(
      matchResultUpdate("s1", { state: "resolved", video_id: "v1", matched_title: "t", confidence: "high", matched_duration_ms: 306_000 }),
    ).toEqual({ songId: "s1", state: "matched", videoId: "v1", videoDurationMs: 306_000, confidence: "high" });
  });

  it("maps not found, and a resolved match without a length, to not playable", () => {
    expect(matchResultUpdate("s1", { state: "not_found" })).toEqual({ songId: "s1", state: "not_found" });
    expect(
      matchResultUpdate("s1", { state: "resolved", video_id: "v1", matched_duration_ms: null }),
    ).toEqual({ songId: "s1", state: "failed" });
  });
});

describe("matchUpdateRow", () => {
  it("writes the video fields only for a match", () => {
    expect(
      matchUpdateRow({ songId: "s1", state: "matched", videoId: "v1", videoDurationMs: 306_000, confidence: "low" }),
    ).toEqual({ song_id: "s1", state: "matched", video_id: "v1", video_duration_ms: 306_000, confidence: "low" });
    expect(matchUpdateRow({ songId: "s2", state: "not_found" })).toEqual({
      song_id: "s2",
      state: "not_found",
      video_id: null,
      video_duration_ms: null,
      confidence: null,
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/lib/spotify-match-plan.test.ts`
Expected: FAIL, with `Failed to resolve import ../../src/lib/spotify/match-plan`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/spotify/match-plan.ts`:

```ts
import type { ImportStatus, ImportTrackState, MatchResult, TrackToMatch } from "../../audio/imports";

/**
 * What library matching sends to mp3server and writes back onto songs, as
 * pure functions. Deliberately free of Supabase and `server-only`; the IO
 * lives in ./match-store.ts and ./match-library.ts.
 */

/** The most songs per import: mp3server's import_max_tracks. */
export const MATCH_BATCH_LIMIT = 500;

export interface PendingSong {
  id: string;
  title: string;
  artists: string[];
  durationMs: number | null;
}

/** A song waiting on an import, and its index in that import. */
export interface MatchingSong {
  id: string;
  position: number;
}

export type SongMatchUpdate =
  | {
      songId: string;
      state: "matched";
      videoId: string;
      videoDurationMs: number;
      confidence: "high" | "low";
    }
  // "pending" puts a song back in line: its import was cancelled or is gone
  | { songId: string; state: "not_found" | "failed" | "pending" };

export function importBatch(songs: readonly PendingSong[]): TrackToMatch[] {
  return songs.map((song) => {
    const artist = song.artists[0];
    if (!artist) throw new Error(`song ${song.id} has no artist to match on`);
    return { title: song.title, artist, durationMs: song.durationMs };
  });
}

/** A resolved answer is playable only with a video and its length: the room
 *  clock ends a track on the audio's own length. */
function matched(
  songId: string,
  videoId: string | null | undefined,
  lengthMs: number | null | undefined,
  confidence: string | null | undefined,
): SongMatchUpdate {
  if (!videoId || lengthMs == null) return { songId, state: "failed" };
  return {
    songId,
    state: "matched",
    videoId,
    videoDurationMs: lengthMs,
    confidence: confidence === "high" ? "high" : "low",
  };
}

function fromTrack(songId: string, track: ImportTrackState): SongMatchUpdate | null {
  switch (track.state) {
    case "resolved":
      return matched(songId, track.video_id, track.matched_duration_ms, track.confidence);
    case "not_found":
      return { songId, state: "not_found" };
    case "failed":
      return { songId, state: "failed" };
    case "canceled":
      return { songId, state: "pending" };
    default:
      // still pending on mp3server: leave the song where it is
      return null;
  }
}

/**
 * The updates one import's results mean for its songs. An import the server
 * no longer has (null) sends every song back to pending, so the next batch
 * picks them up again; mp3server's cache makes that cheap.
 */
export function updatesFromImport(
  songs: readonly MatchingSong[],
  status: ImportStatus | null,
): SongMatchUpdate[] {
  if (status === null) return songs.map((song) => ({ songId: song.id, state: "pending" }));
  const updates: SongMatchUpdate[] = [];
  for (const song of songs) {
    const track = status.tracks[song.position];
    if (!track) throw new Error(`import ${status.id} has no track at position ${song.position}`);
    const update = fromTrack(song.id, track);
    if (update !== null) updates.push(update);
  }
  return updates;
}

export function matchResultUpdate(songId: string, result: MatchResult): SongMatchUpdate {
  if (result.state === "not_found") return { songId, state: "not_found" };
  return matched(songId, result.video_id, result.matched_duration_ms, result.confidence);
}

/** One element of apply_song_matches' jsonb argument. */
export function matchUpdateRow(update: SongMatchUpdate): {
  song_id: string;
  state: string;
  video_id: string | null;
  video_duration_ms: number | null;
  confidence: string | null;
} {
  if (update.state === "matched") {
    return {
      song_id: update.songId,
      state: update.state,
      video_id: update.videoId,
      video_duration_ms: update.videoDurationMs,
      confidence: update.confidence,
    };
  }
  return { song_id: update.songId, state: update.state, video_id: null, video_duration_ms: null, confidence: null };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run test/lib/spotify-match-plan.test.ts`
Expected: PASS, 10 tests.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spotify/match-plan.ts test/lib/spotify-match-plan.test.ts
git commit -m "Decide what library matching sends and writes back, as pure functions

A batch sends each song's title, first artist and Spotify length. Results
map back by position: a resolved track becomes matched only with a video
and its length (the room clock needs it), not found and failed are kept,
and a cancelled or vanished import sends its songs back to pending."
git push
```

---

### Task 7 (june): Match songs at the end of every sync run

**Files:**
- Create: `supabase/migrations/20260928000000_song_matching.sql`, `src/lib/spotify/match-library.ts`, `src/lib/spotify/match-store.ts`
- Modify: `src/lib/spotify/sync.ts`
- Test: `test/lib/spotify-match-library.test.ts`

**Interfaces:**
- Consumes:
  - `ImportService`, `createImportService` (Task 5)
  - `mp3serverServiceConfig` (Task 5)
  - everything in `match-plan.ts` (Task 6)
  - `check` from `src/lib/spotify/store.ts`
- Produces:
  - SQL `mark_songs_matching(p_job uuid, p_song_ids uuid[]) returns void`, service role only
  - SQL `apply_song_matches(p_updates jsonb) returns void`, service role only
  - `interface MatchStore`:
    - `pendingSongs(limit: number): Promise<PendingSong[]>`
    - `songsAwaitingImports(): Promise<Map<string, MatchingSong[]>>`
    - `markMatching(jobId: string, songIds: string[]): Promise<void>`
    - `applyUpdates(updates: SongMatchUpdate[]): Promise<void>`
  - `interface MatchRunResult { collected: number; submitted: number }`
  - `matchLibrary(store: MatchStore, service: ImportService): Promise<MatchRunResult>`
  - `supabaseMatchStore(db?: SupabaseClient): MatchStore`
  - `SyncRunResult`'s `"done"` branch gains `matching: MatchRunResult | null`

- [ ] **Step 1: Write the database functions**

Create `supabase/migrations/20260928000000_song_matching.sql`:

```sql
-- Library matching writes back onto songs through these two functions.
-- Spec: docs/superpowers/specs/2026-09-25-spotify-library-design.md (phase 2).
--
-- Both are one statement over many rows. PostgREST can't give each row of an
-- update its own values, and doing it row by row would be hundreds of calls
-- per sync run. Service role only, like every other write to songs.

-- A batch was submitted as import p_job; each song's index in the request is
-- its position there, which is how results are matched back. Songs that
-- stopped being pending meanwhile (matched on a click) are left alone.
create or replace function public.mark_songs_matching(p_job uuid, p_song_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.songs s
  set match_state = 'matching', match_job_id = p_job, match_position = x.ord - 1
  from unnest(p_song_ids) with ordinality as x(song_id, ord)
  where s.id = x.song_id and s.match_state = 'pending';
$$;

-- Results onto songs. Each element: {song_id, state, video_id,
-- video_duration_ms, confidence}; the video fields are null unless matched.
create or replace function public.apply_song_matches(p_updates jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.songs s
  set match_state = u.state,
      video_id = case when u.state = 'matched' then u.video_id end,
      video_duration_ms = case when u.state = 'matched' then u.video_duration_ms end,
      match_confidence = case when u.state = 'matched' then u.confidence end,
      matched_at = case when u.state in ('matched', 'not_found', 'failed') then now() end,
      match_job_id = null,
      match_position = null
  from jsonb_to_recordset(p_updates)
    as u(song_id uuid, state text, video_id text, video_duration_ms integer, confidence text)
  where s.id = u.song_id;
$$;

revoke execute on function public.mark_songs_matching(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.mark_songs_matching(uuid, uuid[]) to service_role;
revoke execute on function public.apply_song_matches(jsonb) from public, anon, authenticated;
grant execute on function public.apply_song_matches(jsonb) to service_role;
```

Apply it with the Supabase MCP `apply_migration` tool, name `song_matching`. Load the tool with ToolSearch `select:mcp__supabase__apply_migration,mcp__supabase__execute_sql`. This is the shared dev/prod database, and the migration only adds functions.

Then verify with `execute_sql`:

```sql
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authed,
       has_function_privilege('service_role', p.oid, 'execute')  as service
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('mark_songs_matching', 'apply_song_matches')
order by p.proname;
```

Expected: two rows, each `anon = false`, `authed = false`, `service = true`.

```sql
select public.apply_song_matches('[]'::jsonb);
select public.mark_songs_matching(gen_random_uuid(), array[]::uuid[]);
```

Expected: both return without error, as no-ops.

- [ ] **Step 2: Write the failing test**

Create `test/lib/spotify-match-library.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ImportService, ImportStatus, TrackToMatch } from "../../src/audio/imports";
import { matchLibrary, type MatchStore } from "../../src/lib/spotify/match-library";
import type { MatchingSong, PendingSong, SongMatchUpdate } from "../../src/lib/spotify/match-plan";

class FakeStore implements MatchStore {
  pending: PendingSong[] = [];
  awaiting = new Map<string, MatchingSong[]>();
  marked: { jobId: string; songIds: string[] }[] = [];
  applied: SongMatchUpdate[][] = [];
  log: string[] = [];

  async pendingSongs(limit: number) {
    this.log.push(`pending(${limit})`);
    return this.pending.slice(0, limit);
  }
  async songsAwaitingImports() {
    this.log.push("awaiting");
    return this.awaiting;
  }
  async markMatching(jobId: string, songIds: string[]) {
    this.log.push("mark");
    this.marked.push({ jobId, songIds });
  }
  async applyUpdates(updates: SongMatchUpdate[]) {
    this.log.push("apply");
    this.applied.push(updates);
    // a song sent back to pending is picked up by the same run's new batch
    for (const u of updates) {
      if (u.state === "pending") this.pending.push({ id: u.songId, title: "t", artists: ["a"], durationMs: null });
    }
  }
}

function fakeService(imports: Record<string, ImportStatus | null> = {}) {
  const created: TrackToMatch[][] = [];
  const service: ImportService = {
    async createImport(tracks) {
      created.push(tracks);
      return { id: `job-${created.length}`, total: tracks.length };
    },
    async getImport(id) {
      return imports[id] ?? null;
    },
    async matchOne() {
      throw new Error("not used by matchLibrary");
    },
  };
  return { service, created };
}

const song = (id: string): PendingSong => ({ id, title: `T${id}`, artists: [`A${id}`], durationMs: 1000 });

describe("matchLibrary", () => {
  it("collects finished imports before submitting new work", async () => {
    const store = new FakeStore();
    store.awaiting.set("job-old", [{ id: "s1", position: 0 }]);
    store.pending = [song("s2")];
    const { service, created } = fakeService({
      "job-old": {
        id: "job-old",
        status: "completed",
        total: 1,
        done: 1,
        tracks: [{ title: "t", artist: "a", state: "resolved", video_id: "v1", confidence: "high", matched_duration_ms: 1000 }],
      },
    });

    const result = await matchLibrary(store, service);

    expect(store.log).toEqual(["awaiting", "apply", "pending(500)", "mark"]);
    expect(store.applied[0]).toEqual([
      { songId: "s1", state: "matched", videoId: "v1", videoDurationMs: 1000, confidence: "high" },
    ]);
    expect(created).toEqual([[{ title: "Ts2", artist: "As2", durationMs: 1000 }]]);
    expect(store.marked).toEqual([{ jobId: "job-1", songIds: ["s2"] }]);
    expect(result).toEqual({ collected: 1, submitted: 1 });
  });

  it("resubmits the songs of an import the server no longer has, in the same run", async () => {
    const store = new FakeStore();
    store.awaiting.set("job-gone", [{ id: "s1", position: 0 }]);
    const { service, created } = fakeService();

    await matchLibrary(store, service);

    expect(store.applied[0]).toEqual([{ songId: "s1", state: "pending" }]);
    expect(created).toHaveLength(1);
    expect(store.marked[0]?.songIds).toEqual(["s1"]);
  });

  it("submits at most one batch of 500", async () => {
    const store = new FakeStore();
    store.pending = Array.from({ length: 620 }, (_, i) => song(`s${i}`));
    const { service, created } = fakeService();

    const result = await matchLibrary(store, service);

    expect(created).toHaveLength(1);
    expect(created[0]).toHaveLength(500);
    expect(result.submitted).toBe(500);
  });

  it("submits nothing when nothing is pending", async () => {
    const store = new FakeStore();
    const { service, created } = fakeService();

    expect(await matchLibrary(store, service)).toEqual({ collected: 0, submitted: 0 });
    expect(created).toEqual([]);
    expect(store.marked).toEqual([]);
  });

  it("lets a failing import service fail the step", async () => {
    const store = new FakeStore();
    store.pending = [song("s1")];
    const service: ImportService = {
      async createImport() {
        throw new Error("mp3server 503");
      },
      async getImport() {
        return null;
      },
      async matchOne() {
        throw new Error("unused");
      },
    };
    await expect(matchLibrary(store, service)).rejects.toThrow(/503/);
    expect(store.marked).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run test/lib/spotify-match-library.test.ts`
Expected: FAIL, with `Failed to resolve import ../../src/lib/spotify/match-library`.

- [ ] **Step 4: Write the orchestration**

Create `src/lib/spotify/match-library.ts`:

```ts
import type { ImportService } from "../../audio/imports";
import {
  importBatch,
  MATCH_BATCH_LIMIT,
  updatesFromImport,
  type MatchingSong,
  type PendingSong,
  type SongMatchUpdate,
} from "./match-plan";

/**
 * One matching step, run at the end of every sync: collect the results of
 * imports already submitted, then submit the next batch of pending songs.
 * Written against two interfaces so it's tested with fakes; the Supabase
 * store is ./match-store.ts.
 */

export interface MatchStore {
  /** Pending songs, oldest first. */
  pendingSongs(limit: number): Promise<PendingSong[]>;
  /** Songs waiting on an import, grouped by the import's id. */
  songsAwaitingImports(): Promise<Map<string, MatchingSong[]>>;
  /** Mark songs as waiting on an import; each one's index is its position. */
  markMatching(jobId: string, songIds: string[]): Promise<void>;
  applyUpdates(updates: SongMatchUpdate[]): Promise<void>;
}

export interface MatchRunResult {
  /** Songs whose import answered: matched, not found, failed or back to pending. */
  collected: number;
  /** Songs submitted in this run's new import. */
  submitted: number;
}

export async function matchLibrary(store: MatchStore, service: ImportService): Promise<MatchRunResult> {
  // Collecting first means a song sent back to pending (its import was
  // cancelled or pruned) goes out again in this same run.
  let collected = 0;
  for (const [jobId, songs] of await store.songsAwaitingImports()) {
    const updates = updatesFromImport(songs, await service.getImport(jobId));
    await store.applyUpdates(updates);
    collected += updates.length;
  }

  const pending = await store.pendingSongs(MATCH_BATCH_LIMIT);
  if (pending.length === 0) return { collected, submitted: 0 };
  const created = await service.createImport(importBatch(pending));
  await store.markMatching(
    created.id,
    pending.map((song) => song.id),
  );
  return { collected, submitted: pending.length };
}
```

Create `src/lib/spotify/match-store.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../supabase/service";
import type { MatchStore } from "./match-library";
import { matchUpdateRow, type MatchingSong } from "./match-plan";
import { check } from "./store";

/** Supabase's API returns at most this many rows per select. */
const MAX_ROWS = 1000;

/** Matching's reads and writes on songs, with the service role: songs are
 *  readable by every signed-in user but written only by the server. */
export function supabaseMatchStore(db: SupabaseClient = createServiceClient()): MatchStore {
  return {
    async pendingSongs(limit) {
      const { data, error } = await db
        .from("songs")
        .select("id, title, artists, duration_ms")
        .eq("match_state", "pending")
        .order("created_at")
        .limit(limit);
      check("read songs to match", error);
      return ((data ?? []) as { id: string; title: string; artists: string[]; duration_ms: number | null }[]).map(
        (s) => ({ id: s.id, title: s.title, artists: s.artists, durationMs: s.duration_ms }),
      );
    },

    async songsAwaitingImports() {
      const byJob = new Map<string, MatchingSong[]>();
      for (let from = 0; ; from += MAX_ROWS) {
        const { data, error } = await db
          .from("songs")
          .select("id, match_job_id, match_position")
          .eq("match_state", "matching")
          .order("id")
          .range(from, from + MAX_ROWS - 1);
        check("read songs being matched", error);
        const rows = (data ?? []) as { id: string; match_job_id: string | null; match_position: number | null }[];
        for (const row of rows) {
          if (row.match_job_id === null || row.match_position === null) {
            throw new Error(`song ${row.id} is matching without an import or a position`);
          }
          const songs = byJob.get(row.match_job_id) ?? [];
          songs.push({ id: row.id, position: row.match_position });
          byJob.set(row.match_job_id, songs);
        }
        if (rows.length < MAX_ROWS) return byJob;
      }
    },

    async markMatching(jobId, songIds) {
      const { error } = await db.rpc("mark_songs_matching", { p_job: jobId, p_song_ids: songIds });
      check("mark songs as matching", error);
    },

    async applyUpdates(updates) {
      if (updates.length === 0) return;
      const { error } = await db.rpc("apply_song_matches", { p_updates: updates.map(matchUpdateRow) });
      check("save song matches", error);
    },
  };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run test/lib/spotify-match-library.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Wire it into the sync run**

In `src/lib/spotify/sync.ts`, add imports:

```ts
import { createImportService } from "../../audio/imports";
import { mp3serverServiceConfig } from "./config";
import { matchLibrary, type MatchRunResult } from "./match-library";
import { supabaseMatchStore } from "./match-store";
```

Change `SyncRunResult`:

```ts
export type SyncRunResult =
  | { status: "busy" }
  | {
      status: "done";
      synced: number;
      failed: number;
      skipped: number;
      rateLimited: boolean;
      /** Null when matching failed (logged) or ran out of time. */
      matching: MatchRunResult | null;
    };

type UsersResult = Omit<Extract<SyncRunResult, { status: "done" }>, "status" | "matching">;
```

Add, above `run`:

```ts
/** Match songs to videos on mp3server. Its failure never fails the run: the
 *  Spotify data is already saved, and pending songs wait for the next run. */
async function matchSongs(): Promise<MatchRunResult | null> {
  try {
    return await matchLibrary(supabaseMatchStore(), createImportService(mp3serverServiceConfig()));
  } catch (err) {
    console.error("Library matching failed; songs stay pending for the next run:", err);
    return null;
  }
}

/** Sync each user in turn until the budget runs out or Spotify says stop. */
async function syncUsers(queue: ConnectionRow[], started: number): Promise<UsersResult> {
  let synced = 0;
  let failed = 0;
  for (const [index, row] of queue.entries()) {
    if (Date.now() - started >= RUN_BUDGET_MS) {
      const skipped = queue.slice(index).map((r) => r.user_id);
      console.error(
        `Spotify sync ran out of time and skipped ${skipped.length} users, who go first next run: ${skipped.join(", ")}`,
      );
      return { synced, failed, skipped: skipped.length, rateLimited: false };
    }
    const failure = await syncConnection(row, new Date());
    if (failure === null) {
      synced++;
      continue;
    }
    failed++;
    // Quota is shared across the developer account: carrying on would only
    // spend the next user's calls on the same 429.
    if (failure.kind === "rate-limited") {
      return { synced, failed, skipped: queue.length - index - 1, rateLimited: true };
    }
  }
  return { synced, failed, skipped: 0, rateLimited: false };
}
```

Replace `run` with:

```ts
async function run(rows: () => Promise<ConnectionRow[]>): Promise<SyncRunResult> {
  const started = Date.now();
  const holder = await claimSyncLease(LEASE_SECONDS);
  if (holder === null) return { status: "busy" };
  try {
    const users = await syncUsers(await rows(), started);
    // Matching talks to mp3server, not Spotify, so a 429 doesn't stop it; only
    // the time budget does.
    let matching: MatchRunResult | null = null;
    if (Date.now() - started < RUN_BUDGET_MS) {
      matching = await matchSongs();
    } else {
      console.warn("Spotify sync skipped library matching: out of time.");
    }
    return { status: "done", ...users, matching };
  } finally {
    await releaseSyncLease(holder);
  }
}
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck`
Expected: every test passes; no type errors. The only other users of `SyncRunResult` read `status` and `failed`: `app/api/spotify/sync/route.ts`, `app/api/spotify/callback/route.ts` and `src/lib/spotify/actions.ts`. The new field doesn't affect them.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260928000000_song_matching.sql src/lib/spotify/match-library.ts src/lib/spotify/match-store.ts src/lib/spotify/sync.ts test/lib/spotify-match-library.test.ts
git commit -m "Match library songs to videos at the end of every sync run

Each run collects the results of imports already submitted to mp3server,
then submits up to 500 pending songs as one new import. Two service-role
functions write back in one statement each. A matching failure is logged
and never fails the run: the Spotify data is already saved."
git push
```

---

### Task 8 (june): Let Spotify album art through the thumbnail allowlist

**Files:**
- Modify: `src/lib/room/thumbnail.ts`
- Test: `test/lib/safe-thumbnail.test.ts`

- [ ] **Step 1: Write the failing test**

In `test/lib/safe-thumbnail.test.ts`, add inside the `describe`:

```ts
  it("allows Spotify album art hosts", () => {
    expect(safeThumbnailUrl("https://i.scdn.co/image/ab67616d0000b273abc")).toBe(
      "https://i.scdn.co/image/ab67616d0000b273abc",
    );
    expect(safeThumbnailUrl("https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02abc")).toBeTruthy();
  });

  it("rejects Spotify lookalikes", () => {
    expect(safeThumbnailUrl("https://i.scdn.co.attacker.com/p.png")).toBeNull();
    expect(safeThumbnailUrl("https://notspotifycdn.com/p.png")).toBeNull();
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/lib/safe-thumbnail.test.ts`
Expected: FAIL. The Spotify URL returns `null`.

- [ ] **Step 3: Write the implementation**

In `src/lib/room/thumbnail.ts`, extend the lists (and the comment above them, to name Spotify):

```ts
const ALLOWED_HOST_SUFFIXES = [".ytimg.com", ".mzstatic.com", ".spotifycdn.com"];
const ALLOWED_HOSTS = ["img.youtube.com", "i.scdn.co"];
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run test/lib/safe-thumbnail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/room/thumbnail.ts test/lib/safe-thumbnail.test.ts
git commit -m "Let Spotify album art through the room thumbnail allowlist

Library songs are queued with their Spotify artwork, which the allowlist
would otherwise drop to the music-note placeholder."
git push
```

---

### Task 9 (june): Queue library songs and playlists in a room

**Files:**
- Create: `src/lib/room/library-rows.ts`, `src/lib/room/enqueue-many.ts`, `src/lib/room/library.ts`
- Modify: `src/lib/room/add-music.ts` (`importVideoIds` uses `enqueueMany`)
- Test: `test/room/library-rows.test.ts`

**Interfaces:**
- Consumes:
  - `createImportService`, `mp3serverServiceConfig` (Task 5)
  - `matchResultUpdate` (Task 6)
  - `supabaseMatchStore` (Task 7)
  - `enqueueTrack` from `src/lib/room/actions.ts`
  - `AddTrackInput` from `src/lib/room/types.ts`
- Produces:
  - `library-rows.ts` (pure):
    - `interface SongForRoom { id: string; title: string; artists: string[]; artwork_url: string | null; duration_ms: number | null; match_state: string; video_id: string | null; video_duration_ms: number | null; match_confidence: string | null }`
    - `type LibraryRowState = "ready" | "matching" | "unavailable"`
    - `interface SongMatchView { state: LibraryRowState; lowConfidence: boolean }`
    - `interface LibraryRow extends SongMatchView { songId: string; title: string; artists: string; artworkUrl: string | null }`
    - `matchView(song: Pick<SongForRoom, "match_state" | "video_id" | "video_duration_ms" | "match_confidence">): SongMatchView`
    - `toLibraryRow(song: SongForRoom): LibraryRow`
    - `trackFromSong(song: SongForRoom): AddTrackInput | null`
    - `rowMatchesFilter(row: LibraryRow, filter: string): boolean`
    - `rowNote(view: SongMatchView): string`
    - `playlistQueueSummary(counts: { added: number; ready: number; matching: number; unavailable: number }): string`
  - `enqueue-many.ts`: `enqueueMany(roomId: string, tracks: readonly AddTrackInput[]): Promise<number>`
  - `library.ts` (`"use server"`), where `type LibraryResult<T> = { ok: true; data: T } | { ok: false; notice: string }`:
    - `listLikedForRoom(): Promise<LibraryResult<LibraryRow[]>>`
    - `listPlaylistsForRoom(): Promise<LibraryResult<LibraryPlaylist[]>>`: reuses `getLibraryPlaylists` and `LibraryPlaylist` from `src/lib/spotify/library.ts`, which `/library` already uses
    - `listPlaylistSongsForRoom(playlistId: string): Promise<LibraryResult<LibraryRow[]>>`
    - `queueLibrarySong(roomId: string, songId: string): Promise<LibraryResult<string>>`
    - `queueLibraryPlaylist(roomId: string, playlistId: string): Promise<LibraryResult<string>>`

- [ ] **Step 1: Write the failing test**

Create `test/room/library-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  matchView,
  playlistQueueSummary,
  rowMatchesFilter,
  rowNote,
  toLibraryRow,
  trackFromSong,
  type SongForRoom,
} from "../../src/lib/room/library-rows";

const song = (over: Partial<SongForRoom> = {}): SongForRoom => ({
  id: "s1",
  title: "Glory Box",
  artists: ["Portishead", "Guest"],
  artwork_url: "https://i.scdn.co/image/x",
  duration_ms: 305_000,
  match_state: "matched",
  video_id: "v1",
  video_duration_ms: 306_000,
  match_confidence: "high",
  ...over,
});

describe("toLibraryRow", () => {
  it("shows a matched song as ready", () => {
    expect(toLibraryRow(song())).toEqual({
      songId: "s1",
      title: "Glory Box",
      artists: "Portishead, Guest",
      artworkUrl: "https://i.scdn.co/image/x",
      state: "ready",
      lowConfidence: false,
    });
  });

  it("flags a low-confidence match", () => {
    expect(toLibraryRow(song({ match_confidence: "low" })).lowConfidence).toBe(true);
  });

  it("shows pending and matching songs as matching", () => {
    expect(toLibraryRow(song({ match_state: "pending", video_id: null, video_duration_ms: null })).state).toBe("matching");
    expect(toLibraryRow(song({ match_state: "matching", video_id: null, video_duration_ms: null })).state).toBe("matching");
  });

  it("shows not found, failed, and a matched song missing its video as unavailable", () => {
    expect(toLibraryRow(song({ match_state: "not_found" })).state).toBe("unavailable");
    expect(toLibraryRow(song({ match_state: "failed" })).state).toBe("unavailable");
    expect(toLibraryRow(song({ video_duration_ms: null })).state).toBe("unavailable");
  });
});

describe("trackFromSong", () => {
  it("queues a ready song with the video's own length and Spotify's text and art", () => {
    expect(trackFromSong(song())).toEqual({
      videoId: "v1",
      title: "Glory Box",
      artist: "Portishead, Guest",
      durationMs: 306_000,
      thumbnailUrl: "https://i.scdn.co/image/x",
    });
  });

  it("has nothing to queue for a song that isn't ready", () => {
    expect(trackFromSong(song({ match_state: "pending", video_id: null, video_duration_ms: null }))).toBeNull();
    expect(trackFromSong(song({ artwork_url: null }))?.thumbnailUrl).toBeUndefined();
  });
});

describe("rowNote", () => {
  it("uses the spec's copy", () => {
    expect(rowNote({ state: "ready", lowConfidence: false })).toBe("");
    expect(rowNote({ state: "ready", lowConfidence: true })).toBe(" · ?");
    expect(rowNote({ state: "matching", lowConfidence: false })).toBe(" · matching…");
    expect(rowNote({ state: "unavailable", lowConfidence: false })).toBe(" · no match found");
  });

  it("works from just a song's match columns, as /library reads them", () => {
    expect(
      rowNote(matchView({ match_state: "pending", video_id: null, video_duration_ms: null, match_confidence: null })),
    ).toBe(" · matching…");
  });
});

describe("rowMatchesFilter", () => {
  const row = toLibraryRow(song({ title: "Déjà Vu", artists: ["Beyoncé"] }));

  it("matches title or artists, ignoring case and accents", () => {
    expect(rowMatchesFilter(row, "deja")).toBe(true);
    expect(rowMatchesFilter(row, "BEYONCE")).toBe(true);
    expect(rowMatchesFilter(row, "  vu ")).toBe(true);
    expect(rowMatchesFilter(row, "glory")).toBe(false);
  });

  it("matches everything for an empty filter", () => {
    expect(rowMatchesFilter(row, "   ")).toBe(true);
  });
});

describe("playlistQueueSummary", () => {
  it("says what was added and what was left out", () => {
    expect(playlistQueueSummary({ added: 38, ready: 38, matching: 3, unavailable: 1 })).toBe(
      "Added 38 · 3 still matching · 1 not found",
    );
  });

  it("mentions songs that were already in the room", () => {
    expect(playlistQueueSummary({ added: 5, ready: 7, matching: 0, unavailable: 0 })).toBe(
      "Added 5 · 2 already in the room",
    );
  });

  it("is plain when everything went in", () => {
    expect(playlistQueueSummary({ added: 12, ready: 12, matching: 0, unavailable: 0 })).toBe("Added 12");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/room/library-rows.test.ts`
Expected: FAIL, with `Failed to resolve import ../../src/lib/room/library-rows`.

- [ ] **Step 3: Write the pure rows module**

Create `src/lib/room/library-rows.ts`:

```ts
import type { AddTrackInput } from "./types";

/**
 * How library songs look and queue in a room, as pure functions. The server
 * actions that use them are in ./library.ts.
 */

/** The songs columns a room reads. */
export interface SongForRoom {
  id: string;
  title: string;
  artists: string[];
  artwork_url: string | null;
  duration_ms: number | null;
  match_state: string;
  video_id: string | null;
  video_duration_ms: number | null;
  match_confidence: string | null;
}

export type LibraryRowState = "ready" | "matching" | "unavailable";

/** Where a song stands with matching, for any list that shows it. */
export interface SongMatchView {
  state: LibraryRowState;
  lowConfidence: boolean;
}

export interface LibraryRow extends SongMatchView {
  songId: string;
  title: string;
  artists: string;
  artworkUrl: string | null;
}

type MatchColumns = Pick<SongForRoom, "match_state" | "video_id" | "video_duration_ms" | "match_confidence">;

function isReady(song: MatchColumns): boolean {
  return song.match_state === "matched" && song.video_id !== null && song.video_duration_ms !== null;
}

export function matchView(song: MatchColumns): SongMatchView {
  const state: LibraryRowState = isReady(song)
    ? "ready"
    : song.match_state === "pending" || song.match_state === "matching"
      ? "matching"
      : "unavailable";
  return { state, lowConfidence: song.match_confidence === "low" };
}

export function toLibraryRow(song: SongForRoom): LibraryRow {
  return {
    songId: song.id,
    title: song.title,
    artists: song.artists.join(", "),
    artworkUrl: song.artwork_url,
    ...matchView(song),
  };
}

/** What enqueueTrack needs for a ready song. The length is the matched
 *  video's: the room clock ends a track on the audio, not on Spotify's
 *  number. */
export function trackFromSong(song: SongForRoom): AddTrackInput | null {
  if (!isReady(song) || song.video_id === null || song.video_duration_ms === null) return null;
  return {
    videoId: song.video_id,
    title: song.title,
    artist: song.artists.join(", "),
    durationMs: song.video_duration_ms,
    thumbnailUrl: song.artwork_url ?? undefined,
  };
}

export function rowNote(view: SongMatchView): string {
  if (view.state === "matching") return " · matching…";
  if (view.state === "unavailable") return " · no match found";
  return view.lowConfidence ? " · ?" : "";
}

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function rowMatchesFilter(row: LibraryRow, filter: string): boolean {
  const needle = fold(filter.trim());
  if (needle === "") return true;
  return fold(`${row.title} ${row.artists}`).includes(needle);
}

export function playlistQueueSummary(counts: {
  added: number;
  ready: number;
  matching: number;
  unavailable: number;
}): string {
  const parts = [`Added ${counts.added}`];
  const alreadyThere = counts.ready - counts.added;
  if (alreadyThere > 0) parts.push(`${alreadyThere} already in the room`);
  if (counts.matching > 0) parts.push(`${counts.matching} still matching`);
  if (counts.unavailable > 0) parts.push(`${counts.unavailable} not found`);
  return parts.join(" · ");
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run test/room/library-rows.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Extract bulk queueing**

Create `src/lib/room/enqueue-many.ts`:

```ts
import "server-only";
import { createClient } from "../supabase/server";
import { enqueueTrack } from "./actions";
import { safeThumbnailUrl } from "./thumbnail";
import { clampText } from "./track-text";
import type { AddTrackInput } from "./types";

/**
 * Queue tracks in order, skipping any already in the room (queued or
 * playing), so adding the same playlist twice doesn't double it. The first
 * goes through enqueueTrack, which starts an idle room; the rest are one
 * insert, stamped a millisecond apart so they keep their order. Returns how
 * many were queued.
 *
 * Not a server action: it trusts its caller's tracks, so it is only ever
 * called from server code that built them.
 */
export async function enqueueMany(roomId: string, tracks: readonly AddTrackInput[]): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const [queueRead, roomRead] = await Promise.all([
    supabase.from("queue_items").select("video_id").eq("room_id", roomId),
    supabase.from("rooms").select("now_playing_video_id").eq("id", roomId).maybeSingle(),
  ]);
  if (queueRead.error) throw new Error(`Reading the queue failed: ${queueRead.error.message}`);
  if (roomRead.error) throw new Error(`Reading the room failed: ${roomRead.error.message}`);
  const present = new Set(((queueRead.data ?? []) as { video_id: string }[]).map((r) => r.video_id));
  const playing = (roomRead.data as { now_playing_video_id: string | null } | null)?.now_playing_video_id;
  if (playing) present.add(playing);

  const fresh = tracks.filter((t) => !present.has(t.videoId));
  const [first, ...rest] = fresh;
  if (!first) return 0;
  await enqueueTrack(roomId, first);
  if (rest.length === 0) return 1;

  const { data: participant } = await supabase
    .from("room_participants")
    .select("name")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  const addedByName = (participant as { name: string | null } | null)?.name ?? null;

  const base = Date.now() + 10;
  const { error } = await supabase.from("queue_items").insert(
    rest.map((t, i) => ({
      room_id: roomId,
      video_id: t.videoId,
      title: clampText(t.title),
      artist: t.artist ? clampText(t.artist) : null,
      duration_ms: t.durationMs,
      thumbnail_url: safeThumbnailUrl(t.thumbnailUrl),
      added_by: user.id,
      added_by_name: addedByName,
      created_at: new Date(base + i).toISOString(),
    })),
  );
  if (error) throw new Error(`Queueing the tracks failed: ${error.message}`);
  return fresh.length;
}
```

In `src/lib/room/add-music.ts`, replace the whole body of `importVideoIds` with:

```ts
async function importVideoIds(
  roomId: string,
  ids: string[],
  youtube: Awaited<ReturnType<typeof youtubeClient>>,
): Promise<number> {
  const metas = (await getVideoMetas(ids, supabaseVideoCache(youtube))).filter(
    (m) => m.embeddable && m.durationMs > 0,
  );
  return enqueueMany(roomId, metas);
}
```

Add `import { enqueueMany } from "./enqueue-many";`, and remove the `createClient` import from `../supabase/server`: `importVideoIds` was its only user. Keep `enqueueTrack`, which `addCandidate`, `addByLink` and `addVideoById` still use.

The move also fixes one thing: the old bulk insert wrote the rest of a playlist's titles and thumbnails unclamped and unchecked. `enqueueMany` applies `clampText` and `safeThumbnailUrl` to every row, as `enqueueTrack` does for the first.

- [ ] **Step 6: Write the room actions**

Create `src/lib/room/library.ts`:

```ts
"use server";

import { createImportService } from "../../audio/imports";
import { mp3serverServiceConfig } from "../spotify/config";
import { getLibraryPlaylists, type LibraryPlaylist } from "../spotify/library";
import { matchResultUpdate } from "../spotify/match-plan";
import { supabaseMatchStore } from "../spotify/match-store";
import { createClient } from "../supabase/server";
import { enqueueTrack } from "./actions";
import { enqueueMany } from "./enqueue-many";
import {
  playlistQueueSummary,
  toLibraryRow,
  trackFromSong,
  type LibraryRow,
  type SongForRoom,
} from "./library-rows";
import type { AddTrackInput } from "./types";

/**
 * The room's Library tab. Every read goes through the caller's own client,
 * so RLS limits it to their library; a song is queued only if it is in their
 * liked songs or one of their playlists.
 */

export type LibraryResult<T> = { ok: true; data: T } | { ok: false; notice: string };

const SONG_COLUMNS =
  "id, title, artists, artwork_url, duration_ms, match_state, video_id, video_duration_ms, match_confidence";
/** Enough to scroll and filter; a library past this shows its newest likes. */
const LIKED_LIMIT = 1000;
const MATCH_TIMEOUT_MS = 20_000;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return { supabase, user };
}

function failed(what: string, err: unknown): { ok: false; notice: string } {
  console.error(`${what} failed:`, err);
  return { ok: false, notice: `${what} failed: ${err instanceof Error ? err.message : String(err)}` };
}

function joinedSong(row: { songs: SongForRoom | null }): SongForRoom {
  if (row.songs === null) throw new Error("library row came back without its song");
  return row.songs;
}

export async function listLikedForRoom(): Promise<LibraryResult<LibraryRow[]>> {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("library_songs")
      .select(`added_at, songs(${SONG_COLUMNS})`)
      .eq("user_id", user.id)
      .order("added_at", { ascending: false })
      .limit(LIKED_LIMIT);
    if (error) throw new Error(error.message);
    return { ok: true, data: ((data ?? []) as unknown as { songs: SongForRoom | null }[]).map((r) => toLibraryRow(joinedSong(r))) };
  } catch (err) {
    return failed("Loading your liked songs", err);
  }
}

export async function listPlaylistsForRoom(): Promise<LibraryResult<LibraryPlaylist[]>> {
  try {
    const { user } = await requireUser();
    return { ok: true, data: await getLibraryPlaylists(user.id) };
  } catch (err) {
    return failed("Loading your playlists", err);
  }
}

async function playlistSongs(playlistId: string): Promise<SongForRoom[]> {
  const { supabase } = await requireUser();
  // RLS returns rows only for the caller's own playlists.
  const { data, error } = await supabase
    .from("playlist_songs")
    .select(`position, songs(${SONG_COLUMNS})`)
    .eq("playlist_id", playlistId)
    .order("position");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { songs: SongForRoom | null }[]).map(joinedSong);
}

export async function listPlaylistSongsForRoom(playlistId: string): Promise<LibraryResult<LibraryRow[]>> {
  try {
    return { ok: true, data: (await playlistSongs(playlistId)).map(toLibraryRow) };
  } catch (err) {
    return failed("Loading that playlist", err);
  }
}

/** Match one song on mp3server now and save the answer on the song. */
async function matchNow(song: SongForRoom): Promise<AddTrackInput | null> {
  const artist = song.artists[0];
  if (!artist) throw new Error(`song ${song.id} has no artist to match on`);
  const result = await createImportService({ ...mp3serverServiceConfig(), timeoutMs: MATCH_TIMEOUT_MS }).matchOne({
    title: song.title,
    artist,
    durationMs: song.duration_ms,
  });
  const update = matchResultUpdate(song.id, result);
  await supabaseMatchStore().applyUpdates([update]);
  if (update.state !== "matched") return null;
  return trackFromSong({
    ...song,
    match_state: "matched",
    video_id: update.videoId,
    video_duration_ms: update.videoDurationMs,
    match_confidence: update.confidence,
  });
}

export async function queueLibrarySong(roomId: string, songId: string): Promise<LibraryResult<string>> {
  try {
    const { supabase, user } = await requireUser();
    const [liked, listed] = await Promise.all([
      supabase.from("library_songs").select("song_id").eq("user_id", user.id).eq("song_id", songId).limit(1),
      // RLS limits playlist_songs to the caller's own playlists
      supabase.from("playlist_songs").select("song_id").eq("song_id", songId).limit(1),
    ]);
    if (liked.error) throw new Error(liked.error.message);
    if (listed.error) throw new Error(listed.error.message);
    if ((liked.data ?? []).length === 0 && (listed.data ?? []).length === 0) {
      return { ok: false, notice: "That song isn't in your library." };
    }

    const { data, error } = await supabase.from("songs").select(SONG_COLUMNS).eq("id", songId).single();
    if (error) throw new Error(error.message);
    const song = data as SongForRoom;

    let track = trackFromSong(song);
    if (track === null) {
      if (song.match_state === "not_found" || song.match_state === "failed") {
        return { ok: false, notice: `No playable match was found for “${song.title}”.` };
      }
      try {
        track = await matchNow(song);
      } catch (err) {
        // A timeout or a failed search saves nothing, so the song stays
        // pending and the background matching picks it up.
        console.error(`Matching song ${song.id} on click failed:`, err);
        return {
          ok: false,
          notice: `Couldn’t match “${song.title}” just now. It’s still in line to be matched; try again later.`,
        };
      }
      if (track === null) return { ok: false, notice: `No playable match was found for “${song.title}”.` };
    }

    await enqueueTrack(roomId, track);
    return { ok: true, data: `Added “${song.title}”` };
  } catch (err) {
    return failed("Adding that song", err);
  }
}

export async function queueLibraryPlaylist(roomId: string, playlistId: string): Promise<LibraryResult<string>> {
  try {
    const songs = await playlistSongs(playlistId);
    const tracks = songs.map(trackFromSong).filter((t): t is AddTrackInput => t !== null);
    const added = await enqueueMany(roomId, tracks);
    const states = songs.map((s) => toLibraryRow(s).state);
    return {
      ok: true,
      data: playlistQueueSummary({
        added,
        ready: tracks.length,
        matching: states.filter((s) => s === "matching").length,
        unavailable: states.filter((s) => s === "unavailable").length,
      }),
    };
  } catch (err) {
    return failed("Queueing that playlist", err);
  }
}
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: every test passes, no type errors, and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/lib/room/library-rows.ts src/lib/room/enqueue-many.ts src/lib/room/library.ts src/lib/room/add-music.ts test/room/library-rows.test.ts
git commit -m "Queue library songs and playlists in a room

A matched song goes into the queue with the video's own length and
Spotify's title, artists and art. An unmatched one is matched on the spot
through mp3server's /match and saved on the song. A playlist queues its
matched songs in order and says what it left out. Bulk queueing moves into
enqueueMany, which the YouTube playlist import now shares."
git push
```

---

### Task 10 (june): Split the add-music panel, one component per tab

This task only restructures code. Behavior must not change, except that each tab keeps its own state (search, open playlist) across tab switches. That already held for search, and now holds for both tabs.

**Files:**
- Delete: `app/room/[code]/add-music.tsx`
- Create: `app/room/[code]/add-music/index.tsx`, `runner.ts`, `cover.tsx`, `playlist-view.tsx`, `search-tab.tsx`, `playlists-tab.tsx`
- Modify: `app/globals.css` (two pane classes)

`app/room/[code]/room.tsx` imports `{ AddMusic } from "./add-music"`. That import resolves to the new folder's `index.tsx` unchanged.

**Interfaces:**
- Produces:
  - `runner.ts`:
    - `type ActionResult<T> = { ok: true; data: T } | { ok: false; notice: string }`
    - `unwrap<T>(result: ActionResult<T>): T`
    - `interface AddRunner { busy: boolean; run<T>(fn: () => Promise<T>, ok?: (result: T) => string): void }`
    - `useAddRunner(): AddRunner & { message: string | null; clearMessage(): void }`
  - `cover.tsx`: `Cover({ url }: { url?: string | null })`

- [ ] **Step 1: Create the shared pieces**

Create `app/room/[code]/add-music/runner.ts`:

```ts
"use client";

import { useCallback, useState } from "react";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; notice: string };

/** Unwrap a server action's result, throwing its notice so `run` shows it. A
 *  client-side throw isn't redacted the way the server's raw error would be. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.notice);
  return result.data;
}

export interface AddRunner {
  busy: boolean;
  run<T>(fn: () => Promise<T>, ok?: (result: T) => string): void;
}

/** The panel's one busy flag and one message line, shared by every tab, so
 *  a slow add in one tab can't be started twice from another. */
export function useAddRunner(): AddRunner & { message: string | null; clearMessage: () => void } {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(<T>(fn: () => Promise<T>, ok?: (result: T) => string) => {
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const result = await fn();
        if (ok) setMessage(ok(result));
      } catch (e) {
        setMessage((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const clearMessage = useCallback(() => setMessage(null), []);
  return { busy, message, clearMessage, run };
}
```

Create `app/room/[code]/add-music/cover.tsx`:

```tsx
import { Music } from "lucide-react";

/** A consistently framed cover thumbnail, with a music-note fallback. */
export function Cover({ url }: { url?: string | null }) {
  return (
    <div className="add__cover">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" />
      ) : (
        <Music size={16} />
      )}
    </div>
  );
}
```

Create `app/room/[code]/add-music/playlist-view.tsx`:

```tsx
"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { addVideoById } from "@/src/lib/room/add-music";
import type { VideoMeta } from "@/src/lib/video-cache";
import type { Playlist } from "../playlist-carousel";
import { Cover } from "./cover";
import { unwrap, type AddRunner } from "./runner";

/** A YouTube playlist opened for picking: back, its title, "Add all", and
 *  its songs. Used by the search tab (a pasted link) and the playlists tab. */
export function PlaylistView({
  roomId,
  playlist,
  tracks,
  truncated,
  backLabel,
  onBack,
  onAddAll,
  runner,
}: {
  roomId: string;
  playlist: Playlist;
  tracks: VideoMeta[] | null;
  truncated: boolean;
  backLabel: string;
  onBack: () => void;
  onAddAll: () => Promise<number>;
  runner: AddRunner;
}) {
  const { busy, run } = runner;
  return (
    <>
      <div className="add__plhead">
        <button className="btn btn--sm" onClick={onBack}>
          <ArrowLeft size={15} />
          {backLabel}
        </button>
        <span className="add__pltitle">{playlist.title}</span>
        <button className="btn btn--sm" disabled={busy} onClick={() => run(onAddAll, (n) => `Added ${n} songs.`)}>
          Add all
        </button>
      </div>
      {truncated && (
        <p className="add__hint">
          Showing the first {tracks?.length ?? 0} of {playlist.itemCount}. “Add all” takes the whole playlist.
        </p>
      )}
      {tracks === null ? (
        <p className="muted">Loading songs…</p>
      ) : (
        <ul className="add__list">
          {tracks.map((t) => (
            <li key={t.videoId} className="add__result">
              <Cover url={t.thumbnailUrl} />
              <div className="add__meta">
                <div className="add__title">{t.title}</div>
                <div className="add__sub">
                  {t.artist ?? ""}
                  {!t.embeddable ? " · can’t play here" : ""}
                </div>
              </div>
              <button
                className="add__btn"
                disabled={busy || !t.embeddable}
                aria-label={`Add ${t.title}`}
                onClick={() =>
                  run(
                    async () => unwrap(await addVideoById(roomId, t.videoId)),
                    () => `Added “${t.title}”`,
                  )
                }
              >
                <Plus size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 2: Create the two tabs**

Create `app/room/[code]/add-music/search-tab.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Disc3, Plus } from "lucide-react";
import type { ArtistCandidate, MusicCandidate } from "@/src/discovery";
import {
  AUTO_SEARCH_DEBOUNCE_MS,
  createRequestGate,
  shouldAutoSearch,
} from "@/src/discovery/typeahead";
import {
  addByLink,
  addCandidate,
  addPlaylistByLink,
  getArtistTopSongsAction,
  getPlaylistByLink,
  searchMusicAction,
} from "@/src/lib/room/add-music";
import type { VideoMeta } from "@/src/lib/video-cache";
import { parsePlaylistId } from "@/src/youtube/url";
import type { Playlist } from "../playlist-carousel";
import { Cover } from "./cover";
import { PlaylistView } from "./playlist-view";
import { unwrap, type AddRunner } from "./runner";

/** A pasted YouTube link is added directly; anything else is searched. */
const YT_LINK = /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i;

interface PastedPlaylist {
  link: string;
  playlist: Playlist;
  tracks: VideoMeta[];
  truncated: boolean;
}

/** Search as you type, the artist view it opens, and a pasted playlist link
 *  opened for picking. */
export function SearchTab({ roomId, runner }: { roomId: string; runner: AddRunner }) {
  const { busy, run } = runner;
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const searchGate = useRef(createRequestGate());
  const [results, setResults] = useState<MusicCandidate[]>([]);
  const [artist, setArtist] = useState<ArtistCandidate | null>(null);
  const [artistView, setArtistView] = useState<ArtistCandidate | null>(null);
  const [artistSongs, setArtistSongs] = useState<MusicCandidate[] | null>(null);
  const [pasted, setPasted] = useState<PastedPlaylist | null>(null);

  const trimmed = query.trim();
  const isLink = YT_LINK.test(trimmed);
  // Only a link that names a playlist and no single video; the same rule the
  // server applies, so the button label matches what will happen.
  const isPlaylistLink = parsePlaylistId(trimmed) !== null;

  function clearSearch() {
    setQuery("");
    setResults([]);
    setArtist(null);
  }

  // Search while typing. The gate makes the newest request the only one that
  // can write results, so a slow response to a half-typed query can't land
  // last and replace better ones. Pressing Search still works and goes
  // through submitSearch — it shares the same gate, so whichever request was
  // started last wins there too.
  useEffect(() => {
    if (!shouldAutoSearch(query, isLink)) return;

    const timer = setTimeout(() => {
      const token = searchGate.current.begin();
      setSearching(true);
      void searchMusicAction(query.trim())
        .then((result) => {
          if (!searchGate.current.accept(token)) return;
          setResults(result.songs);
          setArtist(result.artist);
        })
        .catch(() => {
          // Typeahead is opportunistic: a failed keystroke-search leaves the
          // previous results alone and says nothing. Pressing Search runs the
          // same query through `run`, which does report the failure.
        })
        .finally(() => {
          if (searchGate.current.accept(token)) setSearching(false);
        });
    }, AUTO_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, isLink]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    if (isPlaylistLink) {
      // A playlist link opens the list to pick from rather than emptying it
      // into the room; "Add all" in that view is the whole-playlist path. A
      // link naming both a video and a playlist isn't a playlist link (see
      // parsePlaylistId), so sharing one track from a playlist still adds it.
      const link = trimmed;
      run(async () => {
        const view = unwrap(await getPlaylistByLink(link));
        setPasted({
          link,
          playlist: {
            id: view.playlist.id,
            title: view.playlist.title,
            itemCount: view.playlist.itemCount,
            thumbnailUrl: view.playlist.thumbnailUrl ?? undefined,
          },
          tracks: view.tracks,
          truncated: view.truncated,
        });
        clearSearch();
      });
    } else if (isLink) {
      // Paste-a-link, folded into the same field.
      run(
        async () => unwrap(await addByLink(roomId, trimmed)),
        () => {
          clearSearch();
          return "Added to the queue.";
        },
      );
    } else {
      const token = searchGate.current.begin();
      run(async () => {
        const result = await searchMusicAction(trimmed);
        if (!searchGate.current.accept(token)) return;
        setResults(result.songs);
        setArtist(result.artist);
      });
    }
  }

  function openArtist(a: ArtistCandidate) {
    setArtistView(a);
    setArtistSongs(null);
    run(async () => setArtistSongs(await getArtistTopSongsAction(a.artistId)));
  }

  function closeArtist() {
    setArtistView(null);
    setArtistSongs(null);
  }

  /** One addable song row, shared by the search results and the artist view. */
  function songRow(c: MusicCandidate) {
    return (
      <li key={c.sourceId} className="add__result">
        <Cover url={c.artworkUrl} />
        <div className="add__meta">
          <div className="add__title">{c.title}</div>
          <div className="add__sub">{c.artist}</div>
        </div>
        <button
          className="add__btn"
          disabled={busy}
          aria-label={`Add ${c.title}`}
          onClick={() =>
            run(
              async () => unwrap(await addCandidate(roomId, c)),
              // The results stay put: queueing one song from a search is
              // usually the first of several, and clearing the list made you
              // type the query again to add the next one.
              () => `Added “${c.title}”`,
            )
          }
        >
          <Plus size={16} />
        </button>
      </li>
    );
  }

  if (pasted) {
    return (
      <PlaylistView
        roomId={roomId}
        playlist={pasted.playlist}
        tracks={pasted.tracks}
        truncated={pasted.truncated}
        backLabel="Search"
        onBack={() => setPasted(null)}
        onAddAll={async () => unwrap(await addPlaylistByLink(roomId, pasted.link))}
        runner={runner}
      />
    );
  }

  if (artistView) {
    return (
      <>
        <div className="add__plhead">
          <button className="btn btn--sm" onClick={closeArtist}>
            <ArrowLeft size={15} />
            Back
          </button>
          <span className="add__pltitle">{artistView.name}</span>
        </div>
        {artistSongs === null ? (
          <p className="muted">Loading songs…</p>
        ) : artistSongs.length === 0 ? (
          <p className="muted">No songs found for this artist.</p>
        ) : (
          <ul className="add__list">{artistSongs.map(songRow)}</ul>
        )}
      </>
    );
  }

  return (
    <>
      <form className="add__search" onSubmit={submitSearch}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a song, or paste a YouTube link"
          aria-label="Search or paste a link"
        />
        <button
          type="submit"
          className={isLink || isPlaylistLink ? "btn btn--primary" : "btn"}
          disabled={busy}
        >
          {isPlaylistLink ? "Add playlist" : isLink ? "Add" : "Search"}
        </button>
      </form>
      {/* Only while nothing is on screen yet: once results are up, the
          next keystroke's search replaces them in place, and a spinner
          over stale-but-useful results is just flicker. */}
      {searching && results.length === 0 && (
        <p className="add__hint" role="status">
          Searching…
        </p>
      )}
      {artist && (
        <button
          className="add__artistchip"
          disabled={busy}
          onClick={() => openArtist(artist)}
          aria-label={`Open ${artist.name}`}
        >
          <div className="add__cover">
            <Disc3 size={16} />
          </div>
          <div className="add__meta">
            <div className="add__title">{artist.name}</div>
            <div className="add__sub">Artist{artist.genre ? ` · ${artist.genre}` : ""}</div>
          </div>
          <ChevronRight className="add__chev" size={16} />
        </button>
      )}
      {results.length > 0 && <ul className="add__list">{results.map(songRow)}</ul>}
    </>
  );
}
```

Create `app/room/[code]/add-music/playlists-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { getPlaylistTracks, importPlaylistToRoom, listMyPlaylists } from "@/src/lib/room/add-music";
import type { VideoMeta } from "@/src/lib/video-cache";
import { PlaylistCarousel, type Playlist } from "../playlist-carousel";
import { PlaylistView } from "./playlist-view";
import { unwrap, type AddRunner } from "./runner";

/** The signed-in user's own YouTube playlists, and one opened for picking. */
export function PlaylistsTab({ roomId, runner }: { roomId: string; runner: AddRunner }) {
  const { busy, run } = runner;
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [open, setOpen] = useState<{ playlist: Playlist; tracks: VideoMeta[] | null } | null>(null);

  function loadPlaylists() {
    run(async () => setPlaylists(unwrap(await listMyPlaylists())));
  }

  function browse(playlist: Playlist) {
    setOpen({ playlist, tracks: null });
    run(async () => {
      const tracks = unwrap(await getPlaylistTracks(playlist.id));
      // Ignore a late answer for a playlist that is no longer open.
      setOpen((current) => (current?.playlist.id === playlist.id ? { playlist, tracks } : current));
    });
  }

  if (open) {
    return (
      <PlaylistView
        roomId={roomId}
        playlist={open.playlist}
        tracks={open.tracks}
        truncated={false}
        backLabel="Playlists"
        onBack={() => setOpen(null)}
        onAddAll={async () => unwrap(await importPlaylistToRoom(roomId, open.playlist.id))}
        runner={runner}
      />
    );
  }

  return !playlists ? (
    <button className="btn" disabled={busy} onClick={loadPlaylists}>
      Load my playlists
    </button>
  ) : (
    <PlaylistCarousel playlists={playlists} busy={busy} onOpen={browse} onRefresh={loadPlaylists} />
  );
}
```

- [ ] **Step 3: Create the shell and remove the old file**

Create `app/room/[code]/add-music/index.tsx`:

```tsx
"use client";

import { useState } from "react";
import { PlaylistsTab } from "./playlists-tab";
import { useAddRunner } from "./runner";
import { SearchTab } from "./search-tab";

type Tab = "search" | "playlist";

const TABS: { id: Tab; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "playlist", label: "My playlists" },
];

export function AddMusic({ roomId }: { roomId: string }) {
  const [tab, setTab] = useState<Tab>("search");
  const runner = useAddRunner();

  return (
    <div className="add">
      <div className="eyebrow">Add music</div>

      <div className="add__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`add__tab${tab === t.id ? " add__tab--on" : ""}`}
            onClick={() => {
              setTab(t.id);
              runner.clearMessage();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Every tab stays mounted and is only hidden, so a search or an open
          playlist survives a trip to another tab. */}
      <div className={tab === "search" ? "add__pane" : "add__pane add__pane--off"}>
        <SearchTab roomId={roomId} runner={runner} />
      </div>
      <div className={tab === "playlist" ? "add__pane" : "add__pane add__pane--off"}>
        <PlaylistsTab roomId={roomId} runner={runner} />
      </div>

      {runner.message && <p className="add__msg">{runner.message}</p>}
    </div>
  );
}
```

Delete the old file:

```bash
git rm "app/room/[code]/add-music.tsx"
```

In `app/globals.css`, add immediately after the `.add__tabs { … }` rule:

```css
/* A tab's content, laid out as if its children sat directly in .add. */
.add__pane {
  display: contents;
}
.add__pane--off {
  display: none;
}
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: every test passes (including the design tokens test), no type errors, and the build succeeds.

Check that nothing else imported the deleted file by a path other than `./add-music`:

Run: `grep -rn "add-music\"" app src | grep -v "lib/room/add-music"`
Expected: only `app/room/[code]/room.tsx` importing `./add-music`.

- [ ] **Step 5: Commit**

```bash
git add "app/room/[code]/add-music" app/globals.css
git commit -m "Split the add-music panel into one component per tab

The panel had grown to 406 lines holding every tab's state. A thin shell
now owns the tabs, the shared busy flag and the message line; search and
My playlists are their own components, sharing a playlist view and a
cover. Tabs stay mounted while hidden, so each keeps its state. This makes
room for the Library tab."
git push
```

---

### Task 11 (june): The Library tab, and match state on /library

**Files:**
- Create: `app/room/[code]/add-music/library-tab.tsx`
- Modify: `app/room/[code]/add-music/index.tsx`, `app/globals.css`, `src/lib/spotify/library.ts`, `app/library/song-list.tsx`

**Interfaces:**
- Consumes:
  - the actions in `src/lib/room/library.ts`
  - `LibraryRow`, `matchView`, `rowMatchesFilter`, `rowNote` (Task 9)
  - `LibraryPlaylist` from `src/lib/spotify/library.ts` (type only, so the client bundle never pulls in that server-only module)
  - `Cover`, `unwrap`, `AddRunner` (Task 10)

- [ ] **Step 1: Write the tab**

Create `app/room/[code]/add-music/library-tab.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, LoaderCircle, Plus } from "lucide-react";
import {
  listLikedForRoom,
  listPlaylistSongsForRoom,
  listPlaylistsForRoom,
  queueLibraryPlaylist,
  queueLibrarySong,
} from "@/src/lib/room/library";
import { rowMatchesFilter, rowNote, type LibraryRow } from "@/src/lib/room/library-rows";
import type { LibraryPlaylist } from "@/src/lib/spotify/library";
import { Cover } from "./cover";
import { unwrap, type AddRunner } from "./runner";

type View = "liked" | "playlists";

/** The user's Spotify library: liked songs (filterable) and their own
 *  playlists, each song addable once it's matched to a video. */
export function LibraryTab({ roomId, runner, active }: { roomId: string; runner: AddRunner; active: boolean }) {
  const { busy, run } = runner;
  const [view, setView] = useState<View>("liked");
  const [liked, setLiked] = useState<LibraryRow[] | null>(null);
  const [playlists, setPlaylists] = useState<LibraryPlaylist[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<{ playlist: LibraryPlaylist; rows: LibraryRow[] | null } | null>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    run(async () => {
      try {
        const [songs, lists] = await Promise.all([listLikedForRoom(), listPlaylistsForRoom()]);
        setLiked(unwrap(songs));
        setPlaylists(unwrap(lists));
      } catch (e) {
        setLoadFailed(true);
        throw e;
      }
    });
  }, [run]);

  // Loaded the first time the tab is shown, not with the room: most jams
  // never open it.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!active || started) return;
    setStarted(true);
    load();
  }, [active, started, load]);

  /** A queued song is matched by now, even if the list still said otherwise. */
  function markReady(songId: string) {
    const ready = (rows: LibraryRow[]) =>
      rows.map((r) => (r.songId === songId ? { ...r, state: "ready" as const } : r));
    setLiked((rows) => (rows ? ready(rows) : rows));
    setOpen((current) => (current?.rows ? { ...current, rows: ready(current.rows) } : current));
  }

  function queue(row: LibraryRow) {
    run(
      async () => {
        const notice = unwrap(await queueLibrarySong(roomId, row.songId));
        markReady(row.songId);
        return notice;
      },
      (notice) => notice,
    );
  }

  function openPlaylist(playlist: LibraryPlaylist) {
    setOpen({ playlist, rows: null });
    run(async () => {
      const rows = unwrap(await listPlaylistSongsForRoom(playlist.id));
      setOpen((current) => (current?.playlist.id === playlist.id ? { playlist, rows } : current));
    });
  }

  function songList(rows: LibraryRow[]) {
    return (
      <ul className="add__list">
        {rows.map((row) => (
          <li
            key={row.songId}
            className={row.state === "unavailable" ? "add__result add__result--off" : "add__result"}
          >
            <Cover url={row.artworkUrl} />
            <div className="add__meta">
              <div className="add__title">{row.title}</div>
              <div className="add__sub">
                {row.artists}
                {rowNote(row)}
                {row.state === "matching" && <LoaderCircle className="spin add__spin" size={11} aria-hidden />}
              </div>
            </div>
            <button
              className="add__btn"
              disabled={busy || row.state === "unavailable"}
              aria-label={`Add ${row.title}`}
              onClick={() => queue(row)}
            >
              <Plus size={16} />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (liked === null || playlists === null) {
    return loadFailed ? (
      <p className="muted">
        Couldn’t load your library.{" "}
        <button className="btn btn--sm" disabled={busy} onClick={load}>
          Try again
        </button>
      </p>
    ) : (
      <p className="muted">Loading your library…</p>
    );
  }

  if (liked.length === 0 && playlists.length === 0) {
    return (
      <p className="muted">
        Nothing here yet. Connect Spotify on your <Link href="/library">Library</Link> page and your liked
        songs and playlists show up here.
      </p>
    );
  }

  if (open) {
    return (
      <>
        <div className="add__plhead">
          <button className="btn btn--sm" onClick={() => setOpen(null)}>
            <ArrowLeft size={15} />
            Playlists
          </button>
          <span className="add__pltitle">{open.playlist.name}</span>
          <button
            className="btn btn--sm"
            disabled={busy}
            onClick={() =>
              run(
                async () => unwrap(await queueLibraryPlaylist(roomId, open.playlist.id)),
                (summary) => summary,
              )
            }
          >
            Queue playlist
          </button>
        </div>
        {open.rows === null ? <p className="muted">Loading songs…</p> : songList(open.rows)}
      </>
    );
  }

  const shown = liked.filter((row) => rowMatchesFilter(row, filter));

  return (
    <>
      <div className="add__switch" role="group" aria-label="Library view">
        {(["liked", "playlists"] as const).map((v) => (
          <button
            key={v}
            className={view === v ? "btn btn--sm btn--primary" : "btn btn--sm"}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v === "liked" ? "Liked" : "Playlists"}
          </button>
        ))}
      </div>

      {view === "liked" ? (
        liked.length === 0 ? (
          <p className="muted">No liked songs yet.</p>
        ) : (
          <>
            <input
              className="input add__filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter your liked songs"
              aria-label="Filter liked songs"
            />
            {shown.length === 0 ? (
              <p className="muted">No liked songs match “{filter.trim()}”.</p>
            ) : (
              songList(shown)
            )}
          </>
        )
      ) : playlists.length === 0 ? (
        <p className="muted">No playlists yet. Only playlists you made or collaborate on come across.</p>
      ) : (
        <ul className="add__list">
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                className="add__artistchip"
                disabled={busy}
                onClick={() => openPlaylist(p)}
                aria-label={`Open ${p.name}`}
              >
                <Cover url={p.artworkUrl} />
                <div className="add__meta">
                  <div className="add__title">{p.name}</div>
                  <div className="add__sub">
                    {p.songCount} {p.songCount === 1 ? "song" : "songs"}
                  </div>
                </div>
                <ChevronRight className="add__chev" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 2: Add it to the shell**

In `app/room/[code]/add-music/index.tsx`:

```tsx
import { LibraryTab } from "./library-tab";
```

```tsx
type Tab = "search" | "playlist" | "library";

const TABS: { id: Tab; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "playlist", label: "My playlists" },
  { id: "library", label: "Library" },
];
```

After the playlists pane:

```tsx
      <div className={tab === "library" ? "add__pane" : "add__pane add__pane--off"}>
        <LibraryTab roomId={roomId} runner={runner} active={tab === "library"} />
      </div>
```

- [ ] **Step 3: Style it**

In `app/globals.css`, after the `.add__pane--off` rule from Task 10:

```css
.add__switch {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.add__filter {
  width: 100%;
  margin-bottom: var(--space-4);
}
/* A song with no playable match: still listed, never silently dropped. */
.add__result--off {
  opacity: 0.5;
}
.add__spin {
  margin-left: var(--space-1);
  vertical-align: middle;
}
```

- [ ] **Step 4: Show match state on /library**

The spec has `/library` list songs the way the Library tab does, so each liked song and recent play there carries the same note ("matching…", "no match found", "?"). `rowNote` and `matchView` (Task 9) are pure, so they're already tested; this step is wiring.

In `src/lib/spotify/library.ts`, import them:

```ts
import { matchView, rowNote } from "../room/library-rows";
```

Give `LibrarySong` the note:

```ts
export interface LibrarySong {
  title: string;
  artists: string[];
  artworkUrl: string | null;
  /** When it was liked or played. */
  at: string;
  /** Where matching stands, in the room's words; "" once it's playable. */
  matchNote: string;
}
```

Widen the join and fill the note:

```ts
type SongJoin = {
  title: string;
  artists: string[];
  artwork_url: string | null;
  match_state: string;
  video_id: string | null;
  video_duration_ms: number | null;
  match_confidence: string | null;
} | null;

const SONG_JOIN = "songs(title, artists, artwork_url, match_state, video_id, video_duration_ms, match_confidence)";

function toLibrarySong(song: SongJoin, at: string): LibrarySong {
  // song_id is a non-null foreign key, so a missing song is a broken read.
  if (song === null) throw new Error("library row came back without its song");
  return {
    title: song.title,
    artists: song.artists,
    artworkUrl: song.artwork_url,
    at,
    matchNote: rowNote(matchView(song)),
  };
}
```

In `getLikedSongs`, the select becomes `` `added_at, ${SONG_JOIN}` ``; in `getRecentListens`, `` `played_at, ${SONG_JOIN}` ``.

In `app/library/song-list.tsx`, the sub line gains the note:

```tsx
            <span className="home-play__sub">
              {song.artists.join(", ")} · {when(song.at, now)}
              {song.matchNote}
            </span>
```

- [ ] **Step 5: Verify**


Run: `npm test && npm run typecheck && npm run build`
Expected: every test passes (including the design tokens test), no type errors, and the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add "app/room/[code]/add-music/library-tab.tsx" "app/room/[code]/add-music/index.tsx" app/globals.css src/lib/spotify/library.ts app/library/song-list.tsx
git commit -m "Add a Library tab to the room's add-music panel

Liked songs, filterable, and the user's own playlists, each song showing
whether it's ready, still matching, or has no match. Adding a ready song
queues it; adding one still matching matches it on the spot; a playlist
queues its matched songs and says what it left out. Loaded the first time
the tab is opened. /library shows the same match state on its lists."
git push
```

---

### Task 12 (june): Docs and env

**Files:**
- Modify: `.env.local.example`, `README.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: The env example**

Append to `.env.local.example`:

```bash

# Library matching (server-only): the same value as SERVICE_TOKEN in
# mp3server's .env. june's server uses it to submit Spotify songs for matching
# and to match one song when someone adds it in a room.
MP3SERVER_SERVICE_TOKEN=
```

- [ ] **Step 2: The README**

In `README.md`'s env table, after the `SPOTIFY_SYNC_SECRET` row:

```markdown
| `MP3SERVER_SERVICE_TOKEN` | Library matching: june's server → mp3server (same as its `SERVICE_TOKEN`) |
```

Replace the **Spotify library** feature bullet with:

```markdown
- **Spotify library** — connect Spotify to bring in liked songs, your own
  playlists, recent plays and top artists, synced every 30 minutes, and
  queue them from the Library tab in any room. Spotify's Development Mode
  limits this to five accounts.
```

- [ ] **Step 3: The architecture doc**

In `docs/ARCHITECTURE.md`, in the "## Repositories" section, replace the sentence "They are deployed independently. june talks to mp3server **from the browser**, not server-to-server." with:

```markdown
They are deployed independently. june talks to mp3server mostly **from the
browser**. The exception is library matching: june's server calls
`POST /imports`, `GET /imports/{id}` and `POST /match` with a shared service
token (`MP3SERVER_SERVICE_TOKEN` = mp3server's `SERVICE_TOKEN`), which opens
those three routes and nothing else.
```

In the "## Spotify library" section, append:

```markdown
**Matching.** Every sync run ends by matching songs to videos on mp3server.
It first collects results for songs in `matching` (by their import's id and
their position in it), then submits up to 500 `pending` songs as one import.
mp3server's resolver paces its searches to one every 3 seconds and runs one
at a time, so bulk matching doesn't get the home IP flagged; cache hits don't
wait. Results come back with the video's own length (`video_duration_ms`),
which is what a room queues: the room clock ends a track on the audio.

**In a room**, the add-music panel's Library tab lists liked songs and the
user's own playlists. A matched song queues directly. One still matching is
matched on the spot through `POST /match`, which searches inline instead of
waiting behind a batch. A playlist queues its matched songs and reports what
it left out.
```

- [ ] **Step 4: Commit**

```bash
git add .env.local.example README.md docs/ARCHITECTURE.md
git commit -m "Document library matching

The service token, the one server-to-server path from june to mp3server,
how the sync run matches songs in paced batches, and the room's Library
tab."
git push
```

---

### Task 13: Ship it (with the user)

This task needs the user. Deploying mp3server means SSH to the homelab VM: the Mac must be on the home LAN, or have Tailscale running. Setting a Vercel variable needs them signed in.

- [ ] **Step 1: Generate the service token**

```bash
cd /Users/jacobdang/Projects/june
T=$(openssl rand -hex 32)
grep -q '^MP3SERVER_SERVICE_TOKEN=' .env.local && sed -i '' "s/^MP3SERVER_SERVICE_TOKEN=.*/MP3SERVER_SERVICE_TOKEN=$T/" .env.local || printf '\nMP3SERVER_SERVICE_TOKEN=%s\n' "$T" >> .env.local
```

Do not print the value.

- [ ] **Step 2: mp3server — PR, merge, deploy**

Open the PR from `library-matching` in JacobTDang/mp3server, titled "Service token, matched lengths, paced resolver and /match". The body says what changed and why. Merge it once the user approves.

Then, on the VM (find its address first; it was `jacob@192.168.1.36`):

```bash
cd ~/mp3server && git pull
grep -n '^MAX_PARALLEL_RESOLVE_JOBS\|^SERVICE_TOKEN' .env   # remove any MAX_PARALLEL_RESOLVE_JOBS line; it must default to 1
printf 'SERVICE_TOKEN=%s\n' '<the value from june/.env.local>' >> .env
docker compose up -d --build
docker compose run --rm api alembic upgrade head
docker compose ps
```

Expected:
- every service is healthy;
- alembic reports it upgraded to `0005`;
- `docker compose logs resolver --since 2m` shows no errors.

- [ ] **Step 3: Check mp3server from outside**

From the Mac:

```bash
T=$(grep -E '^MP3SERVER_SERVICE_TOKEN=' .env.local | cut -d= -f2-)
curl -s -X POST https://june-audio.taild5ebc0.ts.net/match -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"title":"Glory Box","artist":"Portishead","duration_ms":305000}'
curl -s -o /dev/null -w '%{http_code}\n' https://june-audio.taild5ebc0.ts.net/downloads -H "Authorization: Bearer $T"
```

Expected:
- the first returns `"state":"resolved"` with a `matched_duration_ms`;
- the second returns `401`, because the service token doesn't open `/downloads`.

- [ ] **Step 4: Match the library locally**

Run `npm run dev`. Browse at `http://127.0.0.1:3000` (see `allowedDevOrigins`). Then trigger a sync:

```bash
S=$(grep -E '^SPOTIFY_SYNC_SECRET=' .env.local | cut -d= -f2-)
curl -s -X POST -H "Authorization: Bearer $S" http://127.0.0.1:3000/api/spotify/sync
```

With the Supabase MCP `execute_sql`:

```sql
select match_state, count(*) from public.songs group by 1 order by 1;
```

Expected: songs in `matching`, and fewer (or none) in `pending`. The resolver then works through them at one every 3 seconds; about 150 songs takes around 8 minutes. Trigger the sync again after that.

Expected: most songs `matched`, some `not_found`, none stuck.

- [ ] **Step 5: Play from the library (user in the browser)**

In a room at `127.0.0.1:3000`, the user opens **Add music → Library** and checks:
- The liked songs list shows, with art. The filter narrows it.
- Adding a matched song queues it. It plays in sync in a second browser, and the track ends when the audio ends (not early, not with trailing silence).
- A song still `pending` (flip one back with `update public.songs set match_state='pending', video_id=null, video_duration_ms=null where id='<id>'`) shows "matching…". Adding it matches it within a few seconds and queues it.
- **Playlists**: opening one lists its songs, and **Queue playlist** reports something like "Added 12 · 1 not found".
- The **Search** and **My playlists** tabs still work as before.

- [ ] **Step 6: Ship june**

1. Add `MP3SERVER_SERVICE_TOKEN` to Vercel Production, with the same value.
2. Open the PR from `library-matching`, titled "Play your Spotify library in rooms". The body says what changed and why; no screenshots of personal data, since the repo is public.
3. Merge it once the user approves.
4. After the deploy, confirm the next cron run still returns `202`, and that `matching` isn't null. Check that from the logs, or by the `songs` states moving on.

- [ ] **Step 7: Update the board and memory**

- Mark the matching pieces as built on the linkC board.
- Update `spotify-library-status` in memory: phase 2 shipped, phase 3 next.
