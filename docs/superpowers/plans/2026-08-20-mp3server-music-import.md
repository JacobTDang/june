# mp3server Music Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mp3server accepts a list of tracks (or a public Spotify playlist link), resolves each to a YouTube video id with no API quota, and reports per-track results as a job june can poll.

**Architecture:** An import is a parent `Job` plus one child `Job` per track — the same fan-out `expand_playlist` already uses, so it inherits retries, `finalize_parent` roll-up, the stale-job sweep and cancellation. Children run `resolve_track`, which searches with yt-dlp and verifies the result against the track's expected duration. Resolution runs on a second arq queue so bulk imports never sit in front of a room waiting for audio.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, arq, yt-dlp, Alembic, pytest (`asyncio_mode = "auto"`).

**Repo:** `/Users/jacobdang/Desktop/projects/mp3server` — all paths below are relative to it. Run tests with `.venv/bin/python -m pytest`.

## Global Constraints

- **No new dependencies.** HTTP fetching uses `urllib.request`, which `ytdl.py` already uses for caption tracks. Ask before adding any package.
- **No audio is downloaded at import time.** Resolution stores a video id; bytes arrive through june's existing prefetch.
- **Fail loud.** No swallowed exceptions, no silent fallbacks. A track that cannot be resolved is reported, never dropped.
- **Duration gates, channel only breaks ties.** Within 3s → `high` confidence; 3–15s → `low`; beyond 15s → not found. Ranking by channel first returns the wrong recording.
- **Truncation must be visible.** The Spotify embed payload stops at 100 tracks with no total; exactly 100 means "possibly incomplete" and must be flagged.
- **Blocking I/O runs off the event loop** via `asyncio.to_thread`, matching every existing yt-dlp call.
- Server-enforced cap: `import_max_tracks`, default **500**.
- Never mention Claude in commit messages.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/mp3server/spotify.py` (new) | Turn a Spotify playlist URL into tracks. URL parsing, embed fetch, payload parsing, truncation detection. |
| `src/mp3server/matching.py` (new) | Pure decisions: normalize text, build the cache key, pick the right candidate. No I/O, no yt-dlp import. |
| `src/mp3server/jobs/imports.py` (new) | Import job service: create parent + children, read back per-track state. |
| `src/mp3server/routes/imports.py` (new) | `/imports` HTTP surface. |
| `migrations/versions/0004_import_tracks.py` (new) | `import_tracks` table. |
| `src/mp3server/models.py` | Add `ImportTrack`, two `JobKind` values, `JobStatus.NOT_FOUND`. |
| `src/mp3server/ytdl.py` | Add `search()`. |
| `src/mp3server/worker.py` | Add `resolve_track`, `ResolveWorkerSettings`; route recovery by queue. |
| `src/mp3server/jobs/service.py` | Pending-count fix; import kinds in `task_name_for`, `cancel_job`. |
| `src/mp3server/config.py` | `import_max_tracks`, `resolve_queue_name`, `resolve_search_limit`. |

---

### Task 1: Spotify URL and payload parsing (pure)

**Files:**
- Create: `src/mp3server/spotify.py`
- Test: `tests/test_spotify.py`

**Interfaces:**
- Produces: `SpotifyError`, `SpotifyTrack(title: str, artist: str, duration_ms: int | None)`, `SpotifyPlaylist(name: str, tracks: list[SpotifyTrack], truncated: bool)`, `parse_playlist_id(url: str) -> str`, `parse_embed_payload(html: str) -> SpotifyPlaylist`, `EMBED_MAX_TRACKS = 100`

- [ ] **Step 1: Write the failing test**

Create `tests/test_spotify.py`:

```python
import json

import pytest

from mp3server import spotify

PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M"


def embed_html(tracks, name="Today's Top Hits"):
    payload = {
        "props": {
            "pageProps": {
                "state": {
                    "data": {"entity": {"name": name, "trackList": tracks}}
                }
            }
        }
    }
    return (
        "<html><body>"
        '<script id="__NEXT_DATA__" type="application/json">'
        + json.dumps(payload)
        + "</script></body></html>"
    )


def track(title="Animal", subtitle="KATSEYE", duration=158494):
    return {"title": title, "subtitle": subtitle, "duration": duration}


@pytest.mark.parametrize(
    "url",
    [
        f"https://open.spotify.com/playlist/{PLAYLIST_ID}",
        f"https://open.spotify.com/playlist/{PLAYLIST_ID}?si=abc123",
        f"http://open.spotify.com/playlist/{PLAYLIST_ID}",
        f"https://open.spotify.com/embed/playlist/{PLAYLIST_ID}",
        f"https://open.spotify.com/intl-de/playlist/{PLAYLIST_ID}",
        f"spotify:playlist:{PLAYLIST_ID}",
        f"  https://open.spotify.com/playlist/{PLAYLIST_ID}  ",
    ],
)
def test_parse_playlist_id_accepts_every_link_shape(url):
    assert spotify.parse_playlist_id(url) == PLAYLIST_ID


@pytest.mark.parametrize(
    "url",
    [
        f"https://open.spotify.com/album/{PLAYLIST_ID}",
        f"https://open.spotify.com/track/{PLAYLIST_ID}",
        f"https://open.spotify.com/artist/{PLAYLIST_ID}",
        f"https://evil.example.com/playlist/{PLAYLIST_ID}",
        "https://open.spotify.com/playlist/tooshort",
        "https://open.spotify.com/playlist/",
        f"spotify:album:{PLAYLIST_ID}",
        "not a url at all",
        "",
    ],
)
def test_parse_playlist_id_rejects_everything_else(url):
    with pytest.raises(spotify.SpotifyError):
        spotify.parse_playlist_id(url)


def test_parse_embed_payload_reads_tracks():
    html = embed_html([track(), track("stupid song", "Olivia Rodrigo", 209680)])
    playlist = spotify.parse_embed_payload(html)
    assert playlist.name == "Today's Top Hits"
    assert playlist.truncated is False
    assert playlist.tracks[0] == spotify.SpotifyTrack("Animal", "KATSEYE", 158494)
    assert playlist.tracks[1].duration_ms == 209680


def test_parse_embed_payload_flags_truncation_at_the_cap():
    html = embed_html([track(f"t{i}") for i in range(spotify.EMBED_MAX_TRACKS)])
    playlist = spotify.parse_embed_payload(html)
    assert len(playlist.tracks) == spotify.EMBED_MAX_TRACKS
    assert playlist.truncated is True


def test_parse_embed_payload_does_not_flag_a_short_playlist():
    html = embed_html([track(f"t{i}") for i in range(spotify.EMBED_MAX_TRACKS - 1)])
    assert spotify.parse_embed_payload(html).truncated is False


def test_parse_embed_payload_keeps_tracks_without_a_duration():
    html = embed_html([{"title": "Untimed", "subtitle": "Someone", "duration": None}])
    assert spotify.parse_embed_payload(html).tracks[0].duration_ms is None


def test_parse_embed_payload_skips_rows_missing_title_or_artist():
    html = embed_html([track(), {"title": "", "subtitle": "X"}, {"title": "Y", "subtitle": ""}])
    assert len(spotify.parse_embed_payload(html).tracks) == 1


@pytest.mark.parametrize(
    "html",
    [
        "<html><body>no script here</body></html>",
        '<script id="__NEXT_DATA__" type="application/json">{not json</script>',
        '<script id="__NEXT_DATA__" type="application/json">{"props": {}}</script>',
    ],
)
def test_parse_embed_payload_fails_loudly_on_a_changed_page(html):
    with pytest.raises(spotify.SpotifyError):
        spotify.parse_embed_payload(html)


def test_parse_embed_payload_rejects_an_empty_playlist():
    with pytest.raises(spotify.SpotifyError, match="empty or not public"):
        spotify.parse_embed_payload(embed_html([]))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_spotify.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mp3server.spotify'`

- [ ] **Step 3: Write the implementation**

Create `src/mp3server/spotify.py`:

```python
"""Reading a public Spotify playlist without a Spotify credential.

Spotify's API is closed to us: an app in Development Mode allows five
authenticated users and requires the app owner to hold Premium, and Extended
Quota needs a registered business with 250k monthly actives. The embed widget
needs no credential at all, so that is what this reads.

It is an undocumented internal payload, not an API. It will break without
warning, exactly as yt-dlp does, and it fails the same way: loudly, on a shape
that no longer parses.
"""

import json
import re
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

EMBED_URL = "https://open.spotify.com/embed/playlist/{playlist_id}"
# The payload stops here and carries no total, so exactly this many tracks is
# the only signal that a longer playlist was cut short.
EMBED_MAX_TRACKS = 100
SPOTIFY_HOSTS = frozenset({"open.spotify.com", "play.spotify.com"})
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"

_NEXT_DATA = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)
_PLAYLIST_ID = re.compile(r"^[A-Za-z0-9]{22}$")


class SpotifyError(Exception):
    pass


@dataclass(frozen=True)
class SpotifyTrack:
    title: str
    artist: str
    duration_ms: int | None


@dataclass(frozen=True)
class SpotifyPlaylist:
    name: str
    tracks: list[SpotifyTrack]
    truncated: bool


def parse_playlist_id(url: str) -> str:
    """The id out of any link shape Spotify hands out: a web link with or
    without a locale segment and ?si= tracking, an embed link, or a URI."""
    raw = (url or "").strip()
    if raw.startswith("spotify:"):
        parts = raw.split(":")
        if len(parts) == 3 and parts[1] == "playlist" and _PLAYLIST_ID.match(parts[2]):
            return parts[2]
        raise SpotifyError(f"not a Spotify playlist link: {url!r}")

    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in SPOTIFY_HOSTS:
        raise SpotifyError(f"not a Spotify playlist link: {url!r}")
    segments = [segment for segment in parsed.path.split("/") if segment]
    while segments and (segments[0] == "embed" or segments[0].startswith("intl-")):
        segments.pop(0)
    if (
        len(segments) != 2
        or segments[0] != "playlist"
        or not _PLAYLIST_ID.match(segments[1])
    ):
        raise SpotifyError(f"not a Spotify playlist link: {url!r}")
    return segments[1]


def parse_embed_payload(html: str) -> SpotifyPlaylist:
    match = _NEXT_DATA.search(html)
    if match is None:
        raise SpotifyError("Spotify embed payload not found; the page shape changed")
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise SpotifyError(f"Spotify embed payload is not valid JSON: {exc}") from exc
    try:
        entity = data["props"]["pageProps"]["state"]["data"]["entity"]
    except (KeyError, TypeError) as exc:
        raise SpotifyError(f"Spotify embed payload has no playlist in it: {exc}") from exc

    raw_tracks = entity.get("trackList") or []
    tracks = []
    for item in raw_tracks:
        title = (item.get("title") or "").strip()
        artist = (item.get("subtitle") or "").strip()
        if not title or not artist:
            continue
        duration = item.get("duration")
        tracks.append(
            SpotifyTrack(
                title=title,
                artist=artist,
                duration_ms=int(duration) if duration else None,
            )
        )
    if not tracks:
        raise SpotifyError("playlist is empty or not public")
    return SpotifyPlaylist(
        name=(entity.get("name") or "Untitled playlist").strip(),
        tracks=tracks,
        # counted before filtering: truncation is about what the payload carried
        truncated=len(raw_tracks) >= EMBED_MAX_TRACKS,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_spotify.py -q`
Expected: PASS — every test in the file

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/spotify.py tests/test_spotify.py
git commit -m "Parse Spotify playlist links and embed payloads"
```

---

### Task 2: Fetching the playlist over the network

**Files:**
- Modify: `src/mp3server/spotify.py` (append `fetch_playlist`)
- Test: `tests/test_spotify.py` (append)

**Interfaces:**
- Consumes: `parse_playlist_id`, `parse_embed_payload`, `SpotifyError` from Task 1
- Produces: `fetch_playlist(url: str, *, timeout: float = 30.0) -> SpotifyPlaylist`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_spotify.py`:

```python
import io
from urllib.error import HTTPError, URLError


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_fetch_playlist_requests_the_embed_url(monkeypatch):
    seen = {}

    def fake_urlopen(request, timeout=None):
        seen["url"] = request.full_url
        seen["ua"] = request.get_header("User-agent")
        seen["timeout"] = timeout
        return FakeResponse(embed_html([track()]).encode("utf-8"))

    monkeypatch.setattr(spotify, "urlopen", fake_urlopen)
    playlist = spotify.fetch_playlist(
        f"https://open.spotify.com/playlist/{PLAYLIST_ID}", timeout=7
    )
    assert seen["url"] == f"https://open.spotify.com/embed/playlist/{PLAYLIST_ID}"
    assert seen["ua"] == spotify.USER_AGENT
    assert seen["timeout"] == 7
    assert playlist.tracks[0].title == "Animal"


def test_fetch_playlist_reports_a_missing_or_private_playlist(monkeypatch):
    def fake_urlopen(request, timeout=None):
        raise HTTPError(request.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(spotify, "urlopen", fake_urlopen)
    with pytest.raises(spotify.SpotifyError, match="not found, or it is private"):
        spotify.fetch_playlist(f"https://open.spotify.com/playlist/{PLAYLIST_ID}")


def test_fetch_playlist_surfaces_other_http_errors(monkeypatch):
    def fake_urlopen(request, timeout=None):
        raise HTTPError(request.full_url, 503, "Service Unavailable", {}, None)

    monkeypatch.setattr(spotify, "urlopen", fake_urlopen)
    with pytest.raises(spotify.SpotifyError, match="HTTP 503"):
        spotify.fetch_playlist(f"https://open.spotify.com/playlist/{PLAYLIST_ID}")


def test_fetch_playlist_surfaces_a_network_failure(monkeypatch):
    def fake_urlopen(request, timeout=None):
        raise URLError("name resolution failed")

    monkeypatch.setattr(spotify, "urlopen", fake_urlopen)
    with pytest.raises(spotify.SpotifyError, match="could not reach Spotify"):
        spotify.fetch_playlist(f"https://open.spotify.com/playlist/{PLAYLIST_ID}")


def test_fetch_playlist_rejects_a_bad_url_before_any_request(monkeypatch):
    def explode(request, timeout=None):
        raise AssertionError("must not reach the network for an invalid link")

    monkeypatch.setattr(spotify, "urlopen", explode)
    with pytest.raises(spotify.SpotifyError):
        spotify.fetch_playlist("https://evil.example.com/playlist/x")


@pytest.mark.network
def test_fetch_playlist_against_the_real_embed():
    """Opt-in (`pytest -m network`): proves the payload shape still parses."""
    playlist = spotify.fetch_playlist(
        f"https://open.spotify.com/playlist/{PLAYLIST_ID}"
    )
    assert playlist.name
    assert playlist.tracks
    assert all(t.title and t.artist for t in playlist.tracks)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_spotify.py -q`
Expected: FAIL — `AttributeError: module 'mp3server.spotify' has no attribute 'fetch_playlist'`

- [ ] **Step 3: Write the implementation**

Append to `src/mp3server/spotify.py`:

```python
def fetch_playlist(url: str, *, timeout: float = 30.0) -> SpotifyPlaylist:
    """Read a public playlist. Blocking — call it through asyncio.to_thread."""
    playlist_id = parse_playlist_id(url)
    request = Request(
        EMBED_URL.format(playlist_id=playlist_id),
        headers={"User-Agent": USER_AGENT},
    )
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - spotify.com, built above
            html = response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        if exc.code == 404:
            raise SpotifyError("playlist not found, or it is private") from exc
        raise SpotifyError(f"Spotify returned HTTP {exc.code}") from exc
    except URLError as exc:
        raise SpotifyError(f"could not reach Spotify: {exc.reason}") from exc
    return parse_embed_payload(html)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_spotify.py -q`
Expected: PASS — the network test shows as deselected

Then confirm the real endpoint still works:
Run: `.venv/bin/python -m pytest tests/test_spotify.py -m network -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/spotify.py tests/test_spotify.py
git commit -m "Fetch public Spotify playlists from the embed endpoint"
```

---

### Task 3: Normalization and candidate picking (pure)

**Files:**
- Create: `src/mp3server/matching.py`
- Test: `tests/test_matching.py`

**Interfaces:**
- Produces: `Candidate(video_id: str, title: str, channel: str | None, duration_seconds: int | None)`, `Match(video_id: str, title: str, confidence: str)`, `normalize(text: str) -> str`, `norm_key(artist: str, title: str) -> str`, `pick_candidate(candidates: Sequence[Candidate], expected_duration_ms: int | None, artist: str) -> Match | None`, `CONFIDENT_DELTA_MS = 3000`, `UNCERTAIN_DELTA_MS = 15000`

- [ ] **Step 1: Write the failing test**

Create `tests/test_matching.py`:

```python
import pytest

from mp3server import matching
from mp3server.matching import Candidate


def candidate(video_id="a", title="T", channel="Portishead", duration=305):
    return Candidate(video_id=video_id, title=title, channel=channel, duration_seconds=duration)


@pytest.mark.parametrize(
    "left,right",
    [
        ("Beyoncé", "Beyonce"),
        ("MØ", "MO"),
        ("Glory Box", "glory   box"),
        ("Money Trees (feat. Jay Rock)", "Money Trees"),
        ("Money Trees (ft. Jay Rock)", "Money Trees"),
        ("Sicko Mode (with Drake)", "Sicko Mode"),
        ("Hello - Single", "Hello  Single"),
    ],
)
def test_normalize_collapses_equivalent_spellings(left, right):
    assert matching.normalize(left) == matching.normalize(right)


@pytest.mark.parametrize(
    "left,right",
    [
        ("Glory Box", "Glory Box (Live)"),
        ("Glory Box", "Glory Box Remastered"),
        ("Hello", "Goodbye"),
    ],
)
def test_normalize_keeps_genuinely_different_titles_apart(left, right):
    assert matching.normalize(left) != matching.normalize(right)


def test_norm_key_joins_artist_and_title():
    assert matching.norm_key("Portishead", "Glory Box") == "portishead|glory box"


def test_norm_key_is_stable_across_casing_and_punctuation():
    assert matching.norm_key("PORTISHEAD!", "Glory  Box") == matching.norm_key(
        "portishead", "glory box"
    )


def test_pick_candidate_returns_none_for_no_candidates():
    assert matching.pick_candidate([], 305_000, "Portishead") is None


def test_pick_candidate_prefers_the_duration_match_over_the_artist_channel():
    """The real failure this guards: searching "Portishead Glory Box" returns a
    213s single edit on the artist's own channel first, but a Dummy export names
    the 305s album version."""
    edit = candidate("edit", "Glory Box", "Portishead", 213)
    album = candidate("album", "Glory Box - Remastered", "Brian Martens Music", 308)
    match = matching.pick_candidate([edit, album], 305_000, "Portishead")
    assert match.video_id == "album"


def test_pick_candidate_is_high_confidence_inside_three_seconds():
    match = matching.pick_candidate([candidate(duration=307)], 305_000, "Portishead")
    assert match.confidence == "high"


def test_pick_candidate_is_low_confidence_between_three_and_fifteen_seconds():
    match = matching.pick_candidate([candidate(duration=315)], 305_000, "Portishead")
    assert match.confidence == "low"


@pytest.mark.parametrize("duration", [305 - 16, 305 + 16, 3600])
def test_pick_candidate_rejects_anything_past_fifteen_seconds(duration):
    assert matching.pick_candidate([candidate(duration=duration)], 305_000, "X") is None


@pytest.mark.parametrize(
    "delta_ms,expected",
    [(3_000, "high"), (3_001, "low"), (15_000, "low")],
)
def test_pick_candidate_boundaries_are_inclusive(delta_ms, expected):
    expected_ms = 300_000
    c = candidate(duration=(expected_ms + delta_ms) // 1000)
    assert matching.pick_candidate([c], expected_ms, "X").confidence == expected


def test_pick_candidate_rejects_just_past_the_outer_boundary():
    assert matching.pick_candidate([candidate(duration=315)], 299_000, "X") is None


def test_pick_candidate_breaks_a_tie_with_the_artist_channel():
    stranger = candidate("stranger", "Glory Box", "Some Reuploader", 305)
    official = candidate("official", "Glory Box", "Portishead", 305)
    match = matching.pick_candidate([stranger, official], 305_000, "Portishead")
    assert match.video_id == "official"


def test_pick_candidate_matches_a_topic_channel_to_the_artist():
    stranger = candidate("stranger", "Glory Box", "Some Reuploader", 305)
    topic = candidate("topic", "Glory Box", "Portishead - Topic", 305)
    match = matching.pick_candidate([stranger, topic], 305_000, "Portishead")
    assert match.video_id == "topic"


def test_pick_candidate_does_not_match_an_unrelated_channel():
    generic = candidate("generic", "Money Trees", "music", 387)
    match = matching.pick_candidate([generic], 387_000, "Kendrick Lamar")
    assert match.video_id == "generic"
    assert match.confidence == "high"


def test_pick_candidate_prefers_the_closest_when_no_channel_matches():
    near = candidate("near", "T", "Someone", 306)
    far = candidate("far", "T", "Someone Else", 312)
    assert matching.pick_candidate([near, far], 305_000, "Nobody").video_id == "near"


def test_pick_candidate_skips_candidates_with_no_duration():
    timeless = candidate("timeless", "T", "Portishead", None)
    usable = candidate("usable", "T", "Stranger", 305)
    assert matching.pick_candidate([timeless, usable], 305_000, "Portishead").video_id == "usable"


def test_pick_candidate_returns_none_when_every_candidate_lacks_a_duration():
    assert matching.pick_candidate([candidate(duration=None)], 305_000, "X") is None


def test_pick_candidate_without_an_expected_duration_prefers_the_artist_channel():
    stranger = candidate("stranger", "T", "Reuploader", 100)
    official = candidate("official", "T", "Portishead", 999)
    match = matching.pick_candidate([stranger, official], None, "Portishead")
    assert match.video_id == "official"
    assert match.confidence == "low"


def test_pick_candidate_without_a_duration_falls_back_to_the_first_result():
    first = candidate("first", "T", "Reuploader", 100)
    second = candidate("second", "T", "Another", 999)
    match = matching.pick_candidate([first, second], None, "Portishead")
    assert match.video_id == "first"
    assert match.confidence == "low"


def test_pick_candidate_carries_the_matched_title():
    match = matching.pick_candidate(
        [candidate("x", "Glory Box (Remastered)", "Portishead", 305)], 305_000, "Portishead"
    )
    assert match.title == "Glory Box (Remastered)"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_matching.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mp3server.matching'`

- [ ] **Step 3: Write the implementation**

Create `src/mp3server/matching.py`:

```python
"""Deciding whether a search result is actually the track that was asked for.

Pure: no I/O and no yt-dlp import, so it stays cheap to test exhaustively.
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Sequence

# How far a candidate's duration may sit from the one the source named before
# the match stops being trustworthy. Past the outer bound it is a different
# recording: a live cut, an extended edit, a ten-hour loop.
CONFIDENT_DELTA_MS = 3_000
UNCERTAIN_DELTA_MS = 15_000

HIGH = "high"
LOW = "low"

# Featured-artist credits name the same recording, so they are noise for
# matching. Anything else in parentheses — (Live), (Remastered) — is not.
_FEATURE_CREDIT = re.compile(r"[\(\[]\s*(?:feat|ft|featuring|with)\b[^\)\]]*[\)\]]", re.I)
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Candidate:
    video_id: str
    title: str
    channel: str | None
    duration_seconds: int | None


@dataclass(frozen=True)
class Match:
    video_id: str
    title: str
    confidence: str


def normalize(text: str) -> str:
    """Casefold, strip diacritics and featured-artist credits, and collapse
    everything non-alphanumeric to single spaces."""
    folded = unicodedata.normalize("NFKD", text or "")
    folded = folded.encode("ascii", "ignore").decode("ascii")
    folded = _FEATURE_CREDIT.sub(" ", folded)
    return _NON_ALNUM.sub(" ", folded.lower()).strip()


def norm_key(artist: str, title: str) -> str:
    """The resolution cache key. Deliberately conservative: it collapses
    spelling differences but keeps (Live) and (Remastered) apart, because a
    wrong cache hit serves the wrong recording forever."""
    return f"{normalize(artist)}|{normalize(title)}"


def _channel_is_the_artist(candidate: Candidate, artist_key: str) -> bool:
    if not candidate.channel or not artist_key:
        return False
    # official uploads come back as the artist ("Portishead") or as the
    # auto-generated "Portishead - Topic"
    return artist_key in normalize(candidate.channel)


def pick_candidate(
    candidates: Sequence[Candidate],
    expected_duration_ms: int | None,
    artist: str,
) -> Match | None:
    """The right video for a track, or None when nothing is close enough.

    Duration decides who is eligible and the channel only breaks ties. Ranking
    by channel first returns the wrong recording: searching "Portishead Glory
    Box" puts a 213s single edit on the artist's own channel first, while a
    Dummy export names the 305s album version.
    """
    if not candidates:
        return None
    artist_key = normalize(artist)

    if expected_duration_ms is None:
        # nothing to verify against, so the artist's own channel is the only
        # signal there is, and no answer here earns high confidence
        best = next(
            (c for c in candidates if _channel_is_the_artist(c, artist_key)),
            candidates[0],
        )
        return Match(video_id=best.video_id, title=best.title, confidence=LOW)

    scored = [
        (abs(c.duration_seconds * 1000 - expected_duration_ms), c)
        for c in candidates
        if c.duration_seconds is not None
    ]
    eligible = [pair for pair in scored if pair[0] <= UNCERTAIN_DELTA_MS]
    if not eligible:
        return None

    confident = [pair for pair in eligible if pair[0] <= CONFIDENT_DELTA_MS]
    band, confidence = (confident, HIGH) if confident else (eligible, LOW)
    band.sort(key=lambda pair: (not _channel_is_the_artist(pair[1], artist_key), pair[0]))
    best = band[0][1]
    return Match(video_id=best.video_id, title=best.title, confidence=confidence)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_matching.py -q`
Expected: PASS — every test in the file

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/matching.py tests/test_matching.py
git commit -m "Add duration-gated track matching"
```

---

### Task 4: yt-dlp search

**Files:**
- Modify: `src/mp3server/ytdl.py`
- Test: `tests/test_ytdl.py` (append)

**Interfaces:**
- Consumes: `matching.Candidate` from Task 3
- Produces: `ytdl.search(query: str, limit: int = 5, cookies_file: Path | None = None) -> list[Candidate]`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ytdl.py`:

```python
def test_search_builds_a_ytsearch_query(fake_ydl):
    fake_ydl.info = {"entries": []}
    ytdl.search("Portishead Glory Box", limit=5)
    assert fake_ydl.last_opts["extract_flat"] == "in_playlist"


def test_search_maps_entries_to_candidates(fake_ydl):
    fake_ydl.info = {
        "entries": [
            {"id": "abc", "title": "Glory Box", "channel": "Portishead", "duration": 305},
            {"id": "def", "title": "Live", "uploader": "Someone", "duration": 360.7},
        ]
    }
    results = ytdl.search("Portishead Glory Box")
    assert [r.video_id for r in results] == ["abc", "def"]
    assert results[0].channel == "Portishead"
    assert results[0].duration_seconds == 305
    # uploader is the fallback when channel is absent
    assert results[1].channel == "Someone"
    assert results[1].duration_seconds == 360


def test_search_tolerates_entries_without_a_duration(fake_ydl):
    fake_ydl.info = {"entries": [{"id": "abc", "title": "T", "channel": "C"}]}
    assert ytdl.search("q")[0].duration_seconds is None


def test_search_skips_entries_without_an_id(fake_ydl):
    fake_ydl.info = {"entries": [{"title": "no id"}, {"id": "ok", "title": "T"}]}
    assert [r.video_id for r in ytdl.search("q")] == ["ok"]


def test_search_falls_back_to_the_id_when_a_title_is_missing(fake_ydl):
    fake_ydl.info = {"entries": [{"id": "abc"}]}
    assert ytdl.search("q")[0].title == "abc"


def test_search_returns_empty_for_no_results(fake_ydl):
    fake_ydl.info = {"entries": None}
    assert ytdl.search("nothing at all") == []


@pytest.mark.network
def test_search_against_the_real_service():
    """Opt-in (`pytest -m network`): proves ytsearch still returns durations
    and channels, which the matcher depends on."""
    results = ytdl.search("Portishead Glory Box", limit=5)
    assert len(results) >= 3
    assert any(r.duration_seconds for r in results)
    assert any(r.channel for r in results)
```

The query string itself is checked in the next step's implementation via `FakeYDL`; extend `FakeYDL.extract_info` in `tests/test_ytdl.py` to record the url:

```python
    def extract_info(self, url, download=False):
        FakeYDL.last_url = url
        if download and FakeYDL.last_opts.get("progress_hooks"):
            for hook in FakeYDL.last_opts["progress_hooks"]:
                hook({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100})
                hook({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100})
        return FakeYDL.info
```

and assert it inside `test_search_builds_a_ytsearch_query`:

```python
    assert fake_ydl.last_url == "ytsearch5:Portishead Glory Box"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_ytdl.py -q`
Expected: FAIL — `AttributeError: module 'mp3server.ytdl' has no attribute 'search'`

- [ ] **Step 3: Write the implementation**

In `src/mp3server/ytdl.py`, add the import at the top:

```python
from mp3server.matching import Candidate
```

and append:

```python
def search(query: str, limit: int = 5, cookies_file: Path | None = None) -> list[Candidate]:
    """Candidate videos for a free-text query.

    yt_dlp's ytsearch scrapes the results page rather than calling the YouTube
    Data API, so this costs no quota — which is the whole reason resolution
    lives here. search.list would spend 100 units per track against a
    10,000/day budget shared with every room.

    extract_flat keeps it to the result list (id, duration, channel) without
    opening a video page, which is what makes it fast enough to run per track.
    """
    opts = _base_opts(cookies_file) | {"extract_flat": "in_playlist"}
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    results = []
    for entry in info.get("entries") or []:
        video_id = entry.get("id")
        if not video_id:
            continue
        duration = entry.get("duration")
        results.append(
            Candidate(
                video_id=video_id,
                title=entry.get("title") or video_id,
                channel=entry.get("channel") or entry.get("uploader"),
                duration_seconds=int(duration) if duration else None,
            )
        )
    return results
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_ytdl.py -q`
Expected: PASS — existing tests plus the new search ones, network deselected

Run: `.venv/bin/python -m pytest tests/test_ytdl.py -m network -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/ytdl.py tests/test_ytdl.py
git commit -m "Add quota-free YouTube search to the yt-dlp wrapper"
```

---

### Task 5: The import_tracks table

**Files:**
- Modify: `src/mp3server/models.py`
- Create: `migrations/versions/0004_import_tracks.py`
- Test: `tests/test_models.py` (append)

**Interfaces:**
- Produces: `JobKind.IMPORT = "import"`, `JobKind.IMPORT_TRACK = "import_track"`, `JobStatus.NOT_FOUND = "not_found"`, `ImportTrack` model with columns `id, job_id, norm_key, title, artist, duration_ms, matched_title, confidence, position`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_models.py`:

```python
import uuid

from sqlalchemy import select

from mp3server.models import ImportTrack, Job, JobKind, JobStatus, TERMINAL_STATUSES


def test_not_found_is_terminal():
    assert JobStatus.NOT_FOUND in TERMINAL_STATUSES


def test_import_kinds_exist():
    assert JobKind.IMPORT == "import"
    assert JobKind.IMPORT_TRACK == "import_track"


async def test_import_track_round_trips(db):
    user_id = uuid.uuid4()
    job = Job(user_id=user_id, url="import:Portishead - Glory Box", kind=JobKind.IMPORT_TRACK)
    db.add(job)
    await db.flush()
    db.add(
        ImportTrack(
            job_id=job.id,
            norm_key="portishead|glory box",
            title="Glory Box",
            artist="Portishead",
            duration_ms=305_000,
        )
    )
    await db.commit()

    loaded = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == job.id))
    assert loaded.title == "Glory Box"
    assert loaded.duration_ms == 305_000
    assert loaded.matched_title is None
    assert loaded.confidence is None


async def test_import_track_allows_a_null_duration(db):
    job = Job(user_id=uuid.uuid4(), url="import:x", kind=JobKind.IMPORT_TRACK)
    db.add(job)
    await db.flush()
    db.add(ImportTrack(job_id=job.id, norm_key="a|b", title="B", artist="A", duration_ms=None))
    await db.commit()
    loaded = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == job.id))
    assert loaded.duration_ms is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_models.py -q`
Expected: FAIL — `ImportError: cannot import name 'ImportTrack'`

- [ ] **Step 3: Write the implementation**

In `src/mp3server/models.py`, add to `JobStatus`:

```python
    NOT_FOUND = "not_found"
```

add to `JobKind`:

```python
    IMPORT = "import"
    IMPORT_TRACK = "import_track"
```

extend `TERMINAL_STATUSES`:

```python
TERMINAL_STATUSES = frozenset(
    {
        JobStatus.COMPLETED,
        JobStatus.PARTIAL,
        JobStatus.FAILED,
        JobStatus.CANCELED,
        JobStatus.NOT_FOUND,
    }
)
```

and append the model:

```python
class ImportTrack(Base):
    """What an import job was asked to find, and what it found.

    Doubles as the resolution cache: norm_key is indexed, so a repeat import
    reads the answer off a previous job instead of searching again.
    """

    __tablename__ = "import_tracks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), unique=True, index=True
    )
    norm_key: Mapped[str] = mapped_column(Text, index=True)
    title: Mapped[str] = mapped_column(Text)
    artist: Mapped[str] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    matched_title: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[str | None] = mapped_column(String(8))
    # created_at is second-resolution and a whole import shares one, so the
    # user's original order needs its own column to survive a read
    position: Mapped[int] = mapped_column(Integer, default=0)
```

Create `migrations/versions/0004_import_tracks.py`:

```python
"""what an import job was asked to find, and what it found"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "import_tracks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "job_id",
            sa.Uuid(),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("norm_key", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("artist", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("matched_title", sa.Text(), nullable=True),
        sa.Column("confidence", sa.String(length=8), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_import_tracks_job_id", "import_tracks", ["job_id"])
    op.create_index("ix_import_tracks_norm_key", "import_tracks", ["norm_key"])

    # Supabase auto-exposes every public table through PostgREST, and grants to
    # anon/authenticated arrive via ALTER DEFAULT PRIVILEGES — so a new table is
    # readable with the publishable key that ships in the browser. Migration
    # 0002 does exactly this for jobs and files; a new table needs it too, or
    # it is a hole the day it ships. Skipped off Postgres and when the roles
    # are absent, matching 0002.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("alter table public.import_tracks enable row level security")
        for role in ("anon", "authenticated"):
            op.execute(
                f"""
                do $$
                begin
                    if exists (select 1 from pg_roles where rolname = '{role}') then
                        execute 'revoke all on public.import_tracks from {role}';
                    end if;
                end $$;
                """
            )


def downgrade() -> None:
    op.drop_index("ix_import_tracks_norm_key", table_name="import_tracks")
    op.drop_index("ix_import_tracks_job_id", table_name="import_tracks")
    op.drop_table("import_tracks")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_models.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/models.py migrations/versions/0004_import_tracks.py tests/test_models.py
git commit -m "Add import_tracks table and import job kinds"
```

---

### Task 6: Stop child jobs counting against the pending limit

**Files:**
- Modify: `src/mp3server/jobs/service.py` (`create_download`)
- Test: `tests/test_jobs_service.py` (append)

This is a pre-existing defect, independent of the import: `create_download` counts every pending job including a playlist's children, so one 100-track playlist locks the user out of downloads until it finishes. A 500-track import would make it certain. The limit is meant to cap what a user has *asked for*, and one playlist is one request.

**Interfaces:**
- Produces: `create_download` unchanged in signature; only parents count toward `max_pending_jobs_per_user`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_jobs_service.py`:

```python
async def test_children_do_not_count_against_the_pending_limit(db, settings, user_id):
    """One playlist is one request. Its children must not lock the user out."""
    parent = Job(user_id=user_id, url="https://youtube.com/playlist?list=x", kind=JobKind.PLAYLIST)
    db.add(parent)
    await db.flush()
    db.add_all(
        [
            Job(
                user_id=user_id,
                url=f"https://youtube.com/watch?v={i}",
                kind=JobKind.PLAYLIST_ITEM,
                parent_id=parent.id,
            )
            for i in range(20)
        ]
    )
    await db.commit()

    job = await service.create_download(
        db, user_id, "https://www.youtube.com/watch?v=fresh", settings
    )
    assert job.id is not None


async def test_parents_still_count_against_the_pending_limit(db, settings, user_id):
    db.add_all(
        [
            Job(user_id=user_id, url=f"https://www.youtube.com/watch?v={i}", kind=JobKind.SINGLE)
            for i in range(settings.max_pending_jobs_per_user)
        ]
    )
    await db.commit()
    with pytest.raises(service.PendingLimitError):
        await service.create_download(
            db, user_id, "https://www.youtube.com/watch?v=one-too-many", settings
        )
```

Make sure `tests/test_jobs_service.py` imports what these need (`pytest`, `Job`, `JobKind`, `service`); add any that are missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_jobs_service.py -q`
Expected: FAIL — `PendingLimitError` raised by `test_children_do_not_count_against_the_pending_limit`

- [ ] **Step 3: Write the implementation**

In `src/mp3server/jobs/service.py`, inside `create_download`, change the pending count:

```python
    pending = await db.scalar(
        select(func.count())
        .select_from(Job)
        # children of a playlist or an import are not separate requests: one
        # playlist is one thing the user asked for, however many tracks it holds
        .where(
            Job.user_id == user_id,
            Job.parent_id.is_(None),
            Job.status.in_(PENDING_STATUSES),
        )
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_jobs_service.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/jobs/service.py tests/test_jobs_service.py
git commit -m "Count only parent jobs against the pending-job limit"
```

---

### Task 7: The import job service

**Files:**
- Create: `src/mp3server/jobs/imports.py`
- Modify: `src/mp3server/config.py`
- Test: `tests/test_jobs_imports.py`

**Interfaces:**
- Consumes: `ImportTrack`, `JobKind`, `JobStatus` (Task 5); `matching.norm_key` (Task 3); `PendingLimitError` (existing)
- Produces:
  - `TrackRequest(title: str, artist: str, duration_ms: int | None)` — a plain dataclass
  - `EmptyImportError`, `ImportTooLargeError`
  - `create_import(db, user_id: uuid.UUID, tracks: list[TrackRequest], settings) -> tuple[Job, list[uuid.UUID]]` returning the parent and its child job ids in order
  - `get_import(db, user_id, job_id) -> Job | None`
  - `get_import_rows(db, parent_id) -> list[tuple[Job, ImportTrack]]`
  - `IMPORT_URL = "import:tracklist"`
- Settings added: `import_max_tracks: int = 500`, `resolve_search_limit: int = 5`, `resolve_queue_name: str = "arq:resolve"`

- [ ] **Step 1: Write the failing test**

Create `tests/test_jobs_imports.py`:

```python
import pytest
from sqlalchemy import select

from mp3server.jobs import imports
from mp3server.jobs.imports import TrackRequest
from mp3server.jobs.service import PendingLimitError
from mp3server.models import ImportTrack, Job, JobKind, JobStatus


def tracks(n=2):
    return [TrackRequest(title=f"Song {i}", artist=f"Artist {i}", duration_ms=200_000 + i) for i in range(n)]


async def test_create_import_makes_a_parent_and_a_child_per_track(db, settings, user_id):
    parent, child_ids = await imports.create_import(db, user_id, tracks(3), settings)
    assert parent.kind == JobKind.IMPORT
    assert parent.status == JobStatus.RUNNING
    assert parent.started_at is not None
    assert len(child_ids) == 3

    children = list((await db.execute(select(Job).where(Job.parent_id == parent.id))).scalars())
    assert len(children) == 3
    assert all(c.kind == JobKind.IMPORT_TRACK for c in children)
    assert all(c.status == JobStatus.QUEUED for c in children)


async def test_create_import_stores_the_track_details(db, settings, user_id):
    parent, child_ids = await imports.create_import(
        db, user_id, [TrackRequest("Glory Box", "Portishead", 305_000)], settings
    )
    row = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == child_ids[0]))
    assert row.title == "Glory Box"
    assert row.artist == "Portishead"
    assert row.duration_ms == 305_000
    assert row.norm_key == "portishead|glory box"


async def test_create_import_preserves_track_order(db, settings, user_id):
    parent, child_ids = await imports.create_import(db, user_id, tracks(5), settings)
    rows = await imports.get_import_rows(db, parent.id)
    assert [r[1].title for r in rows] == [f"Song {i}" for i in range(5)]


async def test_create_import_rejects_an_empty_list(db, settings, user_id):
    with pytest.raises(imports.EmptyImportError):
        await imports.create_import(db, user_id, [], settings)


async def test_create_import_enforces_the_cap(db, settings, user_id):
    settings.import_max_tracks = 3
    with pytest.raises(imports.ImportTooLargeError, match="3"):
        await imports.create_import(db, user_id, tracks(4), settings)


async def test_create_import_allows_exactly_the_cap(db, settings, user_id):
    settings.import_max_tracks = 3
    parent, child_ids = await imports.create_import(db, user_id, tracks(3), settings)
    assert len(child_ids) == 3


async def test_create_import_respects_the_pending_limit(db, settings, user_id):
    db.add_all(
        [
            Job(user_id=user_id, url=f"https://www.youtube.com/watch?v={i}", kind=JobKind.SINGLE)
            for i in range(settings.max_pending_jobs_per_user)
        ]
    )
    await db.commit()
    with pytest.raises(PendingLimitError):
        await imports.create_import(db, user_id, tracks(1), settings)


async def test_create_import_does_not_count_its_own_children(db, settings, user_id):
    """Two imports in a row must be possible even though the first made many children."""
    settings.max_pending_jobs_per_user = 3
    await imports.create_import(db, user_id, tracks(10), settings)
    parent, _ = await imports.create_import(db, user_id, tracks(10), settings)
    assert parent.id is not None


async def test_get_import_scopes_to_the_owner(db, settings, user_id):
    import uuid as _uuid

    parent, _ = await imports.create_import(db, user_id, tracks(1), settings)
    assert await imports.get_import(db, user_id, parent.id) is not None
    assert await imports.get_import(db, _uuid.uuid4(), parent.id) is None


async def test_get_import_rows_pairs_each_job_with_its_track(db, settings, user_id):
    parent, child_ids = await imports.create_import(db, user_id, tracks(2), settings)
    rows = await imports.get_import_rows(db, parent.id)
    assert [job.id for job, _ in rows] == child_ids
    assert all(job.id == track.job_id for job, track in rows)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_jobs_imports.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mp3server.jobs.imports'`

- [ ] **Step 3: Write the implementation**

In `src/mp3server/config.py`, add to `Settings` after `playlist_max_entries`:

```python
    # a bulk import is one request, but it must not be an unbounded one
    import_max_tracks: int = 500
    resolve_search_limit: int = 5
    # resolution runs on its own queue so a bulk import never sits in front of a
    # room waiting for audio; max_jobs is small and downloads must win
    resolve_queue_name: str = "arq:resolve"
```

Create `src/mp3server/jobs/imports.py`:

```python
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from mp3server.config import Settings
from mp3server.jobs.service import PendingLimitError
from mp3server.matching import norm_key
from mp3server.models import (
    ImportTrack, Job, JobKind, JobStatus, PENDING_STATUSES, utcnow,
)

# jobs.url is NOT NULL and an import has no URL. Storing something readable
# keeps logs and manual queries legible.
IMPORT_URL = "import:tracklist"


class EmptyImportError(Exception):
    pass


class ImportTooLargeError(Exception):
    pass


@dataclass(frozen=True)
class TrackRequest:
    title: str
    artist: str
    duration_ms: int | None = None


async def create_import(
    db: AsyncSession,
    user_id: uuid.UUID,
    tracks: list[TrackRequest],
    settings: Settings,
) -> tuple[Job, list[uuid.UUID]]:
    """One parent job plus one child per track, created in a single commit.

    expand_playlist does this after a network call, so it has to run in the
    worker. An import already has its track list, so it happens inline and the
    caller can enqueue the children immediately.
    """
    if not tracks:
        raise EmptyImportError("no tracks to import")
    if len(tracks) > settings.import_max_tracks:
        raise ImportTooLargeError(
            f"{len(tracks)} tracks exceeds the limit of {settings.import_max_tracks}"
        )
    pending = await db.scalar(
        select(func.count())
        .select_from(Job)
        .where(
            Job.user_id == user_id,
            Job.parent_id.is_(None),
            Job.status.in_(PENDING_STATUSES),
        )
    )
    if pending >= settings.max_pending_jobs_per_user:
        raise PendingLimitError(
            f"pending job limit reached ({settings.max_pending_jobs_per_user})"
        )

    parent = Job(
        user_id=user_id,
        url=IMPORT_URL,
        kind=JobKind.IMPORT,
        status=JobStatus.RUNNING,
        started_at=utcnow(),
    )
    db.add(parent)
    await db.flush()

    children = [
        Job(
            user_id=user_id,
            url=f"import:{track.artist} - {track.title}",
            kind=JobKind.IMPORT_TRACK,
            parent_id=parent.id,
        )
        for track in tracks
    ]
    db.add_all(children)
    await db.flush()

    db.add_all(
        [
            ImportTrack(
                job_id=child.id,
                position=index,
                norm_key=norm_key(track.artist, track.title),
                title=track.title,
                artist=track.artist,
                duration_ms=track.duration_ms,
            )
            for index, (child, track) in enumerate(zip(children, tracks))
        ]
    )
    await db.commit()
    return parent, [child.id for child in children]


async def get_import(
    db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID
) -> Job | None:
    return await db.scalar(
        select(Job).where(
            Job.id == job_id, Job.user_id == user_id, Job.kind == JobKind.IMPORT
        )
    )


async def get_import_rows(
    db: AsyncSession, parent_id: uuid.UUID
) -> list[tuple[Job, ImportTrack]]:
    """Each child job beside the track it was asked to find, in import order."""
    result = await db.execute(
        select(Job, ImportTrack)
        .join(ImportTrack, ImportTrack.job_id == Job.id)
        .where(Job.parent_id == parent_id)
        .order_by(ImportTrack.position)
    )
    return [(job, track) for job, track in result]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_jobs_imports.py tests/test_models.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/jobs/imports.py src/mp3server/config.py tests/test_jobs_imports.py
git commit -m "Add the import job service"
```

---

### Task 8: The resolve_track worker task

**Files:**
- Modify: `src/mp3server/worker.py`
- Modify: `src/mp3server/jobs/service.py` (`task_name_for`, `cancel_job`)
- Test: `tests/test_worker_resolve.py`

**Interfaces:**
- Consumes: `ytdl.search` (Task 4), `matching.pick_candidate` (Task 3), `ImportTrack` (Task 5), `finalize_parent` (existing)
- Produces: `resolve_track(ctx: dict, job_id: str) -> None`

- [ ] **Step 1: Write the failing test**

Create `tests/test_worker_resolve.py`:

```python
import uuid

import pytest
from sqlalchemy import select
from yt_dlp.utils import DownloadError

from mp3server import worker
from mp3server.jobs import imports
from mp3server.jobs.imports import TrackRequest
from mp3server.matching import Candidate
from mp3server.models import ImportTrack, Job, JobStatus


@pytest.fixture
def ctx(settings, session_factory, fake_queue):
    return {"settings": settings, "session_factory": session_factory, "redis": fake_queue}


async def make_import(db, settings, user_id, track):
    parent, child_ids = await imports.create_import(db, user_id, [track], settings)
    return parent, child_ids[0]


async def reload(db, job_id):
    db.expire_all()
    return await db.get(Job, job_id)


async def test_resolve_track_stores_a_confident_match(ctx, db, settings, user_id, monkeypatch):
    parent, child_id = await make_import(
        db, settings, user_id, TrackRequest("Glory Box", "Portishead", 305_000)
    )
    monkeypatch.setattr(
        worker.ytdl, "search",
        lambda q, limit, cookies: [Candidate("album", "Glory Box", "Portishead", 306)],
    )
    await worker.resolve_track(ctx, str(child_id))

    job = await reload(db, child_id)
    assert job.status == JobStatus.COMPLETED
    assert job.video_id == "album"
    row = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == child_id))
    assert row.matched_title == "Glory Box"
    assert row.confidence == "high"


async def test_resolve_track_searches_for_artist_and_title(ctx, db, settings, user_id, monkeypatch):
    seen = {}
    _, child_id = await make_import(
        db, settings, user_id, TrackRequest("Glory Box", "Portishead", 305_000)
    )

    def fake_search(query, limit, cookies):
        seen["query"] = query
        seen["limit"] = limit
        return [Candidate("x", "Glory Box", "Portishead", 305)]

    monkeypatch.setattr(worker.ytdl, "search", fake_search)
    await worker.resolve_track(ctx, str(child_id))
    assert seen["query"] == "Portishead Glory Box"
    assert seen["limit"] == settings.resolve_search_limit


async def test_resolve_track_marks_not_found_when_nothing_matches(ctx, db, settings, user_id, monkeypatch):
    _, child_id = await make_import(
        db, settings, user_id, TrackRequest("Glory Box", "Portishead", 305_000)
    )
    monkeypatch.setattr(
        worker.ytdl, "search",
        lambda q, limit, cookies: [Candidate("live", "Live", "Bootleg", 3600)],
    )
    await worker.resolve_track(ctx, str(child_id))

    job = await reload(db, child_id)
    assert job.status == JobStatus.NOT_FOUND
    assert job.video_id is None
    assert job.finished_at is not None


async def test_resolve_track_marks_not_found_for_an_empty_search(ctx, db, settings, user_id, monkeypatch):
    _, child_id = await make_import(db, settings, user_id, TrackRequest("Nothing", "Nobody", 1000))
    monkeypatch.setattr(worker.ytdl, "search", lambda q, limit, cookies: [])
    await worker.resolve_track(ctx, str(child_id))
    assert (await reload(db, child_id)).status == JobStatus.NOT_FOUND


async def test_resolve_track_reuses_a_previous_resolution(ctx, db, settings, user_id, monkeypatch):
    """The cache: a second import of the same track must not search again."""
    _, first_id = await make_import(
        db, settings, user_id, TrackRequest("Glory Box", "Portishead", 305_000)
    )
    monkeypatch.setattr(
        worker.ytdl, "search",
        lambda q, limit, cookies: [Candidate("album", "Glory Box", "Portishead", 305)],
    )
    await worker.resolve_track(ctx, str(first_id))

    _, second_id = await make_import(
        db, settings, user_id, TrackRequest("glory box", "PORTISHEAD", 305_000)
    )

    def explode(*args, **kwargs):
        raise AssertionError("must not search when a resolution is cached")

    monkeypatch.setattr(worker.ytdl, "search", explode)
    await worker.resolve_track(ctx, str(second_id))

    job = await reload(db, second_id)
    assert job.status == JobStatus.COMPLETED
    assert job.video_id == "album"
    row = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == second_id))
    assert row.matched_title == "Glory Box"


async def test_resolve_track_finalizes_the_parent_when_every_child_is_done(ctx, db, settings, user_id, monkeypatch):
    parent, child_ids = await imports.create_import(
        db, user_id,
        [TrackRequest("A", "X", 100_000), TrackRequest("B", "Y", 100_000)],
        settings,
    )
    monkeypatch.setattr(
        worker.ytdl, "search",
        lambda q, limit, cookies: [Candidate("v", "T", "X", 100)],
    )
    await worker.resolve_track(ctx, str(child_ids[0]))
    assert (await reload(db, parent.id)).status == JobStatus.RUNNING
    await worker.resolve_track(ctx, str(child_ids[1]))
    assert (await reload(db, parent.id)).status == JobStatus.COMPLETED


async def test_a_partly_resolved_import_finalizes_as_partial(ctx, db, settings, user_id, monkeypatch):
    parent, child_ids = await imports.create_import(
        db, user_id,
        [TrackRequest("A", "X", 100_000), TrackRequest("B", "Y", 100_000)],
        settings,
    )
    monkeypatch.setattr(
        worker.ytdl, "search",
        lambda q, limit, cookies: [Candidate("v", "T", "X", 100)],
    )
    await worker.resolve_track(ctx, str(child_ids[0]))
    monkeypatch.setattr(worker.ytdl, "search", lambda q, limit, cookies: [])
    await worker.resolve_track(ctx, str(child_ids[1]))
    assert (await reload(db, parent.id)).status == JobStatus.PARTIAL


async def test_resolve_track_skips_a_job_that_is_not_queued(ctx, db, settings, user_id, monkeypatch):
    _, child_id = await make_import(db, settings, user_id, TrackRequest("A", "X", 100_000))
    job = await db.get(Job, child_id)
    job.status = JobStatus.COMPLETED
    await db.commit()

    def explode(*args, **kwargs):
        raise AssertionError("must not search a job it did not claim")

    monkeypatch.setattr(worker.ytdl, "search", explode)
    await worker.resolve_track(ctx, str(child_id))


async def test_resolve_track_honours_a_cancel_request(ctx, db, settings, user_id, monkeypatch):
    _, child_id = await make_import(db, settings, user_id, TrackRequest("A", "X", 100_000))
    job = await db.get(Job, child_id)
    job.cancel_requested = True
    await db.commit()

    monkeypatch.setattr(
        worker.ytdl, "search",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not search")),
    )
    await worker.resolve_track(ctx, str(child_id))
    assert (await reload(db, child_id)).status == JobStatus.CANCELED


async def test_resolve_track_fails_loudly_on_a_permanent_search_error(ctx, db, settings, user_id, monkeypatch):
    _, child_id = await make_import(db, settings, user_id, TrackRequest("A", "X", 100_000))

    def boom(*args, **kwargs):
        raise DownloadError("ERROR: Video unavailable")

    monkeypatch.setattr(worker.ytdl, "search", boom)
    await worker.resolve_track(ctx, str(child_id))

    job = await reload(db, child_id)
    assert job.status == JobStatus.FAILED
    assert "unavailable" in job.error.lower()


async def test_resolve_track_reports_a_missing_track_row(ctx, db, settings, user_id):
    """A child with no import_tracks row is a bug, and must not pass silently."""
    job = Job(user_id=user_id, url="import:x", kind="import_track")
    db.add(job)
    await db.commit()
    await worker.resolve_track(ctx, str(job.id))
    assert (await reload(db, job.id)).status == JobStatus.FAILED
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_worker_resolve.py -q`
Expected: FAIL — `AttributeError: module 'mp3server.worker' has no attribute 'resolve_track'`

- [ ] **Step 3: Write the implementation**

In `src/mp3server/worker.py`, extend the imports:

```python
from mp3server import matching, ytdl
from mp3server.models import File, ImportTrack, Job, JobKind, JobStatus, utcnow
```

and append the task (before `recover_stale_jobs`):

```python
async def resolve_track(ctx: dict, job_id: str) -> None:
    """Find the video for one imported track. Never downloads audio: the bytes
    arrive through the normal download path if and when someone plays it."""
    settings = ctx["settings"]
    session_factory = ctx["session_factory"]
    jid = uuid.UUID(job_id)

    async with session_factory() as db:
        job = await db.get(Job, jid)
        if job is None:
            logger.error("resolve_track: job %s not found", job_id)
            return
        if job.status != JobStatus.QUEUED:
            logger.info("job %s skipped (status=%s)", job_id, job.status)
            return
        if job.cancel_requested:
            job.status = JobStatus.CANCELED
            job.finished_at = utcnow()
            await db.commit()
            await finalize_parent(db, job.parent_id)
            return
        job.status = JobStatus.RUNNING
        job.started_at = utcnow()
        await db.commit()

        track = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == jid))
        if track is None:
            await _fail_job(session_factory, jid, "import job has no track row")
            return
        artist, title = track.artist, track.title
        duration_ms, key = track.duration_ms, track.norm_key

        cached = (
            await db.execute(
                select(Job.video_id, ImportTrack.matched_title, ImportTrack.confidence)
                .join(ImportTrack, ImportTrack.job_id == Job.id)
                .where(
                    ImportTrack.norm_key == key,
                    Job.status == JobStatus.COMPLETED,
                    Job.video_id.is_not(None),
                )
                .order_by(Job.finished_at.desc())
                .limit(1)
            )
        ).first()

    if cached is not None:
        video_id, matched_title, confidence = cached
        await _complete_resolution(session_factory, jid, video_id, matched_title, confidence)
        logger.info("job %s resolved from cache (%s)", job_id, video_id)
        return

    try:
        candidates = await asyncio.to_thread(
            ytdl.search, f"{artist} {title}", settings.resolve_search_limit,
            settings.cookies_file,
        )
    except DownloadError as exc:
        await _handle_download_error(ctx, session_factory, jid, exc)
        return

    match = matching.pick_candidate(candidates, duration_ms, artist)
    if match is None:
        # a distinct outcome from failure: the search worked, nothing matched.
        # Retrying would return the same results, so this is terminal.
        async with session_factory() as db:
            job = await _require_job(db, jid)
            job.status = JobStatus.NOT_FOUND
            job.progress = 100
            job.finished_at = utcnow()
            await db.commit()
            await finalize_parent(db, job.parent_id)
        logger.info("job %s found no match for %r by %r", job_id, title, artist)
        return

    await _complete_resolution(session_factory, jid, match.video_id, match.title, match.confidence)
    logger.info("job %s resolved to %s (%s)", job_id, match.video_id, match.confidence)


async def _complete_resolution(
    session_factory, jid: uuid.UUID, video_id: str,
    matched_title: str | None, confidence: str | None,
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
        await db.commit()
        await finalize_parent(db, job.parent_id)
```

In `src/mp3server/jobs/service.py`, teach `task_name_for` the new kind:

```python
def task_name_for(kind: str) -> str:
    if kind == JobKind.PLAYLIST:
        return "expand_playlist"
    if kind == JobKind.IMPORT_TRACK:
        return "resolve_track"
    return "download_audio"
```

and make `cancel_job` cascade for imports as well as playlists — replace both `job.kind == JobKind.PLAYLIST` checks in that function with:

```python
        if job.kind in (JobKind.PLAYLIST, JobKind.IMPORT):
```

and

```python
    if job.kind in (JobKind.PLAYLIST, JobKind.IMPORT):
        await finalize_parent(db, job.id)
```

In `src/mp3server/worker.py`, `recover_stale_jobs` must not re-run parents and must enqueue import children onto the resolve queue. Replace the stale query's `RUNNING` clause:

```python
                    and_(
                        Job.status == JobStatus.RUNNING,
                        Job.kind.not_in([JobKind.PLAYLIST, JobKind.IMPORT]),
                    ),
```

the stuck-parent query's kind filter:

```python
                Job.kind.in_([JobKind.PLAYLIST, JobKind.IMPORT]),
```

collect the kind alongside the id:

```python
        recovered = [(str(j.id), task_name_for(j.kind), j.kind) for j in stale + orphaned]
```

and route the enqueue:

```python
    for job_id, task_name, kind in recovered:
        await ctx["redis"].enqueue_job(
            task_name, job_id, _queue_name=_queue_for(kind, settings)
        )
        logger.warning("recovered stale job %s -> %s", job_id, task_name)
```

with the helper near the top of `worker.py`:

```python
def _queue_for(kind: str, settings) -> str:
    """Import children go to the resolve queue; everything else to the default.
    A recovered job must land where its worker is listening."""
    if kind == JobKind.IMPORT_TRACK:
        return settings.resolve_queue_name
    return default_queue_name()
```

importing arq's default:

```python
from arq.connections import RedisSettings, default_queue_name
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_worker_resolve.py tests/test_worker_expand.py tests/test_jobs_service.py -q`
Expected: PASS

Then the whole suite, to confirm the recovery changes broke nothing:
Run: `.venv/bin/python -m pytest -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/worker.py src/mp3server/jobs/service.py tests/test_worker_resolve.py
git commit -m "Resolve imported tracks in the worker"
```

---

### Task 9: The /imports API

**Files:**
- Create: `src/mp3server/routes/imports.py`
- Modify: `src/mp3server/main.py`
- Test: `tests/test_api_imports.py`

**Interfaces:**
- Consumes: `imports.create_import`, `imports.get_import`, `imports.get_import_rows` (Task 7); `spotify.fetch_playlist` (Task 2); `settings.resolve_queue_name` (Task 7)
- Produces: `POST /imports`, `GET /imports/{job_id}`, `GET /imports/spotify`

- [ ] **Step 1: Write the failing test**

Create `tests/test_api_imports.py`:

```python
import uuid

import pytest
from sqlalchemy import select

from mp3server import spotify
from mp3server.models import ImportTrack, Job, JobStatus
from mp3server.routes import imports as imports_route

PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M"


def body(n=2):
    return {
        "tracks": [
            {"title": f"Song {i}", "artist": f"Artist {i}", "duration_ms": 200_000}
            for i in range(n)
        ]
    }


async def test_create_import_returns_a_job(client, authed, fake_queue):
    response = await client.post("/imports", json=body(3))
    assert response.status_code == 202
    payload = response.json()
    assert payload["kind"] == "import"
    assert payload["total"] == 3
    assert uuid.UUID(payload["id"])


async def test_create_import_enqueues_every_child_on_the_resolve_queue(
    client, authed, fake_queue, settings
):
    await client.post("/imports", json=body(3))
    assert len(fake_queue.jobs) == 3
    assert all(name == "resolve_track" for name, _ in fake_queue.jobs)
    assert all(
        kwargs.get("_queue_name") == settings.resolve_queue_name
        for kwargs in fake_queue.kwargs
    )


async def test_create_import_rejects_an_empty_list(client, authed):
    response = await client.post("/imports", json={"tracks": []})
    assert response.status_code == 422


async def test_create_import_rejects_too_many_tracks(client, authed, settings):
    settings.import_max_tracks = 2
    response = await client.post("/imports", json=body(3))
    assert response.status_code == 422
    assert "2" in response.json()["detail"]


async def test_create_import_requires_auth(client):
    assert (await client.post("/imports", json=body())).status_code == 401


async def test_get_import_reports_each_track(client, authed, db):
    created = (await client.post("/imports", json=body(2))).json()
    response = await client.get(f"/imports/{created['id']}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert payload["done"] == 0
    assert [t["title"] for t in payload["tracks"]] == ["Song 0", "Song 1"]
    assert all(t["state"] == "pending" for t in payload["tracks"])


async def test_get_import_maps_statuses_to_states(client, authed, db):
    created = (await client.post("/imports", json=body(3))).json()
    children = list(
        (
            await db.execute(
                select(Job).where(Job.parent_id == uuid.UUID(created["id"]))
            )
        ).scalars()
    )
    children.sort(key=lambda j: j.created_at)
    children[0].status = JobStatus.COMPLETED
    children[0].video_id = "vid0"
    children[1].status = JobStatus.NOT_FOUND
    children[2].status = JobStatus.FAILED
    children[2].error = "boom"
    row = await db.scalar(select(ImportTrack).where(ImportTrack.job_id == children[0].id))
    row.matched_title = "Matched"
    row.confidence = "high"
    await db.commit()

    payload = (await client.get(f"/imports/{created['id']}")).json()
    states = {t["title"]: t for t in payload["tracks"]}
    assert states["Song 0"]["state"] == "resolved"
    assert states["Song 0"]["video_id"] == "vid0"
    assert states["Song 0"]["matched_title"] == "Matched"
    assert states["Song 0"]["confidence"] == "high"
    assert states["Song 1"]["state"] == "not_found"
    assert states["Song 2"]["state"] == "failed"
    assert states["Song 2"]["error"] == "boom"
    assert payload["done"] == 3


async def test_get_import_404s_for_someone_elses_job(client, authed, db, app):
    from mp3server.auth import get_current_user_id

    created = (await client.post("/imports", json=body(1))).json()
    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    assert (await client.get(f"/imports/{created['id']}")).status_code == 404


async def test_get_import_404s_for_an_unknown_job(client, authed):
    assert (await client.get(f"/imports/{uuid.uuid4()}")).status_code == 404


async def test_spotify_preview_returns_tracks(client, authed, monkeypatch):
    monkeypatch.setattr(
        imports_route.spotify, "fetch_playlist",
        lambda url: spotify.SpotifyPlaylist(
            name="Today's Top Hits",
            tracks=[spotify.SpotifyTrack("Animal", "KATSEYE", 158494)],
            truncated=False,
        ),
    )
    response = await client.get(
        "/imports/spotify", params={"url": f"https://open.spotify.com/playlist/{PLAYLIST_ID}"}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Today's Top Hits"
    assert payload["truncated"] is False
    assert payload["tracks"][0] == {
        "title": "Animal", "artist": "KATSEYE", "duration_ms": 158494
    }


async def test_spotify_preview_reports_truncation(client, authed, monkeypatch):
    monkeypatch.setattr(
        imports_route.spotify, "fetch_playlist",
        lambda url: spotify.SpotifyPlaylist(
            name="Long", tracks=[spotify.SpotifyTrack("t", "a", 1)], truncated=True
        ),
    )
    response = await client.get("/imports/spotify", params={"url": "https://open.spotify.com/playlist/x"})
    assert response.json()["truncated"] is True


async def test_spotify_preview_surfaces_a_bad_link(client, authed, monkeypatch):
    def boom(url):
        raise spotify.SpotifyError("not a Spotify playlist link")

    monkeypatch.setattr(imports_route.spotify, "fetch_playlist", boom)
    response = await client.get("/imports/spotify", params={"url": "nope"})
    assert response.status_code == 422
    assert "not a Spotify playlist link" in response.json()["detail"]


async def test_spotify_preview_requires_auth(client):
    assert (await client.get("/imports/spotify", params={"url": "x"})).status_code == 401
```

`FakeQueue` in `tests/conftest.py` currently drops kwargs; record them so the queue-name assertion can work:

```python
class FakeQueue:
    def __init__(self):
        self.jobs = []
        self.kwargs = []

    async def enqueue_job(self, name, *args, **kwargs):
        self.jobs.append((name, args))
        self.kwargs.append(kwargs)

    async def ping(self) -> bool:
        return True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_api_imports.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mp3server.routes.imports'`

- [ ] **Step 3: Write the implementation**

Create `src/mp3server/routes/imports.py`:

```python
import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from mp3server import spotify
from mp3server.auth import get_current_user_id
from mp3server.config import Settings
from mp3server.deps import get_app_settings, get_db, get_queue
from mp3server.jobs import imports as service
from mp3server.jobs.service import PendingLimitError
from mp3server.models import ImportTrack, Job, JobStatus, TERMINAL_STATUSES, utcnow

router = APIRouter(prefix="/imports", tags=["imports"])


class TrackIn(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    artist: str = Field(min_length=1, max_length=500)
    duration_ms: int | None = Field(default=None, ge=0)


class ImportRequest(BaseModel):
    tracks: list[TrackIn]


class ImportCreated(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    total: int


class TrackState(BaseModel):
    title: str
    artist: str
    state: str
    video_id: str | None = None
    matched_title: str | None = None
    confidence: str | None = None
    error: str | None = None


class ImportStatus(BaseModel):
    id: uuid.UUID
    status: str
    total: int
    done: int
    tracks: list[TrackState]


class SpotifyTrackOut(BaseModel):
    title: str
    artist: str
    duration_ms: int | None


class SpotifyPreview(BaseModel):
    name: str
    truncated: bool
    tracks: list[SpotifyTrackOut]


def _state_for(job: Job) -> str:
    if job.status == JobStatus.COMPLETED:
        return "resolved"
    if job.status == JobStatus.NOT_FOUND:
        return "not_found"
    if job.status in (JobStatus.FAILED, JobStatus.CANCELED):
        return "failed"
    return "pending"


@router.post("", status_code=202, response_model=ImportCreated)
async def create_import(
    body: ImportRequest,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
    queue=Depends(get_queue),
    settings: Settings = Depends(get_app_settings),
) -> ImportCreated:
    requests = [
        service.TrackRequest(title=t.title, artist=t.artist, duration_ms=t.duration_ms)
        for t in body.tracks
    ]
    try:
        parent, child_ids = await service.create_import(db, user_id, requests, settings)
    except service.EmptyImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except service.ImportTooLargeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PendingLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    try:
        for child_id in child_ids:
            await queue.enqueue_job(
                "resolve_track", str(child_id), _queue_name=settings.resolve_queue_name
            )
    except Exception as exc:
        parent.status = JobStatus.FAILED
        parent.error = f"failed to enqueue: {exc}"
        parent.finished_at = utcnow()
        await db.commit()
        raise HTTPException(status_code=503, detail="queue unavailable") from exc

    return ImportCreated(
        id=parent.id, kind=parent.kind, status=parent.status, total=len(child_ids)
    )


@router.get("/spotify", response_model=SpotifyPreview)
async def preview_spotify_playlist(
    url: str = Query(min_length=1),
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> SpotifyPreview:
    """Read a public Spotify playlist so the user can confirm before importing.

    Declared before /{job_id} so the literal path wins the route match.
    """
    try:
        playlist = await asyncio.to_thread(spotify.fetch_playlist, url)
    except spotify.SpotifyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return SpotifyPreview(
        name=playlist.name,
        truncated=playlist.truncated,
        tracks=[
            SpotifyTrackOut(title=t.title, artist=t.artist, duration_ms=t.duration_ms)
            for t in playlist.tracks
        ],
    )


@router.get("/{job_id}", response_model=ImportStatus)
async def get_import(
    job_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> ImportStatus:
    parent = await service.get_import(db, user_id, job_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="import not found")
    rows = await service.get_import_rows(db, parent.id)
    tracks = [
        TrackState(
            title=track.title,
            artist=track.artist,
            state=_state_for(job),
            video_id=job.video_id,
            matched_title=track.matched_title,
            confidence=track.confidence,
            error=job.error,
        )
        for job, track in rows
    ]
    return ImportStatus(
        id=parent.id,
        status=parent.status,
        total=len(rows),
        done=sum(1 for job, _ in rows if job.status in TERMINAL_STATUSES),
        tracks=tracks,
    )
```

In `src/mp3server/main.py`, add the import and register the router:

```python
from mp3server.routes import captions, downloads, files, health, imports
```

```python
    app.include_router(imports.router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_api_imports.py -q`
Expected: PASS

Run: `.venv/bin/python -m pytest -q`
Expected: PASS — full suite green

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/routes/imports.py src/mp3server/main.py tests/test_api_imports.py tests/conftest.py
git commit -m "Add the /imports API"
```

---

### Task 10: The resolve queue and its worker

**Files:**
- Modify: `src/mp3server/worker.py` (`ResolveWorkerSettings`)
- Modify: `docker-compose.yml`
- Test: `tests/test_worker_resolve.py` (append)

`WorkerSettings.max_jobs` is 2. Two bulk imports would occupy both slots and a room waiting on a track would sit behind them, so resolution gets its own queue and its own worker process. Resolution is metadata-only — no ffmpeg, no disk — so the new service is small.

**Interfaces:**
- Consumes: `resolve_track` (Task 8), `settings.resolve_queue_name` (Task 7)
- Produces: `ResolveWorkerSettings`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_worker_resolve.py`:

```python
def test_resolve_worker_listens_on_its_own_queue():
    from mp3server.config import Settings

    settings = Settings(
        _env_file=None, database_url="sqlite+aiosqlite://", supabase_jwt_secret="s"
    )
    assert worker.ResolveWorkerSettings.queue_name == settings.resolve_queue_name


def test_resolve_worker_only_runs_resolution():
    names = [f.__name__ for f in worker.ResolveWorkerSettings.functions]
    assert names == ["resolve_track"]


def test_download_worker_does_not_claim_resolution():
    """The default queue must not run resolve_track, or the split is pointless."""
    names = [f.__name__ for f in worker.WorkerSettings.functions]
    assert "resolve_track" not in names


def test_resolve_worker_has_no_cron_jobs():
    """Cache expiry and stale recovery belong to one worker only; running them
    twice would have two processes evicting the same objects."""
    assert getattr(worker.ResolveWorkerSettings, "cron_jobs", []) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_worker_resolve.py -q`
Expected: FAIL — `AttributeError: module 'mp3server.worker' has no attribute 'ResolveWorkerSettings'`

- [ ] **Step 3: Write the implementation**

In `src/mp3server/worker.py`, append after `WorkerSettings`:

```python
class ResolveWorkerSettings:
    """Resolution runs apart from downloads on purpose.

    WorkerSettings.max_jobs is small, and a bulk import would otherwise occupy
    every slot while a room waits for the track it is about to play. This
    process only searches metadata — no ffmpeg, no disk — so it stays cheap.

    No cron jobs here: cache expiry and stale-job recovery belong to the
    download worker alone, and running them in two processes would have both
    evicting the same objects.
    """

    functions = [resolve_track]
    on_startup = startup
    on_shutdown = shutdown
    max_tries = 3
    # metadata only: a search that has not returned in five minutes is stuck
    job_timeout = 300
    max_jobs = int(os.environ.get("MAX_PARALLEL_RESOLVE_JOBS", "4"))
    queue_name = os.environ.get("RESOLVE_QUEUE_NAME", "arq:resolve")
    redis_settings = RedisSettings.from_dsn(
        os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    )
```

In `docker-compose.yml`, add a service after `worker`:

```yaml
  resolver:
    build: .
    command: arq mp3server.worker.ResolveWorkerSettings
    env_file: .env
    environment:
      REDIS_URL: redis://redis:6379/0
      STORAGE_DIR: /data/mp3
    volumes:
      - mp3data:/data/mp3
    depends_on:
      redis:
        condition: service_healthy
    # metadata-only work: no ffmpeg, no downloads, so it needs neither the
    # CPU share nor the memory the download worker does. Ranked below both the
    # API and the download worker, which is the whole point of the split.
    cpu_shares: 128
    mem_limit: 384m
    restart: unless-stopped
    logging: *logging
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_worker_resolve.py -q`
Expected: PASS

Verify the compose file is valid:
Run: `docker compose config --quiet && echo OK`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add src/mp3server/worker.py docker-compose.yml tests/test_worker_resolve.py
git commit -m "Run resolution on its own queue so imports never block playback"
```

---

## Final Verification

- [ ] Full suite: `.venv/bin/python -m pytest -q` → all pass
- [ ] Network tests: `.venv/bin/python -m pytest -m network -q` → Spotify embed and yt-dlp search both still parse
- [ ] Migration applies cleanly against a scratch database, then rolls back:
  `alembic upgrade head && alembic downgrade -1 && alembic upgrade head`
- [ ] End-to-end against a locally running stack: `POST /imports` with three real tracks, poll `GET /imports/{id}` until `done == total`, confirm two resolve and the deliberate nonsense one reports `not_found`
- [ ] Start an import and confirm a `POST /downloads` still completes while it runs — the queue split doing its job

## Risks

- **Match quality is the whole feature.** A confident-looking wrong match is worse than a reported miss, which is why `low` confidence is a distinct state the UI must show differently.
- **The Spotify embed is an undocumented payload.** It will break without warning. `test_fetch_playlist_against_the_real_embed` under `-m network` is what tells us when.
- **Two workers now share one Redis.** Only the download worker runs cron jobs; if that ever changes, cache eviction will run twice concurrently.
