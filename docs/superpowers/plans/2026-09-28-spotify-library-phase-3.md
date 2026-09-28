# Spotify Library, Phase 3 (Keep Library Audio at Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every song in anyone's Spotify library has its audio stored on the homelab. It is fetched slowly in the background and never evicted while a library holds it.

**Architecture:**
- **june:** each sync run ends by sending mp3server the full keep list. That list is every matched video id reachable from `library_songs` or `playlist_songs`, sent as `PUT /pins` with the service token.
- **mp3server:** stores the list as a `pins` table. Cache expiry and eviction skip pinned tracks. A new cron job, `prefetch_pins`, starts at most one background download at a time, only when the server is idle. It is rate-limited, keeps a disk reserve, and stands down for 6 hours after a YouTube bot check.
- **Homelab VM:** its disk grows from 40 GB to about 100 GB.

**Tech Stack:**
- **june:** Next.js 16, TypeScript strict, Zod 4, Supabase (`SECURITY DEFINER` function), Vitest.
- **mp3server:** FastAPI, SQLAlchemy async, Alembic, arq (cron), pytest.

**Spec:** `docs/superpowers/specs/2026-09-25-spotify-library-design.md`, section "Keeping audio at home (phase 3)". Phase 2 (matching, Library tab) shipped in june #108 and mp3server #5.

## Global Constraints

- **Two repos.**
  - Tasks 1–3 are in `/Users/jacobdang/Projects/mp3server`, on branch `library-pins` created from `main`.
  - Tasks 4–6 are in `/Users/jacobdang/Projects/june`, on branch `library-pins`. It already exists and holds this plan.
  - Task 7 ships both.
- **No new dependencies** in either repo.
- **The june Supabase project serves dev and prod.** A migration applied there is a production change. This plan's migration is one additive, service-role-only function, applied by the controller, not by an implementer.
- **`PUT /pins`:** accepts only the service token (`require_service_caller`). It replaces the whole set in one transaction. Every id must match `^[A-Za-z0-9_-]{11}$`. At most 50,000 ids.
- **`pins` table:** `video_id` (primary key, `String(32)`) and `pinned_at`, added by migration `0006`. An id that stays pinned keeps its `pinned_at`.
- **Eviction:** `expire_cache` (the idle-time limit, `CACHE_TTL_HOURS`) and `evict_cache` (disk pressure) skip every file whose `video_id` is pinned.
- **`prefetch_pins`:** runs every 5 minutes (`minute=set(range(2, 60, 5))`) in the download worker. It starts at most one download per run, and only when all of these hold:
  - no download job (`single`, `playlist`, `playlist_item`) is queued, expanding or running
  - fewer than `pin_downloads_per_hour` (default **12**) prefetch jobs were created in the last hour
  - free disk is above `pin_reserve_free_mb` (default **10240**)
  - no prefetch job failed with YouTube's bot check within `pin_pause_hours` (default **6**)
- **Choosing what to prefetch:** the oldest pin (by `pinned_at`, then `video_id`) with no `files` row for that video (any user), and no download job for it that failed in the last 24 hours.
- **Prefetch jobs:** `Job(user_id=SERVICE_PRINCIPAL, kind="single", url="https://www.youtube.com/watch?v=<id>", video_id=<id>)`, enqueued as `download_audio` on the default queue. Room downloads are never paused or limited by any of this.
- **Bot-check pause:** when a prefetch download fails with YouTube's "Sign in to confirm you're not a bot", the worker logs it at **error** level. That same failed job pauses prefetching for `pin_pause_hours`.
- **Keep list from june:**
  - It is sent at the end of every sync run, after matching, when the 200 s budget allows.
  - It is the full result of the SQL function `library_video_ids()`, which is service-role only and returns `text[]`.
  - A failure is logged with `console.error` and never fails the run.
- **Disk:** grow VM 9000's disk from 40 GB to about 100 GB. That takes `qm resize` on the Proxmox host, then `growpart` and `resize2fs` in the guest. The owner approves this before it's done.
- **Tests:**
  - june: Vitest under `test/`, relative imports, `fetch` injected, no network, mock data only in tests.
  - mp3server: `.venv/bin/pytest`.
- **Fail loud.** Every caught error is logged (`console.error`, `logger.error` or `logger.warning`) or shown to the user. No empty `catch`/`except`.
- **Commits:** a plain descriptive message covering what changed and why. Never mention Claude; no `Co-Authored-By` line. Check `git log -1 --format=%B` before every push. Push after every commit. Stage only the files the task names:
  - june's untracked `.linkc/` and `system-map.json` are not yours.
  - mp3server's untracked `docs/homelab-migration.md` is not yours.

---

### Task 1 (mp3server): The keep list: `pins` table and `PUT /pins`

**Files:**
- Create: `migrations/versions/0006_pins.py`, `src/mp3server/jobs/pins.py`, `src/mp3server/routes/pins.py`
- Modify: `src/mp3server/models.py`, `src/mp3server/main.py`
- Test: `tests/test_api_pins.py`, `tests/test_jobs_pins.py`

**Interfaces:**
- Produces:
  - `models.Pin` (`video_id: str` primary key, `pinned_at: datetime`)
  - `jobs.pins.PinChange(count: int, added: int, removed: int)`
  - `jobs.pins.replace_pins(db: AsyncSession, video_ids: Iterable[str]) -> PinChange`
  - `PUT /pins`
    - body `{video_ids: [str]}`
    - returns `{count, added, removed}`
    - service token only

- [ ] **Step 1: Create the branch**

```bash
cd /Users/jacobdang/Projects/mp3server
git checkout main && git pull
git checkout -b library-pins
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_jobs_pins.py`:

```python
from sqlalchemy import select

from mp3server.jobs.pins import replace_pins
from mp3server.models import Pin


async def test_replace_pins_handles_more_ids_than_one_delete_chunk(db):
    many = [f"{i:011d}" for i in range(2500)]
    change = await replace_pins(db, many)
    assert (change.count, change.added, change.removed) == (2500, 2500, 0)

    change = await replace_pins(db, [])
    assert (change.count, change.added, change.removed) == (0, 0, 2500)
    assert list((await db.execute(select(Pin.video_id))).scalars()) == []
```

Create `tests/test_api_pins.py`:

```python
import pytest
from sqlalchemy import select

from mp3server.models import Pin

TOKEN = "p" * 40
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
A, B, C = "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"


@pytest.fixture
def service_settings(settings):
    settings.service_token = TOKEN
    return settings


async def pinned(db):
    db.expire_all()
    return sorted((await db.execute(select(Pin.video_id))).scalars())


async def put(client, ids, headers=HEADERS):
    return await client.put("/pins", json={"video_ids": ids}, headers=headers)


async def test_put_pins_sets_the_keep_list(client, service_settings, db):
    response = await put(client, [A, B])
    assert response.status_code == 200
    assert response.json() == {"count": 2, "added": 2, "removed": 0}
    assert await pinned(db) == [A, B]


async def test_put_pins_replaces_the_whole_set(client, service_settings, db):
    await put(client, [A, B])
    response = await put(client, [B, C])
    assert response.json() == {"count": 2, "added": 1, "removed": 1}
    assert await pinned(db) == [B, C]


async def test_a_track_that_stays_pinned_keeps_its_pinned_at(client, service_settings, db):
    await put(client, [A])
    first = (await db.get(Pin, A)).pinned_at
    await put(client, [A, B])
    db.expire_all()
    assert (await db.get(Pin, A)).pinned_at == first


async def test_an_empty_list_clears_every_pin(client, service_settings, db):
    await put(client, [A, B])
    response = await put(client, [])
    assert response.json() == {"count": 0, "added": 0, "removed": 2}
    assert await pinned(db) == []


async def test_a_repeated_id_counts_once(client, service_settings, db):
    response = await put(client, [A, A])
    assert response.json() == {"count": 1, "added": 1, "removed": 0}


async def test_pins_rejects_a_malformed_id(client, service_settings, db):
    response = await put(client, [A, "not a video id"])
    assert response.status_code == 422
    assert await pinned(db) == []


async def test_pins_refuses_a_signed_in_user(client, service_settings, authed):
    # the authed fixture stands in for a valid user JWT; /pins wants the
    # service token and nothing else
    assert (await client.put("/pins", json={"video_ids": [A]})).status_code == 401


async def test_pins_refuses_a_wrong_token(client, service_settings):
    response = await put(client, [A], headers={"Authorization": "Bearer " + "x" * 40})
    assert response.status_code == 401
```

- [ ] **Step 3: Run them to confirm they fail**

Run: `.venv/bin/pytest tests/test_jobs_pins.py tests/test_api_pins.py -q`
Expected: FAIL, with `ImportError: cannot import name 'Pin' from 'mp3server.models'`.

- [ ] **Step 4: Write the implementation**

In `src/mp3server/models.py`, append:

```python
class Pin(Base):
    """A track some june library holds. Its audio is never evicted, and the
    download worker fetches it ahead of time (prefetch_pins). june replaces
    the whole set on every sync, so a missed sync corrects itself on the next.
    """

    __tablename__ = "pins"

    video_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    # when this track first joined the keep list; prefetch works oldest first
    pinned_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
```

Create `migrations/versions/0006_pins.py`:

```python
"""pins: the tracks june's libraries hold, whose audio is kept at home"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

SUPABASE_ROLES = ("anon", "authenticated")


def upgrade() -> None:
    op.create_table(
        "pins",
        sa.Column("video_id", sa.String(length=32), primary_key=True),
        sa.Column("pinned_at", sa.DateTime(), nullable=False),
    )
    # Migration 0002 locks jobs and files away from PostgREST; a new table needs
    # the same treatment or it ships readable with the publishable key that sits
    # in the browser. Skipped off Postgres and when the roles are absent, so a
    # plain (non-Supabase) Postgres still migrates.
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("alter table public.pins enable row level security")
    for role in SUPABASE_ROLES:
        op.execute(
            f"""
            do $$
            begin
                if exists (select 1 from pg_roles where rolname = '{role}') then
                    execute 'revoke all on public.pins from {role}';
                end if;
            end $$;
            """
        )


def downgrade() -> None:
    op.drop_table("pins")
```

Create `src/mp3server/jobs/pins.py`:

```python
"""The keep list: which tracks june's libraries hold."""

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from mp3server.models import Pin, utcnow

# Keeps each DELETE's IN list well under every database's parameter limit.
_DELETE_CHUNK = 1000


@dataclass(frozen=True)
class PinChange:
    count: int
    added: int
    removed: int


async def replace_pins(db: AsyncSession, video_ids: Iterable[str]) -> PinChange:
    """Make the pins exactly video_ids, in one transaction. Ids already pinned
    keep their pinned_at, which is when prefetch first saw them."""
    wanted = set(video_ids)
    current = set((await db.execute(select(Pin.video_id))).scalars())
    removed = sorted(current - wanted)
    added = sorted(wanted - current)
    for start in range(0, len(removed), _DELETE_CHUNK):
        chunk = removed[start : start + _DELETE_CHUNK]
        await db.execute(delete(Pin).where(Pin.video_id.in_(chunk)))
    now = utcnow()
    db.add_all(Pin(video_id=video_id, pinned_at=now) for video_id in added)
    await db.commit()
    return PinChange(count=len(wanted), added=len(added), removed=len(removed))
```

Create `src/mp3server/routes/pins.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from mp3server.auth import require_service_caller
from mp3server.deps import get_db
from mp3server.jobs.pins import replace_pins

router = APIRouter(prefix="/pins", tags=["pins"])

# A YouTube video id: 11 characters from this alphabet.
VideoId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{11}$")]
# Five libraries of a few thousand songs each fit many times over.
MAX_PINS = 50_000


class PinsRequest(BaseModel):
    video_ids: list[VideoId] = Field(max_length=MAX_PINS)


class PinsReplaced(BaseModel):
    count: int
    added: int
    removed: int


@router.put("", response_model=PinsReplaced, dependencies=[Depends(require_service_caller)])
async def put_pins(body: PinsRequest, db: AsyncSession = Depends(get_db)) -> PinsReplaced:
    """Replace the keep list with june's full set.

    june sends every video in anyone's library at the end of each sync run.
    Pinned audio is never evicted and is fetched ahead of time; a track that
    leaves every library loses its pin here and normal eviction applies again.
    """
    change = await replace_pins(db, body.video_ids)
    return PinsReplaced(count=change.count, added=change.added, removed=change.removed)
```

In `src/mp3server/main.py`, import and register it:

```python
from mp3server.routes import captions, downloads, files, health, imports, match, pins
```

```python
    app.include_router(match.router)
    app.include_router(pins.router)
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `.venv/bin/pytest tests/test_jobs_pins.py tests/test_api_pins.py -q`
Expected: PASS, 9 tests.

Run: `.venv/bin/pytest -q`
Expected: every test passes, with no warnings.

Run: `.venv/bin/python -c "from alembic.config import Config; from alembic.script import ScriptDirectory; print(ScriptDirectory.from_config(Config('alembic.ini')).get_current_head())"`
Expected: `0006`

- [ ] **Step 6: Commit**

```bash
git add migrations/versions/0006_pins.py src/mp3server/models.py src/mp3server/jobs/pins.py src/mp3server/routes/pins.py src/mp3server/main.py tests/test_jobs_pins.py tests/test_api_pins.py
git commit -m "Keep a list of pinned tracks, replaced whole by PUT /pins

june will send every video in anyone's Spotify library at the end of each
sync, so their audio can be kept at home. PUT /pins (service token only)
replaces the pins table in one transaction; ids already pinned keep their
pinned_at. Migration 0006 adds the table, locked away from PostgREST like
the others."
git push -u origin library-pins
```

---

### Task 2 (mp3server): Cache expiry and eviction skip pinned tracks

**Files:**
- Modify: `src/mp3server/worker.py`
- Test: `tests/test_worker_evict.py` (additions)

**Interfaces:**
- Consumes: `models.Pin` (Task 1)
- Produces: `worker.NOT_PINNED`, a SQLAlchemy filter expression

- [ ] **Step 1: Write the failing tests**

In `tests/test_worker_evict.py`, add `Pin` to the models import:

```python
from mp3server.models import File, Job, JobKind, JobStatus, Pin, utcnow
```

Append:

```python
async def pin(db, *video_ids):
    db.add_all(Pin(video_id=video_id) for video_id in video_ids)
    await db.commit()


async def test_expiry_keeps_a_pinned_track(ctx, db, user_id, tmp_path):
    kept = await store(ctx, db, user_id, "pinnedvid01", played_ago_hours=10_000, tmp_path=tmp_path)
    gone = await store(ctx, db, user_id, "loosevid001", played_ago_hours=10_000, tmp_path=tmp_path)
    await pin(db, "pinnedvid01")

    assert await worker.expire_cache(ctx) == 1

    remaining = list((await db.execute(select(File.video_id))).scalars())
    assert remaining == ["pinnedvid01"]
    assert await ctx["storage"].size(kept.storage_key) == 500
    with pytest.raises(FileNotFoundError):
        await ctx["storage"].size(gone.storage_key)


async def test_eviction_skips_pinned_tracks(ctx, db, user_id, tmp_path, monkeypatch):
    await store(ctx, db, user_id, "pinnedvid01", played_ago_hours=500, tmp_path=tmp_path)
    await store(ctx, db, user_id, "loosevid001", played_ago_hours=100, tmp_path=tmp_path)
    await pin(db, "pinnedvid01")
    monkeypatch.setattr(worker, "_free_disk_mb", falling_disk([100, 999_999]))

    assert await worker.evict_cache(ctx) == 1

    remaining = list((await db.execute(select(File.video_id))).scalars())
    assert remaining == ["pinnedvid01"]


async def test_eviction_stops_when_only_pinned_tracks_are_left(
    ctx, db, user_id, tmp_path, monkeypatch, caplog
):
    await store(ctx, db, user_id, "pinnedvid01", played_ago_hours=500, tmp_path=tmp_path)
    await pin(db, "pinnedvid01")
    monkeypatch.setattr(worker, "_free_disk_mb", falling_disk([100, 100]))

    assert await worker.evict_cache(ctx) == 0

    assert list((await db.execute(select(File.video_id))).scalars()) == ["pinnedvid01"]
    assert "ran out of unpinned objects" in caplog.text
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `.venv/bin/pytest tests/test_worker_evict.py -q`
Expected: FAIL. The pinned tracks are expired and evicted like any other.

- [ ] **Step 3: Write the implementation**

In `src/mp3server/worker.py`, add `Pin` to the models import:

```python
from mp3server.models import (
    File, ImportTrack, Job, JobKind, JobStatus, Pin, TERMINAL_STATUSES, utcnow,
)
```

Directly under `LAST_USED = func.coalesce(File.last_accessed_at, File.created_at)`, add:

```python
# Pinned audio is kept: some june library holds that track. It becomes
# evictable again when june's next keep list drops it.
NOT_PINNED = File.video_id.not_in(select(Pin.video_id))
```

In `expire_cache`, change the query to:

```python
                await db.execute(
                    select(File.storage_key).where(LAST_USED < cutoff, NOT_PINNED).distinct()
                )
```

In `evict_cache`, change the loop body's query and warning to:

```python
            key = await db.scalar(
                select(File.storage_key).where(NOT_PINNED).order_by(LAST_USED).limit(1)
            )
            if key is None:
                logger.warning("cache eviction ran out of unpinned objects before freeing enough")
                break
```

Add one sentence to each docstring: "Pinned tracks are skipped." for `expire_cache`, and "Pinned tracks are never evicted." for `evict_cache`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `.venv/bin/pytest tests/test_worker_evict.py -q`
Expected: PASS, including the three new tests.

Run: `.venv/bin/pytest -q`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/worker.py tests/test_worker_evict.py
git commit -m "Never expire or evict pinned tracks

A track in someone's library is kept at home: the idle-time expiry and the
disk-pressure eviction both skip pinned video ids, and eviction says so when
only pinned audio is left."
git push
```

---

### Task 3 (mp3server): `prefetch_pins`: fetch pinned audio slowly, when idle

**Files:**
- Create: `src/mp3server/jobs/prefetch.py`
- Modify: `src/mp3server/config.py`, `src/mp3server/ytdl.py`, `src/mp3server/worker.py`, `.env.example`, `README.md`
- Test: `tests/test_worker_prefetch.py`, plus additions to `tests/test_ytdl.py`

**Interfaces:**
- Consumes:
  - `models.Pin` (Task 1)
  - `auth.SERVICE_PRINCIPAL`
  - `jobs.service.task_name_for`
- Produces:
  - `Settings.pin_downloads_per_hour: int = 12`
  - `Settings.pin_reserve_free_mb: int = 10240`
  - `Settings.pin_pause_hours: float = 6.0`
  - `ytdl.BOT_CHECK_MARKER = "sign in to confirm"`, `ytdl.is_bot_check(message: str) -> bool`
  - `jobs.prefetch.is_prefetch(job: Job) -> bool`
  - `jobs.prefetch.prefetch_blocker(db, settings, now: datetime, free_mb: int) -> str | None`
  - `jobs.prefetch.next_pin_to_fetch(db, now: datetime) -> str | None`
  - `jobs.prefetch.create_prefetch_job(db, video_id: str) -> Job`
  - `worker.prefetch_pins(ctx) -> str | None`: the video id it started, or None

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ytdl.py`:

```python
def test_is_bot_check_recognises_youtubes_wall():
    assert ytdl.is_bot_check("ERROR: [youtube] x: Sign in to confirm you’re not a bot")
    assert ytdl.is_bot_check("sign in to confirm you're not a bot")
    assert not ytdl.is_bot_check("ERROR: Video unavailable")
```

If `tests/test_ytdl.py` doesn't already import `ytdl` as `from mp3server import ytdl`, add that import.

Create `tests/test_worker_prefetch.py`:

```python
import logging
from datetime import timedelta

import pytest
from sqlalchemy import select
from yt_dlp.utils import DownloadError

from mp3server import worker
from mp3server.auth import SERVICE_PRINCIPAL
from mp3server.jobs.prefetch import create_prefetch_job
from mp3server.models import File, Job, JobKind, JobStatus, Pin, utcnow
from mp3server.storage.local import LocalDiskStorage

A, B = "aaaaaaaaaaa", "bbbbbbbbbbb"
BOT_CHECK = "ERROR: [youtube] x: Sign in to confirm you’re not a bot"
PLENTY_MB = 1_000_000


@pytest.fixture
def ctx(settings, session_factory, fake_queue):
    return {
        "settings": settings,
        "session_factory": session_factory,
        "storage": LocalDiskStorage(settings.storage_dir),
        "redis": fake_queue,
        "job_try": 1,
    }


@pytest.fixture(autouse=True)
def roomy_disk(monkeypatch):
    monkeypatch.setattr(worker, "_free_disk_mb", lambda path: PLENTY_MB)


async def pin(db, *video_ids):
    """Pinned in the order given, a second apart."""
    base = utcnow() - timedelta(minutes=10)
    for i, video_id in enumerate(video_ids):
        db.add(Pin(video_id=video_id, pinned_at=base + timedelta(seconds=i)))
    await db.commit()


async def add_job(db, **fields):
    job = Job(
        **{
            "user_id": SERVICE_PRINCIPAL,
            "url": "https://www.youtube.com/watch?v=zzzzzzzzzzz",
            "kind": JobKind.SINGLE,
            "status": JobStatus.COMPLETED,
            **fields,
        }
    )
    db.add(job)
    await db.commit()
    return job


async def jobs(db):
    db.expire_all()
    return list((await db.execute(select(Job).order_by(Job.created_at))).scalars())


async def test_prefetch_starts_one_download_for_the_oldest_pin(ctx, db, fake_queue):
    await pin(db, A, B)

    assert await worker.prefetch_pins(ctx) == A

    [job] = await jobs(db)
    assert job.user_id == SERVICE_PRINCIPAL
    assert job.kind == JobKind.SINGLE
    assert job.status == JobStatus.QUEUED
    assert job.video_id == A
    assert job.url == f"https://www.youtube.com/watch?v={A}"
    assert fake_queue.jobs == [("download_audio", (str(job.id),))]


async def test_prefetch_does_nothing_without_pins(ctx, db, fake_queue):
    assert await worker.prefetch_pins(ctx) is None
    assert await jobs(db) == []
    assert fake_queue.jobs == []


@pytest.mark.parametrize("status", [JobStatus.QUEUED, JobStatus.RUNNING])
async def test_prefetch_waits_while_a_room_download_is_pending(ctx, db, user_id, status):
    await pin(db, A)
    await add_job(db, user_id=user_id, status=status)

    assert await worker.prefetch_pins(ctx) is None
    assert len(await jobs(db)) == 1


async def test_prefetch_waits_while_a_playlist_is_expanding(ctx, db, user_id):
    await pin(db, A)
    await add_job(db, user_id=user_id, kind=JobKind.PLAYLIST, status=JobStatus.EXPANDING)

    assert await worker.prefetch_pins(ctx) is None


async def test_prefetch_ignores_pending_imports(ctx, db, user_id):
    # resolve jobs run in their own worker and never touch the download slots
    await pin(db, A)
    await add_job(db, user_id=user_id, kind=JobKind.IMPORT_TRACK, status=JobStatus.QUEUED)

    assert await worker.prefetch_pins(ctx) == A


async def test_prefetch_starts_no_more_than_the_hourly_limit(ctx, db, settings):
    settings.pin_downloads_per_hour = 2
    await pin(db, A)
    await add_job(db, created_at=utcnow() - timedelta(minutes=10))
    await add_job(db, created_at=utcnow() - timedelta(minutes=50))

    assert await worker.prefetch_pins(ctx) is None


async def test_prefetches_older_than_an_hour_do_not_count(ctx, db, settings):
    settings.pin_downloads_per_hour = 2
    await pin(db, A)
    await add_job(db, created_at=utcnow() - timedelta(minutes=61))
    await add_job(db, created_at=utcnow() - timedelta(minutes=90))

    assert await worker.prefetch_pins(ctx) == A


async def test_prefetch_leaves_the_disk_reserve_alone(ctx, db, settings, monkeypatch):
    await pin(db, A)
    monkeypatch.setattr(worker, "_free_disk_mb", lambda path: settings.pin_reserve_free_mb)

    assert await worker.prefetch_pins(ctx) is None


async def test_prefetch_pauses_after_a_bot_check(ctx, db):
    await pin(db, B)
    await add_job(
        db, video_id=A, status=JobStatus.FAILED, error=BOT_CHECK,
        finished_at=utcnow() - timedelta(hours=1),
    )

    assert await worker.prefetch_pins(ctx) is None


async def test_prefetch_resumes_once_the_pause_is_over(ctx, db):
    await pin(db, B)
    await add_job(
        db, video_id=A, status=JobStatus.FAILED, error=BOT_CHECK,
        finished_at=utcnow() - timedelta(hours=7),
    )

    assert await worker.prefetch_pins(ctx) == B


async def test_a_bot_check_on_a_room_download_does_not_pause_prefetch(ctx, db, user_id):
    await pin(db, B)
    await add_job(
        db, user_id=user_id, video_id=A, status=JobStatus.FAILED, error=BOT_CHECK,
        finished_at=utcnow() - timedelta(hours=1),
    )

    assert await worker.prefetch_pins(ctx) == B


async def test_prefetch_skips_a_pin_whose_audio_is_already_stored(ctx, db, user_id):
    await pin(db, A, B)
    db.add(
        File(
            user_id=user_id, video_id=A, title="t", uploader=None, duration_seconds=10,
            filesize_bytes=500, storage_backend="local", storage_key=f"{A}.m4a",
        )
    )
    await db.commit()

    assert await worker.prefetch_pins(ctx) == B


async def test_prefetch_skips_a_pin_that_failed_in_the_last_day(ctx, db, user_id):
    await pin(db, A, B)
    await add_job(
        db, user_id=user_id, video_id=A, status=JobStatus.FAILED, error="Video unavailable",
        finished_at=utcnow() - timedelta(hours=2),
    )

    assert await worker.prefetch_pins(ctx) == B


async def test_a_pin_that_failed_over_a_day_ago_is_tried_again(ctx, db, user_id):
    await pin(db, A, B)
    await add_job(
        db, user_id=user_id, video_id=A, status=JobStatus.FAILED, error="Video unavailable",
        finished_at=utcnow() - timedelta(hours=25),
    )

    assert await worker.prefetch_pins(ctx) == A


async def test_a_bot_check_on_a_prefetch_is_logged_as_an_error(ctx, db, monkeypatch, caplog):
    job = await create_prefetch_job(db, A)

    def bot_wall(*args, **kwargs):
        raise DownloadError(BOT_CHECK)

    monkeypatch.setattr(worker.ytdl, "probe", bot_wall)
    with caplog.at_level(logging.ERROR, logger="mp3server.worker"):
        await worker.download_audio(ctx, str(job.id))

    [failed] = await jobs(db)
    assert failed.status == JobStatus.FAILED
    assert any(
        r.levelno == logging.ERROR and "pauses for 6 hours" in r.getMessage()
        for r in caplog.records
    )


async def test_a_bot_check_on_a_room_download_is_not_called_a_pause(
    ctx, db, user_id, monkeypatch, caplog
):
    job = await add_job(
        db, user_id=user_id, status=JobStatus.QUEUED,
        url=f"https://www.youtube.com/watch?v={A}",
    )

    def bot_wall(*args, **kwargs):
        raise DownloadError(BOT_CHECK)

    monkeypatch.setattr(worker.ytdl, "probe", bot_wall)
    await worker.download_audio(ctx, str(job.id))

    assert "pauses for" not in caplog.text


def test_the_download_worker_runs_prefetch_every_five_minutes():
    [prefetch] = [c for c in worker.WorkerSettings.cron_jobs if c.coroutine is worker.prefetch_pins]
    assert prefetch.minute == set(range(2, 60, 5))
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `.venv/bin/pytest tests/test_worker_prefetch.py tests/test_ytdl.py -q`
Expected: FAIL, with `ModuleNotFoundError: No module named 'mp3server.jobs.prefetch'`.

- [ ] **Step 3: Write the implementation**

In `src/mp3server/config.py`, add after `match_min_interval_s`:

```python
    # Background downloads of pinned library tracks (prefetch_pins). At most
    # this many start per hour; 2,000 songs take about a week at 12.
    pin_downloads_per_hour: int = 12
    # Free space prefetch never eats into, so a room's download always fits.
    pin_reserve_free_mb: int = 10240
    # How long prefetch stands down after YouTube's bot check. Room downloads
    # carry on; a flagged IP breaks all playback, so the background backs off.
    pin_pause_hours: float = 6.0
```

In `src/mp3server/ytdl.py`, add below `is_permanent_error`:

```python
# YouTube's "Sign in to confirm you're not a bot" wall: this IP is being
# flagged. Also one of the permanent markers above.
BOT_CHECK_MARKER = "sign in to confirm"


def is_bot_check(message: str) -> bool:
    return BOT_CHECK_MARKER in message.lower()
```

Create `src/mp3server/jobs/prefetch.py`:

```python
"""Whether to start a background download of a pinned track, and which one.

prefetch_pins (worker.py) asks every five minutes. These read only the
database, so the rules are tested without a queue or a disk.
"""

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from mp3server import ytdl
from mp3server.auth import SERVICE_PRINCIPAL
from mp3server.config import Settings
from mp3server.models import File, Job, JobKind, JobStatus, PENDING_STATUSES, Pin

# What the download worker runs. Import tracks have their own worker and never
# hold a download slot, so a paced import doesn't hold prefetch back.
DOWNLOAD_KINDS = (JobKind.SINGLE, JobKind.PLAYLIST, JobKind.PLAYLIST_ITEM)
# A pinned track whose download failed waits this long before another try.
FAILED_RETRY_AFTER = timedelta(hours=24)


def is_prefetch(job: Job) -> bool:
    return job.user_id == SERVICE_PRINCIPAL and job.kind == JobKind.SINGLE


def _count_prefetches():
    return (
        select(func.count())
        .select_from(Job)
        .where(Job.user_id == SERVICE_PRINCIPAL, Job.kind == JobKind.SINGLE)
    )


async def prefetch_blocker(
    db: AsyncSession, settings: Settings, now: datetime, free_mb: int
) -> str | None:
    """Why no prefetch may start now, or None when one may."""
    pending = await db.scalar(
        select(func.count())
        .select_from(Job)
        .where(Job.kind.in_(DOWNLOAD_KINDS), Job.status.in_(PENDING_STATUSES))
    )
    if pending:
        # a room waiting on audio always wins, and prefetch runs one at a time
        return f"{pending} download(s) queued or running"
    bot_checks = await db.scalar(
        _count_prefetches().where(
            Job.status == JobStatus.FAILED,
            Job.finished_at >= now - timedelta(hours=settings.pin_pause_hours),
            Job.error.ilike(f"%{ytdl.BOT_CHECK_MARKER}%"),
        )
    )
    if bot_checks:
        return f"paused: a prefetch hit YouTube's bot check in the last {settings.pin_pause_hours:g} hours"
    started = await db.scalar(_count_prefetches().where(Job.created_at >= now - timedelta(hours=1)))
    if started >= settings.pin_downloads_per_hour:
        return f"{started} prefetches started in the last hour (limit {settings.pin_downloads_per_hour})"
    if free_mb <= settings.pin_reserve_free_mb:
        return f"{free_mb} MB free, not above the {settings.pin_reserve_free_mb} MB reserve"
    return None


async def next_pin_to_fetch(db: AsyncSession, now: datetime) -> str | None:
    """The oldest pin with no stored audio and no download that failed in the
    last day."""
    stored = select(File.id).where(File.video_id == Pin.video_id).exists()
    failed_recently = (
        select(Job.id)
        .where(
            Job.video_id == Pin.video_id,
            Job.status == JobStatus.FAILED,
            Job.finished_at >= now - FAILED_RETRY_AFTER,
        )
        .exists()
    )
    return await db.scalar(
        select(Pin.video_id)
        .where(~stored, ~failed_recently)
        .order_by(Pin.pinned_at, Pin.video_id)
        .limit(1)
    )


async def create_prefetch_job(db: AsyncSession, video_id: str) -> Job:
    """A download job owned by the service principal, which is what marks it
    as a prefetch rather than a room's request."""
    job = Job(
        user_id=SERVICE_PRINCIPAL,
        url=f"https://www.youtube.com/watch?v={video_id}",
        video_id=video_id,
        kind=JobKind.SINGLE,
    )
    db.add(job)
    await db.commit()
    return job
```

In `src/mp3server/worker.py`, import them:

```python
from mp3server.jobs.prefetch import (
    create_prefetch_job, is_prefetch, next_pin_to_fetch, prefetch_blocker,
)
```

Change the permanent branch of `_handle_download_error` to log the pause:

```python
    if ytdl.is_permanent_error(message) or ctx["job_try"] >= MAX_TRIES:
        await _fail_job(session_factory, job_id, message)
        if ytdl.is_bot_check(message):
            await _log_prefetch_pause(ctx, session_factory, job_id)
        return
```

Add above `_handle_download_error`:

```python
async def _log_prefetch_pause(ctx, session_factory, job_id: uuid.UUID) -> None:
    """A prefetch that hits the bot check pauses prefetching (prefetch_blocker
    reads that failure back); say so where someone will see it."""
    async with session_factory() as db:
        job = await db.get(Job, job_id)
    if job is not None and is_prefetch(job):
        logger.error(
            "YouTube asked prefetch job %s to confirm it's not a bot; prefetching "
            "pauses for %g hours (room downloads carry on)",
            job_id, ctx["settings"].pin_pause_hours,
        )
```

Add after `evict_cache`:

```python
async def prefetch_pins(ctx: dict) -> str | None:
    """Start downloading one pinned track that has no audio yet, if the server
    is idle enough (see prefetch_blocker). Returns the video id it started."""
    settings = ctx["settings"]
    now = utcnow()
    free_mb = await asyncio.to_thread(_free_disk_mb, settings.storage_dir)
    async with ctx["session_factory"]() as db:
        blocker = await prefetch_blocker(db, settings, now, free_mb)
        if blocker is not None:
            logger.debug("prefetch skipped: %s", blocker)
            return None
        video_id = await next_pin_to_fetch(db, now)
        if video_id is None:
            return None
        job = await create_prefetch_job(db, video_id)
    await ctx["redis"].enqueue_job(task_name_for(JobKind.SINGLE), str(job.id))
    logger.info("prefetch started for pinned %s (job %s)", video_id, job.id)
    return video_id
```

In `WorkerSettings.cron_jobs`, add:

```python
        # one pinned track at a time, only when no room is waiting on audio
        cron(prefetch_pins, minute=set(range(2, 60, 5))),
```

In `.env.example`, add after the `MATCH_MIN_INTERVAL_S` lines:

```bash
# Background downloads of tracks in june libraries (pins): at most this many
# start per hour, never while a room download is queued or running, never
# into the last PIN_RESERVE_FREE_MB of disk, and not for PIN_PAUSE_HOURS after
# YouTube's bot check.
PIN_DOWNLOADS_PER_HOUR=12
PIN_RESERVE_FREE_MB=10240
PIN_PAUSE_HOURS=6
```

In `README.md`, wherever it lists the routes (the `POST /match` line from phase 2), add a line for `PUT /pins`: "replace the keep list of video ids whose audio is kept and prefetched (service token only)". Also mention the three `PIN_*` settings next to the other env vars.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `.venv/bin/pytest tests/test_worker_prefetch.py tests/test_ytdl.py -q`
Expected: PASS.

Run: `.venv/bin/pytest -q`
Expected: every test passes, with no warnings.

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/jobs/prefetch.py src/mp3server/config.py src/mp3server/ytdl.py src/mp3server/worker.py .env.example README.md tests/test_worker_prefetch.py tests/test_ytdl.py
git commit -m "Download pinned tracks slowly in the background

prefetch_pins runs every five minutes and starts at most one download of a
pinned track with no stored audio. It waits while any download is queued or
running, starts at most 12 an hour, leaves 10 GB of disk free, skips a track
that failed in the last day, and stands down for six hours after YouTube's
bot check, which it logs as an error. Room downloads are never held back."
git push
```

---

### Task 4 (june): A client for `PUT /pins`

**Files:**
- Create: `src/audio/service-request.ts`, `src/audio/pins.ts`
- Modify: `src/audio/imports.ts`, `test/audio/imports.test.ts`
- Test: `test/audio/pins.test.ts`

**Interfaces:**
- Produces:
  - `service-request.ts`:
    - `class ServiceError extends Error { status: number }`. It replaces `ImportServiceError`.
    - `type FetchLike`
    - `interface ServiceConfig { baseUrl; serviceToken; fetch?; timeoutMs? }`
    - `errorDetail(response): Promise<string>`
    - `createServiceRequest(config, client: string): ServiceRequest`, where `ServiceRequest` has:
      - `send(method, path, body?)`
      - `error(path, status, detail)`
      - `fail(path, response)`
  - `pins.ts`:
    - `type PinsReplaced = { count: number; added: number; removed: number }`
    - `interface PinService { replacePins(videoIds: readonly string[]): Promise<PinsReplaced> }`
    - `createPinService(config: ServiceConfig): PinService`
  - `createImportService(config: ServiceConfig)`: unchanged behavior.

- [ ] **Step 1: Check out the branch**

```bash
cd /Users/jacobdang/Projects/june
git checkout library-pins && git pull
```

- [ ] **Step 2: Write the failing test**

Create `test/audio/pins.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPinService } from "../../src/audio/pins";
import { ServiceError } from "../../src/audio/service-request";

function stubFetch(status: number, body: unknown) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (url: URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}

const TOKEN = "t".repeat(40);
const config = (fetch: ReturnType<typeof stubFetch>["fetch"]) => ({
  baseUrl: "https://audio.example/",
  serviceToken: TOKEN,
  fetch,
});

describe("createPinService", () => {
  it("replaces the keep list with one PUT carrying every id", async () => {
    const { fetch, calls } = stubFetch(200, { count: 2, added: 1, removed: 3 });

    const result = await createPinService(config(fetch)).replacePins(["aaaaaaaaaaa", "bbbbbbbbbbb"]);

    expect(result).toEqual({ count: 2, added: 1, removed: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.toString()).toBe("https://audio.example/pins");
    expect(calls[0]!.init!.method).toBe("PUT");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ video_ids: ["aaaaaaaaaaa", "bbbbbbbbbbb"] });
  });

  it("keeps mp3server's detail when it refuses", async () => {
    const { fetch } = stubFetch(422, { detail: "not a video id" });

    const error = await createPinService(config(fetch))
      .replacePins(["nope"])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 422, message: expect.stringMatching(/not a video id/) });
  });

  it("fails on a reply it doesn't expect", async () => {
    const { fetch } = stubFetch(200, { ok: true });
    await expect(createPinService(config(fetch)).replacePins([])).rejects.toThrow();
  });

  it("needs a base URL and a service token", () => {
    const { fetch } = stubFetch(200, {});
    expect(() => createPinService({ ...config(fetch), baseUrl: "" })).toThrow(/baseUrl/);
    expect(() => createPinService({ ...config(fetch), serviceToken: "" })).toThrow(/serviceToken/);
  });
});
```

In `test/audio/imports.test.ts`, change the import line to:

```ts
import { createImportService } from "../../src/audio/imports";
import { ServiceError } from "../../src/audio/service-request";
```

Replace both `toBeInstanceOf(ImportServiceError)` with `toBeInstanceOf(ServiceError)`.

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run test/audio/pins.test.ts test/audio/imports.test.ts`
Expected: FAIL, with `Failed to resolve import ../../src/audio/pins` and `../../src/audio/service-request`.

- [ ] **Step 4: Write the implementation**

Create `src/audio/service-request.ts`:

```ts
/**
 * Requests to mp3server's service-token routes from june's server: the auth
 * header, a per-request timeout, and failures that keep mp3server's own
 * detail. The route clients (./imports.ts, ./pins.ts) validate the bodies.
 */

export class ServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
  }
}

export type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export interface ServiceConfig {
  baseUrl: string;
  serviceToken: string;
  fetch?: FetchLike;
  /** Per request; a stuck call must not hold a sync run or a click. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** mp3server's `detail`, or the best description of a reply without one.
 *  Only ever used to build a thrown error, so nothing is swallowed. */
export async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : JSON.stringify(body);
  } catch {
    return response.statusText || "unknown error";
  }
}

export interface ServiceRequest {
  send(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Response>;
  /** The error for a failed call, carrying mp3server's detail. */
  error(path: string, status: number, detail: string): ServiceError;
  /** Throws the error for a failed response. */
  fail(path: string, response: Response): Promise<never>;
}

/** `client` names the caller in configuration errors. */
export function createServiceRequest(config: ServiceConfig, client: string): ServiceRequest {
  if (!config.baseUrl) throw new Error(`${client}: baseUrl is required`);
  if (!config.serviceToken) throw new Error(`${client}: serviceToken is required`);
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function error(path: string, status: number, detail: string): ServiceError {
    return new ServiceError(status, `mp3server ${status} on ${path}: ${detail}`);
  }

  return {
    async send(method, path, body) {
      const headers: Record<string, string> = { Authorization: `Bearer ${config.serviceToken}` };
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      return doFetch(new URL(`${baseUrl}${path}`), init);
    },
    error,
    async fail(path, response) {
      throw error(path, response.status, await errorDetail(response));
    },
  };
}
```

In `src/audio/imports.ts`:
- Delete `ImportServiceError`, `FetchLike`, `ImportServiceConfig`, `DEFAULT_TIMEOUT_MS` and `errorDetail`.
- Keep the schemas, the types, `TrackToMatch`, `ImportService`, `IMPORT_NOT_FOUND` and `toWire` as they are.
- Add the import:

```ts
import { createServiceRequest, errorDetail, type ServiceConfig } from "./service-request";
```

Replace `createImportService` with:

```ts
export function createImportService(config: ServiceConfig): ImportService {
  const request = createServiceRequest(config, "createImportService");

  return {
    async createImport(tracks) {
      const response = await request.send("POST", "/imports", { tracks: tracks.map(toWire) });
      if (!response.ok) return request.fail("/imports", response);
      return importCreatedSchema.parse(await response.json());
    },

    async getImport(id) {
      const path = `/imports/${encodeURIComponent(id)}`;
      const response = await request.send("GET", path);
      if (response.status === 404) {
        // Only mp3server's own answer means the import is gone. Any other 404
        // (a proxy, a wrong base URL) would otherwise resubmit every song.
        const detail = await errorDetail(response);
        if (detail === IMPORT_NOT_FOUND) return null;
        throw request.error(path, 404, detail);
      }
      if (!response.ok) return request.fail(path, response);
      return importStatusSchema.parse(await response.json());
    },

    async matchOne(track) {
      const response = await request.send("POST", "/match", toWire(track));
      if (!response.ok) return request.fail("/match", response);
      return matchResultSchema.parse(await response.json());
    },
  };
}
```

Then find anything else that used the removed names: `grep -rn "ImportServiceError\|ImportServiceConfig" src app test`. Point each one at `ServiceError` or `ServiceConfig`.

Create `src/audio/pins.ts`:

```ts
import { z } from "zod";
import { createServiceRequest, type ServiceConfig } from "./service-request";

/**
 * mp3server's keep list, called from june's server with the service token:
 * the video ids whose audio is kept at home and fetched ahead of time.
 */

const pinsReplacedSchema = z.object({
  count: z.number().int(),
  added: z.number().int(),
  removed: z.number().int(),
});

export type PinsReplaced = z.infer<typeof pinsReplacedSchema>;

export interface PinService {
  /** Replaces the whole set; ids that leave it lose their pin. */
  replacePins(videoIds: readonly string[]): Promise<PinsReplaced>;
}

export function createPinService(config: ServiceConfig): PinService {
  const request = createServiceRequest(config, "createPinService");

  return {
    async replacePins(videoIds) {
      const response = await request.send("PUT", "/pins", { video_ids: videoIds });
      if (!response.ok) return request.fail("/pins", response);
      return pinsReplacedSchema.parse(await response.json());
    },
  };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run test/audio/pins.test.ts test/audio/imports.test.ts`
Expected: PASS.

Run: `npm test && npm run typecheck`
Expected: every test passes, with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/audio/service-request.ts src/audio/pins.ts src/audio/imports.ts test/audio/pins.test.ts test/audio/imports.test.ts
git commit -m "Add a client for mp3server's keep list

PUT /pins replaces the set of video ids mp3server keeps at home. The
service-token request plumbing (auth header, timeout, errors that keep
mp3server's detail) moves out of the import client into one module both
clients share; ImportServiceError becomes ServiceError."
git push
```

---

### Task 5 (june): Send the keep list at the end of every sync

**Files:**
- Create: `supabase/migrations/20260928120000_library_video_ids.sql`, `src/lib/spotify/keep-list.ts`, `src/lib/spotify/keep-list-store.ts`
- Modify: `src/lib/spotify/sync.ts`
- Test: `test/lib/spotify-keep-list.test.ts`, `test/lib/spotify-keep-list-store.test.ts`

**Interfaces:**
- Consumes:
  - `PinService`, `PinsReplaced`, `createPinService` (Task 4)
  - `mp3serverServiceConfig` (`src/lib/spotify/config.ts`)
  - `check` (`src/lib/spotify/store.ts`)
- Produces:
  - SQL `library_video_ids() returns text[]`, service role only
  - `interface KeepListStore { libraryVideoIds(): Promise<string[]> }`
  - `sendKeepList(store: KeepListStore, pins: PinService): Promise<PinsReplaced>`
  - `supabaseKeepListStore(db?: SupabaseClient): KeepListStore`
  - `SyncRunResult`'s `"done"` branch gains `pins: PinsReplaced | null`

- [ ] **Step 1: Write the database function**

Create `supabase/migrations/20260928120000_library_video_ids.sql`:

```sql
-- The audio mp3server keeps at home (phase 3): every matched video reachable
-- from anyone's liked songs or playlists. june sends this whole set as
-- mp3server's keep list at the end of every sync run.
-- Spec: docs/superpowers/specs/2026-09-25-spotify-library-design.md.
--
-- One array rather than a set of rows: PostgREST caps a select at 1000 rows,
-- and a keep list is every song in five libraries.
create or replace function public.library_video_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct s.video_id order by s.video_id), '{}')
  from public.songs s
  where s.match_state = 'matched'
    and s.video_id is not null
    and (
      exists (select 1 from public.library_songs l where l.song_id = s.id)
      or exists (select 1 from public.playlist_songs p where p.song_id = s.id)
    );
$$;

revoke execute on function public.library_video_ids() from public, anon, authenticated;
grant execute on function public.library_video_ids() to service_role;
```

**Do not apply it.** The controller applies this migration to the shared database and verifies it. Only create the file.

- [ ] **Step 2: Write the failing tests**

Create `test/lib/spotify-keep-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PinService } from "../../src/audio/pins";
import { sendKeepList, type KeepListStore } from "../../src/lib/spotify/keep-list";

function fakePins() {
  const sent: (readonly string[])[] = [];
  const pins: PinService = {
    async replacePins(videoIds) {
      sent.push(videoIds);
      return { count: videoIds.length, added: videoIds.length, removed: 0 };
    },
  };
  return { pins, sent };
}

const storeOf = (ids: string[]): KeepListStore => ({ libraryVideoIds: async () => ids });

describe("sendKeepList", () => {
  it("sends every video id in the libraries, as one set", async () => {
    const { pins, sent } = fakePins();

    const result = await sendKeepList(storeOf(["aaaaaaaaaaa", "bbbbbbbbbbb"]), pins);

    expect(sent).toEqual([["aaaaaaaaaaa", "bbbbbbbbbbb"]]);
    expect(result).toEqual({ count: 2, added: 2, removed: 0 });
  });

  it("sends an empty list when no library holds a matched song, clearing the pins", async () => {
    const { pins, sent } = fakePins();
    await sendKeepList(storeOf([]), pins);
    expect(sent).toEqual([[]]);
  });

  it("lets a failing read stop the send", async () => {
    const { pins, sent } = fakePins();
    const failing: KeepListStore = {
      async libraryVideoIds() {
        throw new Error("read the keep list: boom");
      },
    };
    await expect(sendKeepList(failing, pins)).rejects.toThrow(/boom/);
    expect(sent).toEqual([]);
  });
});
```

Create `test/lib/spotify-keep-list-store.test.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// keep-list-store is server code; its guard only resolves under Next's server build.
vi.mock("server-only", () => ({}));

import { supabaseKeepListStore } from "../../src/lib/spotify/keep-list-store";

function stubClient(status: number, body: unknown) {
  const calls: { url: URL; method: string }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: new URL(input.toString()), method: init?.method ?? "GET" });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const db = createClient("https://project.supabase.co", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { db, calls };
}

describe("supabaseKeepListStore.libraryVideoIds", () => {
  it("calls library_video_ids() and returns its array", async () => {
    const { db, calls } = stubClient(200, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);

    expect(await supabaseKeepListStore(db).libraryVideoIds()).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(calls[0]!.url.pathname).toBe("/rest/v1/rpc/library_video_ids");
    expect(calls[0]!.method).toBe("POST");
  });

  it("fails loudly on a database error", async () => {
    const { db } = stubClient(500, { message: "permission denied", code: "42501" });
    await expect(supabaseKeepListStore(db).libraryVideoIds()).rejects.toThrow(/read the keep list/);
  });

  it("fails loudly on something that isn't a list of ids", async () => {
    const { db } = stubClient(200, { nope: true });
    await expect(supabaseKeepListStore(db).libraryVideoIds()).rejects.toThrow(/list of ids/);
  });
});
```

- [ ] **Step 3: Run them to confirm they fail**

Run: `npx vitest run test/lib/spotify-keep-list.test.ts test/lib/spotify-keep-list-store.test.ts`
Expected: FAIL, with `Failed to resolve import ../../src/lib/spotify/keep-list`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/spotify/keep-list.ts`:

```ts
import type { PinService, PinsReplaced } from "../../audio/pins";

/**
 * The keep list: every matched video in anyone's library, sent to mp3server
 * so it keeps that audio at home and fetches it ahead of time. The whole set
 * goes every run, so a missed run corrects itself on the next. Written
 * against two interfaces so it's tested with fakes; the Supabase store is
 * ./keep-list-store.ts.
 */

export interface KeepListStore {
  libraryVideoIds(): Promise<string[]>;
}

export async function sendKeepList(store: KeepListStore, pins: PinService): Promise<PinsReplaced> {
  return pins.replacePins(await store.libraryVideoIds());
}
```

Create `src/lib/spotify/keep-list-store.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../supabase/service";
import type { KeepListStore } from "./keep-list";
import { check } from "./store";

/** The keep list, read with the service role: library_video_ids() looks
 *  across every user's library, which no user may do. */
export function supabaseKeepListStore(db: SupabaseClient = createServiceClient()): KeepListStore {
  return {
    async libraryVideoIds() {
      const { data, error } = await db.rpc("library_video_ids");
      check("read the keep list", error);
      if (!Array.isArray(data) || !data.every((id) => typeof id === "string")) {
        throw new Error("read the keep list: library_video_ids() didn't return a list of ids");
      }
      return data as string[];
    },
  };
}
```

In `src/lib/spotify/sync.ts`, add imports:

```ts
import { createPinService, type PinsReplaced } from "../../audio/pins";
import { sendKeepList } from "./keep-list";
import { supabaseKeepListStore } from "./keep-list-store";
```

Extend `SyncRunResult`'s `"done"` branch:

```ts
      /** Null when matching failed (logged) or ran out of time. */
      matching: MatchRunResult | null;
      /** Null when sending the keep list failed (logged) or ran out of time. */
      pins: PinsReplaced | null;
```

Extend the `UsersResult` omit:

```ts
type UsersResult = Omit<Extract<SyncRunResult, { status: "done" }>, "status" | "matching" | "pins">;
```

Add below `matchSongs`:

```ts
/** Send mp3server the keep list. Its failure never fails the run; the next
 *  run sends the whole set again. */
async function keepAudio(): Promise<PinsReplaced | null> {
  try {
    return await sendKeepList(supabaseKeepListStore(), createPinService(mp3serverServiceConfig()));
  } catch (err) {
    console.error("Sending the keep list to mp3server failed; the next run sends it again:", err);
    return null;
  }
}
```

In `run`, after the matching block, before the return:

```ts
    // After matching, so a song matched this run is kept this run.
    let pins: PinsReplaced | null = null;
    if (Date.now() - started < RUN_BUDGET_MS) {
      pins = await keepAudio();
    } else {
      console.warn("Spotify sync skipped the keep list: out of time.");
    }
    return { status: "done", ...users, matching, pins };
```

This replaces the old `return { status: "done", ...users, matching };`.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run test/lib/spotify-keep-list.test.ts test/lib/spotify-keep-list-store.test.ts`
Expected: PASS, 6 tests.

Run: `npm test && npm run typecheck && npm run build`
Expected: every test passes, no type errors, and the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260928120000_library_video_ids.sql src/lib/spotify/keep-list.ts src/lib/spotify/keep-list-store.ts src/lib/spotify/sync.ts test/lib/spotify-keep-list.test.ts test/lib/spotify-keep-list-store.test.ts
git commit -m "Send mp3server the keep list at the end of every sync

After matching, each run reads every matched video in anyone's library
(library_video_ids(), service role only, one array so PostgREST's row cap
doesn't apply) and replaces mp3server's pins with it. A failure is logged
and never fails the run; the next run sends the whole set again."
git push
```

---

### Task 6 (june): Docs

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: The Spotify library section**

In `docs/ARCHITECTURE.md`'s "## Spotify library" section, append after the paragraph on the room's Library tab:

```markdown
**Keeping audio at home.** Each sync run ends by sending mp3server the keep
list: every matched video in anyone's liked songs or playlists, read by the
service-role function `library_video_ids()` and sent whole as `PUT /pins`.
mp3server never expires or evicts pinned audio, and its download worker's
`prefetch_pins` job fetches pinned tracks that have none yet. It starts one
at a time and only when no download is queued or running, at most 12 an
hour, never into the last 10 GB of disk, and not for 6 hours after YouTube's
bot check. A track that leaves every library loses its pin with the next
run and ages out like any other.
```

- [ ] **Step 2: The service-token sentence**

In the "## Repositories" paragraph written in phase 2, change the list of routes the service token opens so it includes `PUT /pins`. For example: "`POST /imports`, `GET /imports/{id}`, `POST /match` and `PUT /pins`" (`/match` and `/pins` accept only the service token).

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "Document the keep list and background prefetch"
git push
```

---

### Task 7: Ship it (with the user)

This task needs the user. The VM is reached with `ssh jacob@192.168.1.36` on the home LAN, or `ssh jacob@100.80.78.29` over Tailscale. The Proxmox host is `root@192.168.1.28`, or `proxmox-asus` / `100.104.103.103` over Tailscale. Growing the disk changes the VM, so ask the user before doing it.

- [ ] **Step 1: Apply june's database function (controller)**

Apply `supabase/migrations/20260928120000_library_video_ids.sql` with the Supabase MCP `apply_migration` tool (name `library_video_ids`). Then verify with `execute_sql`:

```sql
select has_function_privilege('anon', 'public.library_video_ids()', 'execute') as anon,
       has_function_privilege('authenticated', 'public.library_video_ids()', 'execute') as authed,
       has_function_privilege('service_role', 'public.library_video_ids()', 'execute') as service,
       cardinality(public.library_video_ids()) as ids;
```

Expected: `anon = false`, `authed = false`, `service = true`, and `ids` roughly the number of matched songs in libraries (about 200 today).

- [ ] **Step 2: Grow the VM disk (after the user approves)**

On the Proxmox host:

```bash
qm config 9000 | grep -E '^(scsi|virtio|sata|ide)[0-9]+:'   # find the boot disk, e.g. scsi0
qm resize 9000 scsi0 +60G                                   # use the disk name found above
```

In the VM:

```bash
lsblk                                  # the root partition, e.g. sda1 on sda
sudo growpart /dev/sda 1               # the disk and partition number lsblk showed
sudo resize2fs /dev/sda1
df -h /                                # about 100G total
```

Expected: `df -h /` shows about 100 GB total. The containers keep running throughout. `mp3data` is a Docker volume on the root filesystem, so it gains the space.

- [ ] **Step 3: mp3server: PR, merge, deploy**

Open the PR from `library-pins` in JacobTDang/mp3server, titled "Keep library audio at home: pins, eviction skip, background prefetch". The body says what changed and why. Merge it once the user approves.

Before deploying, on the VM, check two things that would otherwise stop prefetch silently:

```bash
df -h /    # must show more than 10 GB free, or prefetch waits for the disk reserve (it logs a WARNING)
cd ~/mp3server && docker compose exec -T db psql -U postgres -tAc \
  "select kind, status, count(*) from jobs where status in ('queued','running','expanding') group by 1,2;"
```

Expected: more than 10 GB free, and no old pending download jobs. Any pending `single`, `playlist` or `playlist_item` job blocks prefetch until it finishes.

Then, on the VM:

```bash
cd ~/mp3server && git pull
docker compose build
docker compose run --rm api alembic upgrade head      # before starting the new code
docker compose up -d
docker compose ps
docker compose exec -T db psql -U postgres -tAc "select version_num from alembic_version;"
```

Expected: every service is healthy, and alembic is at `0006`.

- [ ] **Step 4: Check `/pins` from outside**

```bash
T=$(grep -E '^MP3SERVER_SERVICE_TOKEN=' .env.local | cut -d= -f2-)
curl -s -o /dev/null -w '%{http_code}\n' -X PUT https://june-audio.taild5ebc0.ts.net/pins -H 'Content-Type: application/json' -d '{"video_ids":[]}'
```

Expected: `401` without the token. Don't send an authorized empty list from here: it would clear the pins. The sync run in the next step sends the real set.

- [ ] **Step 5: june: PR, merge, and watch a production run**

1. Open the PR from `library-pins`, titled "Keep your library's audio on the homelab". The body says what changed and why.
2. Merge it once the user approves, and wait for the production deploy to succeed.
3. After the next cron run (on the hour or half hour), check on the VM:

```bash
docker compose exec -T db psql -U postgres -tAc "select count(*) from pins;"
docker compose exec -T db psql -U postgres -tAc "select status, count(*) from jobs where user_id = '00000000-0000-4000-8000-00000000a001' and kind = 'single' group by 1;"
docker compose logs worker --since 30m 2>&1 | grep -E "prefetch_pins|WARNING|ERROR" | tail
```

Expected:
- `pins` holds about as many rows as `library_video_ids()` returned.
- Prefetch jobs appear and complete, about one every 5 minutes, up to 12 an hour.
- arq logs a `cron:prefetch_pins` result line every 5 minutes, carrying the video id it started (or None). There are no WARNING or ERROR lines. The worker's own INFO lines don't show, because arq leaves `mp3server.*` at WARNING.
- `df -h /` on the VM grows slowly.

- [ ] **Step 6: Update the board and memory**

- On the linkC board, mark "Library pins" as built (not planned).
- Update `spotify-library-status` in memory: phase 3 shipped, with the date and the PR numbers.
