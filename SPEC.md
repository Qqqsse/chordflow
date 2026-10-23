# chordflow — Engineering Specification

> **Version:** 1.0-draft (implementation baseline)  
> **Date:** 2026-10-23 (Asia/Taipei)  
> **Audience:** Claude Code Cloud Sessions, maintainers, local GPU integration contributors  
> **Project:** `chordflow` — local-first, Docker-first guitar sing-along chord-sheet web application  
> **Status:** Ready for implementation. Unresolved infrastructure details are handled by adapters/configuration, **not** by blocking feature development.

## 0. Instructions to the coding agent (READ FIRST)

This is an **execution specification**, not a suggestion to generate the entire application in one response. Work on milestones in order, deliver working commits, and **verify every change with tests**. The GitHub repository may initially be empty and private. Do not assume previously created files, secrets, cloud services, GPU devices, or a working Docker daemon.

1. **Before any code:** inspect repository and environment; summarize existing state, available runtimes, and expected milestone. If repository is empty, initialize M0. Do not overwrite user files.
2. **Primary objective before 2026-11-05:** maximize verified, GPU-independent implementation using the available Claude Code cloud credits. Prioritize M0–M6 and mocked M7 over untestable GPU model integrations. There is no requirement to spend credits artificially; prioritize useful, reproducible work.
3. Never make **Next.js, the chart viewer, music theory, storage schema, or core tests depend on CUDA/Python/model weights**. All can run with fixture JSON and mock repositories.
4. Use **test-first** development for theory/parser/schema and test-backed development for UI/API. After each task run typecheck, lint, tests and appropriate build. Commit small, focused, reviewable changes. If tools are unavailable, record the exact limitation; do not claim tests passed.
5. Package/API contracts are binding. Changes to contracts require schema versioning, fixtures, migrations, and corresponding tests.
6. **No unauthorized audio scraping/downloads.** A public YouTube URL is *not* permission to download/store the audiovisual stream. Design source adapters that support metadata and authorized audio processing separately.
7. Do not store or commit tokens, passwords, `.env`, proprietary lyrics/audio, raw credentials, cloud service accounts, pretrained weights, or paid API dumps. Only synthetic or appropriately licensed fixtures go in the repository.
8. Use Traditional Chinese (`zh-TW`) as the default **product UI locale**. Source code identifiers, JSON keys and API paths are in English. Keep architecture docs understandable to future international contributors.
9. Do not use blanket `any`, hardcoded mock behavior in production paths, hidden fallbacks that fabricate analysis confidence, or unrelated mass refactors.
10. After each milestone deliver: summary, design decisions, changed files, passing and skipped test commands, commit hash, known limitations, and next task. Place durable context in `docs/agent-handoff.md`.

### Definition of done (global)

A milestone is *done* only when its own acceptance criteria pass, unit/contract tests are deterministic, the TypeScript build is clean (where relevant), newly exposed routes handle errors, docs/fixtures are updated, and its work is committed. Functional GPU inference, paid cloud access, public copyright-protected song ingestion and final production credentials are **not** prerequisites for finishing cloud milestones.

---

## 1. Product identity, users and scope

**Product statement:** a modern, minimal, accessible web app for people who need a chord sheet **while singing and playing guitar**. Search by song and artist, select a particular performance or reusable acoustic arrangement, then transpose, set capo, view helpful fingerings and play without distractions. AI-assisted chart creation is an expandable workflow, not a runtime dependency of the viewer.

**Initial audience:** project owner and invited friends. **Initial deployment:** on the owner's local machine, running Docker Compose, with NVIDIA RTX 5090 reserved for local audio AI. Later publication/commercial deployment must be possible by moving the stateless web container and persistent database to a VPS, cloud VM or managed environment while the GPU remains on-site.

### Must-have MVP (P0)

- Responsive chord-sheet viewer for Traditional Chinese and English; ChordPro import/export for a defined, documented subset.
- Preserve accurate chord-to-lyric alignment under font changes and line wraps. A line displays chords above lyrics. Support sections (intro, verse, chorus, bridge, instrumental, outro), labels and explicit line breaks.
- Pure-TypeScript music theory: valid chord parsing, transposition, enharmonic spelling, relative guitar-shape display with capo, Nashville-number and Roman-numeral modes.
- Dynamic SVG guitar chord diagrams with **multiple valid voicings** for one chord, recommended per arrangement and overridable by the player.
- Search local catalog by title, aliases, artist and version. Reuse existing charts instead of reprocessing a song. Song identity and recording identity must not be conflated.
- Persist catalog, revisions, sources and rights metadata in PostgreSQL. Support mock/demo mode when DB is unavailable.
- Continuous scrolling and paginated/column reading modes. Player preferences. Offline access for explicitly saved charts.
- Private/invitation-oriented access; admin can manage/import/edit a basic chart. AI drafts must not automatically become verified public charts.
- Local Docker installation with separable services, secure reverse-proxy compatibility, health checks and backup/restore instructions.

### AI integration (P1 foundation; P2 real GPU)

- API and persisted asynchronous generation jobs, mock GPU worker, status polling, artifacts, idempotency and human review UI.
- Later, authorized audio input, separation, chord/beat/key extraction, ASR/reference lyrics matching, local forced alignment, fusion, LLM review suggestions, draft storage and audit trail.
- **Not** required during cloud-only development: download protected audio from external platforms, production-ready high-accuracy transcription, or demonstrate CUDA inference in the GPU-less sandbox.

### Explicit non-goals for v1

- Guaranteeing transcription of every YouTube/Spotify URL; bulk cloning of 91譜/Chordify catalogs; distributing copyrighted audio/lyrics without rights.
- Precise reconstruction of the original guitarist's physical fingering from a mixed recording. The app presents **recommended** voicings, not falsely labeled original recorded fingerings.
- Guitar tablature transcription, multi-instrument notation, public collaborative wiki moderation, social feeds, subscriptions, billing, distributed Kubernetes or full HA.
- Exact beat-synchronized lyrics/highlighting without corresponding verified timeline data.

---

## 2. Architecture and deployment boundaries

### Logical diagram

```text
Browser/PWA
  ↕ HTTP(S)
Next.js app (UI, authenticated REST BFF, catalog read API)
  ↕ repository adapter
PostgreSQL (catalog, chart revisions, membership, job metadata)
  ↔ artifacts directory / compatible object store (authorized inputs, derived outputs)
  ↕ authenticated pull/ack/result API
Python orchestration worker (no public port required)
  ↳ CPU fixture processors, optional local NVIDIA RTX 5090 inference adapters
  ↳ optional LLM provider: disabled / Vertex AI / other, with spend limits
```

**Read path:** catalog/chart read must continue working when AI worker, GPU, LLM API and source service are offline. **Generation path:** durable job is queued, worker pulls task and reports progress/result. Avoid synchronous inference within Next.js request handlers.

### Runtime components

| Component | Stack | Local Docker | Cloud-session testability |
|---|---|---|---|
| `web` | Next.js App Router, React, TypeScript strict, Tailwind | Yes | Build and Playwright without DB through mock adapter |
| `db` | PostgreSQL | Yes, persistent volume | Can test with fixture repo; integration with ephemeral PG where available |
| `job-coordinator` | Initially app-owned routes + DB job tables | May share Next.js runtime at first | Mocked worker + HTTP contract tests |
| `ai-worker` | Python 3, Pydantic, pytest, modular processors | CPU container / NVIDIA GPU profile | CPU-only unit/integration tests |
| `reverse-proxy` | Existing proxy preferred; optional Caddy example | Profile `public` only | Config syntax validation if binary exists |
| `artifact-store` | Filesystem abstraction initially; S3-compatible later | Persistent directory/volume | Temp-dir fixture implementation |

Prefer **pnpm workspaces** (no requirement for Turborepo). Use PostgreSQL with **Drizzle ORM** in TS app; migrations checked in. A small TypeScript job coordinator may use SQL transactions, but it must expose a language-neutral worker API so Python never imports a Node-specific queue SDK.

### Docker profiles and migration

- `compose.yaml`: CPU-only `web`, `db`, and optional CPU/mock `worker`; must be usable without GPU and should not require public Internet access at runtime after dependencies are installed.
- `compose.gpu-nvidia.yaml`: opt-in GPU Worker with a separate pinned CUDA/PyTorch image and an NVIDIA runtime device request. Never install hundreds of MB of ML libraries into the Next.js image.
- `compose.public.yaml` (optional): integration with reverse proxy and HTTPS. Do not bind the web container directly to public network by default; no public DB, worker, artifact bucket or debug ports.
- `compose.gpu-rocm.yaml`: **future optional** profile. Not required before Nov 5. ROCm verification is independent of CUDA verification.
- A Dockerfile per independently deployed service; multistage builds, healthchecks, explicit service ports, volumes and restart policy. Use non-root users when feasible.
- Support Windows + WSL2 + Docker Desktop as a possible NVIDIA local host, and native Linux Docker as another. Document host driver/Container Toolkit compatibility separately. Do not assume the agent has GPU/Docker available.
- Support environment-based secret injection. Commit only `.env.example`, never `.env`.
- Backup: PostgreSQL logical dump and restore, encrypted off-host copy for real use; manifests for artifact references and revision migrations. `docker compose down -v` is destructive: clearly warn in docs.

### Initial networking assumptions

- Operator has a PPPoE fixed public IP (per user), DuckDNS, already uses Tailscale and hosts other services. Do not presume this app owns 80/443 or the public IP's reverse proxy.
- Default local profile: `localhost` (optionally LAN/Tailscale), with authentication.
- Public HTTPS: attach a hostname (e.g. user-provided DuckDNS subdomain) to an **existing** reverse proxy, not an arbitrary hardcoded domain. Route by host name to `web` internal port; certificate/HTTPS termination owned by proxy.
- Existing scripts that maintain PPPoE are out of scope. Do not modify Windows networking, router config, or existing hosted projects.
- Use trustworthy reverse-proxy header handling and documented `trusted origin` config, secure cookies, CSRF defenses, rate limits and identity checks. Never expose `/admin`, job pull APIs, model/artifact paths anonymously.
- If public traffic is enabled, confirm port forwarding, provider routing/firewall, TLS issuance and conflicting ports via manual checklist before launch.

### Future deployment options (non-binding)

A VM or VPS with Docker/Compose (AWS Lightsail/EC2, Azure VM, Google Compute Engine, Hetzner, DigitalOcean) is the closest migration target. Cloud Run/Azure Container Apps/App Runner are alternatives for the stateless web service but require separately hosted durable PostgreSQL/storage and background worker support. Avoid provider-specific SDKs in domain packages. The expected private-friends deployment is local-first, **not** costless public cloud by default.

---

## 3. Repository structure and package contracts

```text
chordflow/
  apps/
    web/                     # Next App Router; accessible components and API routes
  packages/
    chart-schema/            # Zod schemas, TS types, JSON schema export, fixtures
    music-theory/            # pure deterministic musical transformations
    chordpro/                # bounded importer/exporter and internal AST
    guitar-voicings/         # validated voicings, recommendation, guitar geometry
    ui/                      # optional reusable presentation components
  services/
    ai-worker/               # Python CPU contract runner + optional ML adapters
  fixtures/
    charts/                  # invented public-domain-like synthetic chord/lyric data
    contracts/               # API good/bad payloads, API snapshots
    ai/                      # synthetic chord timelines and lyrics alignments
  deploy/
    compose.gpu-nvidia.yaml
    compose.public.yaml
    # compose.yaml may live at repo root
  docs/
    architecture.md
    schema-decisions.md
    api-contract.md
    local-deployment.md
    security-and-rights.md
    testing.md
    agent-handoff.md
  .github/workflows/
  .env.example
  compose.yaml
  SPEC.md
  README.md
  AGENTS.md
```

**Dependency rule:** `chart-schema` must not import UI, database or Python. `music-theory` depends only on pure TS libraries (e.g., modular MIT-licensed Tonal packages). `chordpro` may depend on `chart-schema` and `music-theory` but must not depend on Next.js or database. `guitar-voicings` depends on pure music types and has no browser or backend requirement. `apps/web` consumes these packages. Python consumes the **published JSON Schema / OpenAPI contract**, not generated TS internals.

**OSS policy:** target `MIT` for chordflow application code (pending repository LICENSE creation). Audit direct/transitive dependencies' licenses and NOTICE requirements before acceptance. No GPL-origin code copied into this repository. ChordSheetJS can inform functional requirements/reference behavior independently, but is **not** a package dependency. Tonal.js (MIT) is permitted subject to actual dependency/version audit.

---

## 4. Data/domain model (mandatory before UI/AI feature code)

### Definitions and relationships

1. **Artist**: stable identity and alias names. Singing artist need not equal composer/lyricist.
2. **Work**: composition/song identity (title, alternate names, credits, language, external IDs). Not synonymous with audio.
3. **Recording**: a particular performed/recorded version of a Work; credited artist(s), `studio`/`live`/`cover`/`acoustic`/`unknown`, duration, external source IDs, recording metadata. Multiple links can identify the same Recording only on sufficient evidence.
4. **Arrangement**: playable chord/harmony editorial arrangement of a Work (e.g., original, simplified, capo-friendly). Independent of exact audio timing. One Arrangement may be compatible with many Recordings; one Recording may support many Arrangements.
5. **ArrangementRecordingCompatibility**: join entity recording↔arrangement, provenance (`exact_audio_match` / `human_verified` / `suggested` / `unknown`), optional recorded reference key and transposition mapping. `suggested` is **not** verified.
6. **ChartRevision**: immutable published/draft document revision for an Arrangement. Edits append revisions; publishing updates pointer transactionally. Do not overwrite history.
7. **RecordingSync**: an **optional, recording-specific** alignment between a Recording and a particular ChartRevision: lyric/grapheme timing, chord timing, section offsets, confidence, gaps. This entity is vital: **do not put recording-specific absolute timestamps into the canonical reusable ChartRevision**.
8. **SourceReference**: platform, source identifier/URL, metadata, acquired-at, source permission status and permitted uses. Separates discovery links from analyzable audio.
9. **AnalysisJob** and **AnalysisArtifact**: reproducible pipeline operation, versioned intermediate output and source lineage. Do not confuse an internal analysis with a public chart.
10. **GuitarVoicing**: reusable playable fingering + tuning + canonical chord and validity checks.
11. **ArrangementVoicingPreference**: default fingering policy, optionally overridden for chord occurrences/sections.
12. **User / Membership / Favorite / UserChartPreference**: invited account and per-user capo/display/voicing/offline metadata. Viewer overrides do not mutate canonical charts.
13. **ContentRights / Provenance**: distinct software license vs lyrics/audio/chart redistribution permissions and visibility.

### Primary database constraints and indexing

- IDs: opaque stable UUID/ULID (not display names); use `created_at`, `updated_at` timestamps with UTC persistence.
- Work normalization: retain original Unicode title and normalized search forms/aliases. Search with PostgreSQL full-text/trigram/case-insensitive matching as appropriate, including Traditional/Simplified aliases; never rely exclusively on title for identity.
- Uniqueness: `source(platform, platform_source_id)` where known; immutable chart revision number unique per arrangement; digest+processor-config fingerprint unique for cache artifacts when sufficient.
- External recording IDs (e.g., verified MusicBrainz ID) may improve match but are optional. A title/artist match is only a candidate, never absolute proof of same recording.
- `work_id` on Arrangement; `work_id` on Recording; compatible mappings must reference the same Work unless an explicitly reviewed exception exists.
- `publishedRevisionId` must refer to its own Arrangement, must be in `published` state, and must pass required rights/review checks; enforce transactional invariants at service layer and relevant DB constraints.
- Every job has owner, source, idempotency key, status, heartbeat/lease, timestamps, retry metadata and internal error code. Source URLs are untrusted.
- Store chart as validated versioned JSONB. High-value searchable metadata remains normalized relational columns. Avoid a monolithic JSONB-only database.
- Original audio and large model outputs reside in authorized artifact storage with lifecycle/retention settings, not in PostgreSQL large blobs. Metadata stays after permissible artifact deletion.

### Canonical Chart Document v1 — **illustrative valid fixture**

```json
{
  "schemaVersion": "1.0.0",
  "chartRevisionId": "rev_demo_001",
  "arrangementId": "arr_demo_001",
  "revision": 1,
  "language": "zh-TW",
  "title": "示範歌曲（虛構）",
  "concertKey": "C",
  "timeSignature": "4/4",
  "defaultBpm": null,
  "instrument": {
    "type": "guitar",
    "tuning": ["E2", "A2", "D3", "G3", "B3", "E4"]
  },
  "sections": [
    {
      "id": "sec_intro_1",
      "kind": "intro",
      "lines": [
        {
          "id": "line_intro_1",
          "text": "",
          "chords": [{"id": "ch_intro_1", "symbol": "C", "anchor": null}]
        }
      ]
    },
    {
      "id": "sec_verse_1",
      "kind": "verse",
      "lines": [
        {
          "id": "line_verse_1",
          "text": "微風帶我向前走",
          "chords": [
            {"id": "ch_verse_1", "symbol": "C", "anchor": {"graphemeOffset": 0}},
            {"id": "ch_verse_2", "symbol": "G/B", "anchor": {"graphemeOffset": 4}}
          ]
        }
      ]
    }
  ],
  "voicingPolicy": {
    "mode": "recommended",
    "defaultDifficulty": "easy",
    "occurrenceOverrides": {}
  },
  "importMetadata": {
    "format": "native",
    "unhandledDirectives": []
  }
}
```

**Schema requirements:** Zod validation plus generated JSON Schema; `schemaVersion` semver; strict declared fields with explicitly namespaced extensions when needed; stable section/line/chord occurrence IDs; nonempty valid `symbol` on chord events; chord IDs unique within chart; valid Unicode NFC text. Chord anchor `graphemeOffset` indexes **Unicode grapheme clusters** of the line's normalized text, not UTF-16 code units, bytes or Python code points. Offset 0 means before first grapheme; value equal to length means after last; `anchor: null` is permitted for instrumental/time-only content. Validate bounds. Do not invent lyric timing when none exists.

**Text ownership:** canonical lyric line text has a single source of truth. Word/syllable tokens are a separate derived alignment artifact; updates require referencing the ChartRevision they were aligned to. For passages where timing is uncertain, keep valid lyric/chord document even without times.

### RecordingSync document (separate fixture/schema)

```json
{
  "schemaVersion": "1.0.0",
  "recordingId": "rec_demo_001",
  "chartRevisionId": "rev_demo_001",
  "timebase": "recording_start_ms",
  "offsetMs": 0,
  "alignedChords": [
    {"chordOccurrenceId": "ch_verse_1", "startMs": 12000, "endMs": 13700, "status": "high_confidence"},
    {"chordOccurrenceId": "ch_verse_2", "startMs": 13700, "endMs": 15100, "status": "uncertain"}
  ],
  "alignedLyrics": [
    {"lineId": "line_verse_1", "fromGrapheme": 0, "toGrapheme": 2, "startMs": 12040, "endMs": 12800, "status": "high_confidence"}
  ],
  "unmatchedIntervals": [{"startMs": 0, "endMs": 11800, "reason": "instrumental_or_unknown"}]
}
```

Validate nonnegative intervals, `endMs >= startMs`, optional recording duration bounds, referenced IDs and track-specific monotonicity. Intervals may overlap where valid musically; do **not** enforce a single global sequence across distinct instruments. Model `uncertain`/`unaligned` explicitly; any numeric confidence is model-specific and is not claimed to be calibrated unless tested.

### Document/view invariants

- Change of capo, display mode or user-selected transpose changes **ViewerState** and display output, **not** ChartRevision and not RecordingSync source truth.
- A common Arrangement used for two recordings cannot share the same timed `RecordingSync` unless the recordings are confirmed exact audio equivalents and the offsets are intentionally remapped.
- A ChartRevision can be rendered without lyrics timing, recording, AI artifacts, DB, authentication or network access (after fixture is loaded).
- Historical revisions remain accessible to admins. Missing/invalid linked assets degrade gracefully.

---

## 5. Music theory engine (`packages/music-theory`)

### Types and operations

Expose pure functions and serializable results. Separate parsing of `ChordSymbol` from voicing. Chord AST includes spelled root (`letter`, accidental), quality/type, extensions/alterations, optional slash bass and original display spelling; unknown or ambiguous symbols must produce typed errors/unsupported states rather than silently mutating them.

Functions: `parseChord`, `formatChord`, `transposeChord`, `chooseEnharmonicSpelling`, `getChordTones`, `concertToShape`, `shapeToConcert`, `renderRomanNumeral`, `renderNashvilleNumber`, `transposeChartDisplay` (pure transformation), `getScaleContext`; contracts subject to test-first refinement.

**Pitch vs notation:** sound pitch class and written spelling are separate. Transposition moves sound pitch in 12-tone equal temperament while musical context chooses spelling. Handle Cb, B#, Fb, E#, accidentals, diminished/augmented, majors/sevenths, sus/add, altered chords, enharmonic equivalents and slash bass. Five-circle/key conventions inform spelling, not a replacement for pitch arithmetic. Do not preserve impossible target spellings automatically if key context requires a different enharmonic.

**Capo semantics:**

- Canonical chart chord is the **sounding/concert** harmony reference. Additional `transposeSemitones` changes target sounding pitch.
- `capoFret = c` means displayed playable guitar shape is the concert chord shifted **down** `c` semitones (when capo is attached), while actual pitch remains the chosen concert pitch.
- Provide user option in UI to keep **shape** constant and change sounding pitch, labeled explicitly; never mix both controls ambiguously.
- Capo valid default `[0, 12]` for theory tests; UI defaults to useful subset `[0,7]`, adjustable later.
- For one song, capo suggestion compares candidate full-sequence voicing difficulty and user comfort preferences, not a random number. **No automatic capo recommendation as 'optimal' before voicing validation.**

**Nashville / Roman:** respect root relative to selected major/minor tonic and accidental notation (`bVII`, `#iv°`, etc. as context-appropriate); do not confuse quality with scale degree. If key is unknown, display a clear unavailable state or ask user to select key.

### Required exact tests

| Scenario | Expected behavior |
|---|---|
| `C` +2 semitones | `D` |
| `G/B` +2 semitones | `A/C#` |
| `F#m7b5` +2 semitones | `G#m7b5` |
| `Bbmaj7` +2 semitones | `Cmaj7` |
| `C/E` +2 semitones | `D/F#` |
| C major `Am` | vi in Roman mode |
| Concert D with capo 2 | C guitar shape |
| C shape with capo 2 | sounding D |
| malformed chord (`H#??`) | typed unsupported error; no crash |
| transposition -12 | same sounding pitch and sane spelling |
| enharmonic in sharp/flat keys | contextual notation consistent with selected key |
| chart contains slash chord | root and bass move together; voicing revalidated |

Use parameterized examples and property-based tests where practical (e.g., transpose +n then -n preserves pitch semantics; parse/format round-trip preserves supported semantic representation). Do not require exact spelling identity for every round trip without specified key preference.

---

## 6. ChordPro importer/exporter (`packages/chordpro`)

Do **not** take GPL ChordSheetJS as dependency. Define an own small ChordPro subset compatible with core syntax, with documented supported directives:

- `{title:}`, `{subtitle:}`, `{artist:}`, `{key:}`, `{capo:}`, `{tempo:}`, `{time:}` (map as appropriate without making viewer preference canonical)
- `{start_of_verse}`, `{end_of_verse}`, `{start_of_chorus}`, `{end_of_chorus}` (aliases as tests specify)
- Literal lyric lines, blank lines, `[...]` inline chord locations, multiple chords per line, leading/trailing chord marks and chord-only instrumental lines.
- Escaping behavior for literal brackets and braces must be defined and tested. Strip/normalize line endings carefully and preserve Unicode lyric text.
- Unknown directives: report with line number, preserve in `importMetadata.unhandledDirectives` when possible, and do **not** silently throw away lyrics or corrupt content. Reject inputs known to be ambiguous or unsafe rather than trying to guess.
- Export to readable ChordPro with structural section markers; ChordPro may lose high-level AI provenance, sync and per-player voicing data—**document this explicitly**.

Importer AST should be independent of rendering components. Unit tests: Traditional Chinese lyrics; Western words with spaces and apostrophes; no chords; repeated chords; instrumental; unknown directives; malformed tags; CRLF; empty docs; emoji/combining characters; giant/invalid input length limits; round-trip equivalence on **supported** subset.

---

## 7. Guitar voicings and SVG diagrams (`packages/guitar-voicings`)

### Representation

- Guitar tuning is part of every resolution context; standard tuning default `E2 A2 D3 G3 B3 E4` low-to-high.
- `frets: [number, number, number, number, number, number]` from low E to high E (`-1` muted, `0` open, positive integer fret), `fingers` similarly nullable, `barres` with fret/string range/finger, `baseFret`, stable ID, `tags`, source, optional editorial difficulty estimate.
- Chord symbol and fingering are **different** objects. A single symbol has many valid fingerings. Diagram is generated at runtime from validated fingering data; **do not store SVG image files per chord in DB**.
- Validation checks notes produced under specific tuning, chord required tones, allowed omissions, slash-bass requirement **lowest sounding string**, physical plausibility, reasonable fret span, and correct open/muted strings. Some advanced chord symbol may not be fully realizable; return `unsupported` with clear reason.
- Provide curated common guitar shapes first, plus optional algorithmic candidate generation for exotic chords in later milestones.
- Occurrence override can select a specific fingering for one chorus/line; arrangement-level defaults select one recommended fingering per chord class; user profile can override for just this line, current arrangement, or preferred global default.

### Selection policy

`curated valid candidates → difficulty/position/transition scoring → ranked suggestions → user override`.

Scoring (configurable): harmonic correctness is a **hard constraint**; then barre complexity, finger stretch, high fret penalty, muted/omitted string considerations, previous/next chord transition, remaining fingers, capo and user's difficulty preferences. Avoid claiming model inferred **original guitar fingering** from audio.

### Required fixture cases

- C = `x32010` and `x35553` (valid alternate shapes).
- G/B requires B as lowest sounding pitch; reject candidates with an unintended sounding low E.
- F = full `133211` and easy `xx3211` with appropriate labels.
- Cadd9 = `x32033`.
- F#m7b5, inversions, capo and nonstandard tuning: validate rather than fabricate; curated/generated candidates only if actually playable.
- SVG geometry tests verify all 6 strings, fret count/positions, label readability, barres, X/open symbols and high-position `baseFret`; no `dangerouslySetInnerHTML` with untrusted chord text.

---

## 8. Viewer UX and performance requirements

### Information architecture

- Landing: input **song title / artist / source URL**; do not automatically start GPU job based only on an unverified URL.
- Search results: clearly show Work, Recording (studio/live/cover), Arrangement (original/simplified), verified/suggested compatibility and whether chart exists. Primary CTA opens available chart immediately.
- Chart page: title/artist/version, key, capo, transpose ±, displayed shape vs sounding pitch, Nashville/Roman toggle, font size, continuous/page modes, autoscroll controls, diagram drawer/popover, offline-save action.
- Private invited-user login, favorites, recent charts and explicit offline library; admin: basic import, revision review/publish and job status.
- Source/rights labels and link to external embedded player where permitted. Never auto-embed hidden players for analysis.

### Rendering and responsive behavior

- Each lyric line is a list of anchored chord-and-lyric segments rendered as a coherent line block. Do **not** align using literal spaces or assume monospace font. Handle labels wider than adjacent segments.
- Exact grapheme anchor semantics under Unicode, English spaces, Chinese characters, emoji, combining accents and copy/paste edits.
- Continuous view: vertically readable, smooth autoscroll with speed slider, pause/resume, manual scroll overrides and keyboard shortcuts; prevent autoscroll from fighting user interaction.
- Page/column mode: for tablets/landscape, predictable left-to-right reading order and explicit page/column navigation; **not** a simple two-column CSS layout with confusing continuous scroll order.
- Accessibility: semantic controls and headings, touch-friendly targets, keyboard navigation, prefers-reduced-motion respected, sufficient contrast, labels for SVG diagrams and status.
- Dark/light themes, portrait/landscape, 320px–desktop viewports; no horizontal overflow or clipped chords. Lazy render very long documents if necessary, preserving anchors and scroll state.
- Embedded music playback optional; if source is YouTube, use official authorized embedded player for playback, not an audio extraction workaround.

### UX acceptance tests

- E2E loads fixture chart, transposes a slash chord, changes capo, toggles number mode and confirms underlying chart remains unchanged.
- Visual regression for Chinese lines containing adjacent long chord names, English spacing, line break, 320px portrait, tablet landscape and 2-column mode.
- Autoscroll stops on manual interaction and respects reduced motion.
- Offline saved chart remains usable after simulated network loss; invalid cache schema is rejected with a recoverable notice.
- Without AI worker/db, fixture-only app can still be opened and interacted with.

---

## 9. Catalog search, identity matching and caching

### Search flow

1. Normalize user query carefully (case, whitespace, punctuation and known alias mappings). Return candidate **Works**, **Recordings** and **Arrangements**; retain the original names.
2. If known source URL, parse only allowlisted supported providers and retrieve permitted **metadata**. Canonical platform+ID is used for source lookup. Unknown URL is **not fetched**.
3. Reuse published ChartRevision for the selected Recording/Arrangement mapping when confirmed. Show suggested same-Work arrangements as **suggestions**, not identical recordings.
4. If no chart: show available authorized processing options and `generation_available` state. Users must not get a false promise of auto-downloading from any URL.
5. User with permission may request an AI generation job for an authorized, analyzable source. Deduplicate simultaneous equivalent requests.

### Matching tiers

- Exact platform/source ID → same source reference only (link may change content; review when conflicting).
- Exact same audio digest or validated fingerprint → potentially same Recording; handle different trimming, intros and offsets.
- Same title/artist/work → candidate only; cover and live versions may have changed key, harmony, repeats and timing.
- Cross-recording reuse of Arrangement requires explicit compatibility status; playback sync never copied without timing verification.

### Layered analysis cache

Key each derived artifact by **input fingerprint + processor/model ID/version + configuration hash + schema version**. Distinguish `source_metadata`, `audio_preprocess`, `separated_stems`, `chord_timeline`, `asr_transcript`, `aligned_lyrics`, `fusion_draft`. A change to lyrics should invalidate alignment and fusion, **not** chord recognition or stems. A model change should only invalidate that branch and dependents. TTL and rights retention may force deletion of audio even if chart metadata remains.

### Search acceptance

- Duplicate request for one known published chart serves existing revision without creating jobs.
- Different live recording with identical title/artist is distinguishable and does not reuse timing by accident.
- Same Work with two Recordings can reference one compatible Arrangement with independent `RecordingSync` tracks.
- Source identity conflict is surfaced rather than silently merged.

---

## 10. REST API / contract-first specification

Use route prefix `/api/v1`. Choose a single consistent envelope and implement it across routes, with OpenAPI schema checked in. Example:

```json
{
  "data": {"id": "arr_demo_001"},
  "meta": {"requestId": "req_demo", "schemaVersion": "1.0.0"}
}
```

Error:

```json
{
  "error": {
    "code": "CHART_NOT_FOUND",
    "message": "Chart was not found",
    "details": null,
    "requestId": "req_demo"
  }
}
```

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/api/v1/health` | GET | optional | non-sensitive liveness; no secrets |
| `/api/v1/search?q=...` | GET | scoped | Works/Recordings/Arrangements + paging, stable IDs |
| `/api/v1/works/{id}` | GET | scoped | Work metadata and versions |
| `/api/v1/recordings/{id}` | GET | scoped | Recording and arrangement mappings |
| `/api/v1/arrangements/{id}` | GET | scoped | arrangement summary and published revision pointer |
| `/api/v1/arrangements/{id}/revisions/{rev}` | GET | scoped | canonical Chart Document |
| `/api/v1/recordings/{id}/sync?revisionId=...` | GET | scoped | optional RecordingSync |
| `/api/v1/chordpro/import` | POST | member/admin | bounded parser and preview only; persist via explicit review action |
| `/api/v1/generation-jobs` | POST | member + quota | validate source/permission, create or reuse job |
| `/api/v1/generation-jobs/{id}` | GET | owner/admin | status, limited progress, error and draft IDs |
| `/api/v1/generation-jobs/{id}/result` | GET | owner/admin | draft result if available |
| `/api/v1/arrangements/{id}/revisions` | POST | editor/admin | validates chart and creates new draft revision |
| `/api/v1/arrangements/{id}/publish` | POST | admin | rights/review gated, transactional publish |
| `/api/v1/worker/jobs/claim` | POST | worker credential | atomically lease next eligible job |
| `/api/v1/worker/jobs/{id}/heartbeat` | POST | worker credential | renew lease/report progress |
| `/api/v1/worker/jobs/{id}/complete` | POST | worker credential | validate artifact manifest + idempotent completion |
| `/api/v1/worker/jobs/{id}/fail` | POST | worker credential | retryability, typed error |

API details should include pagination/cursors, exact status/error codes, auth roles, input size limits, `409` concurrency conflicts, `422` semantic validation, `429` limits and request IDs. Generate shared OpenAPI JSON and fixtures that **Python Pydantic and TS Zod both validate**. No `localhost:8000` calls from browser as a requirement; browser communicates only with app API.

### User-facing job status vs internal status

External: `not_available`, `queued`, `waiting_for_worker`, `processing`, `needs_review`, `completed`, `failed`, `cancelled`.

Internal: `created → validated → queued → leased/running → draft_ready → needs_review → published` with cancellation and retryable/terminal failure edges. Publishing is **not** automatically equivalent to a model completing analysis. Implement as explicit state transitions with tests, not arbitrary strings.

### Idempotency and worker safety

- `POST generation-jobs`: normalized, authenticated submission + user-scoped idempotency key and deduped equivalent source/config when permitted. DB unique constraints/transactions protect against simultaneous requests.
- Worker claim: transactional lease with short expiration, owner and attempt count. Heartbeats extend valid leases. Expired jobs can requeue; repeated `complete` must return same outcome rather than create duplicate revisions.
- Worker authentication must use separate rotated secret/token or preferably service credentials, not user cookie. Never log credentials or original private song URL query secrets.
- Job errors are typed (`SOURCE_NOT_AUTHORIZED`, `AUDIO_NOT_AVAILABLE`, `ALIGNMENT_LOW_CONFIDENCE`, `MODEL_UNAVAILABLE`, `ARTIFACT_VALIDATION_FAILED`, etc.), with sanitized client messages.

---

## 11. AI pipeline: workflow, rights and quality (implementation contract)

### Input permissions and external platform links

Provide `SourceProvider` with separate capabilities:

- `resolveMetadata(urlOrQuery)`: title/artist/version/reference/authorized embed URL, using compliant APIs or user-provided metadata.
- `canAnalyze(source, principal)`: proven allowed use, available authorized media bytes/source, retention constraints.
- `obtainAuthorizedAudio(source)`: only where user rights/platform terms permit. User-supplied original audio or linked authorized owned storage is a valid provider.
- YouTube/other public URL **metadata + official embed** is allowed only consistent with provider policies. A YouTube URL must **not** automatically invoke `yt-dlp` or be construed as download authorization. No scraping of protected full lyrics into a shared public catalog without rights.
- Provider adapter may support approved licensed media connectors in the future, with legal/policy review and optional flags. Do not ship an unauthorized downloading path by default.

### Stages and intermediate artifacts

1. `resolve_source` / `check_rights` / `dedupe`
2. `decode_and_probe_audio`: validate codec, size, length, sample rate, channels; establish immutable timebase and fingerprint.
3. Parallel branches as resources permit:
   - **Chord:** original mix chroma/bass/key/beat baseline → optional instrumental separation → BTC/other ACR adapter with per-frame chord candidates and confidence → smoothing / boundary estimates.
   - **Lyrics:** licensed/reference subtitle or user-provided text; vocal separator if useful → singing-aware ASR candidate → normalize/tokenize → mismatch-tolerant sequence alignment → local forced alignment for reliable sections.
4. `fusion`: independently preserve chord and lyric timelines; build graph of grapheme chord anchors and unanchored instrumental/time-only events. Never force chord changes to next lyric syllable when they occur mid-sustain.
5. `rule_validator`: chord quality, probable key, beat consistency, bass evidence, suspicious 0.2s flicker, lyric coverage, repeated section matching, source rights.
6. `llm_reviewer` (optional): provide **structured correction suggestions with rationale/evidence**, never overwrite acoustic raw output unconditionally, never mark uncertain parts as verified.
7. `draft_producer`: versioned ChartDocument + optional RecordingSync + artifact manifest; **draft only**.
8. `review`: admin inspects highlighted uncertain spans and selects keep/edit/reject/publish, preserving history.

### Lyric alignment behavior

- Reference lyrics and performance can differ: live ad-libs, omitted/repeated chorus, singing elongation, long instrumental gaps and backing vocals.
- First obtain a performance-side transcript/segments to check against reference words; do not blindly forced-align the full reference text.
- Sequence alignment with insertion/deletion/substitution penalties, plus repeated-section disambiguation using **time, musical structure and order**. Use section-level anchors first, then word/grapheme alignment where supported.
- On low confidence: keep reference lyric text unaligned, retain multiple section candidates if ambiguous, mark passage `uncertain` / `unaligned`; provide manual correction. Instrumentals are explicit no-lyric sections.
- For Chinese, define grapheme/character-level display anchors; linguistic word boundaries and aligner tokens can differ. Keep explicit character-to-token mapping. WhisperX/Wav2Vec2 language availability is adapter-specific, not guaranteed across languages.
- Store aligner version, ASR model/version, original vs normalized lyric revisions, confidence source and unmatched intervals.

### Model strategy

- Baseline compare chord recognition on original mix vs instrumental, since separation artifacts may degrade ACR. Demucs is a replaceable source separator, not mandatory on every request.
- BTC/ACR label vocab may omit add9/complex inversions; treat model outputs as candidate harmony, not automatically complete guitar chords.
- Distinguish sound harmony estimation and **playable guitar arrangement**. Complex chords can be simplified into a separate editorial Arrangement, not overwrite source harmonies.
- GPU work is asynchronous and single-concurrency by default on RTX 5090 until VRAM/perf tests justify parallel execution. Support CPU-only synthetic fixture worker.
- Optional LLM Provider `disabled | vertex_ai | other` with feature flag, per-job maximum calls/tokens, monthly soft budget + application hard call cutoff. Cloud account budget alarms alone do **not** guarantee spending stops.
- AMD Developer Cloud/ROCm is an optional later experiment, **not** a launch dependency. Do not redeem/activate expiring credit automatically.

### Evaluation

Maintain a small licensed, manually checked benchmark suite (not necessarily committed raw audio) with original/live/cover, Mandarin/English, instrumental gaps, repeat choruses, abrupt chord changes. Measure chord symbol accuracy (vocabulary documented), chord boundary tolerance, lyric match coverage, timing error, uncertainty calibration and **human revision effort**. Never invent numeric accuracy targets before baseline measurement; track them in a separate research report. Golden fixture acceptance tests are fixed regardless of model quality.

---

## 12. Authentication, privacy, security and rights

- Private initial deployment; optional guest/demo mode must expose only synthetic/licensed demo content. Invitation-only accounts for friends. Define `visitor`, `member`, `admin` roles; authenticated owners can see private drafts.
- Use a maintained authentication solution compatible with Next App Router and PostgreSQL, with secure password hashing (Argon2id or comparable), secure HTTP-only same-site cookies, session expiration, CSRF defenses and authorization checks **server-side**. Avoid building custom cryptography. Bootstrap first admin through an explicit local CLI/one-time setup flow, not default shared passwords.
- Central per-user/API/IP rate limiting; AI job quotas (admin overrides), global GPU concurrency limits, input size and duration limits and signed artifact access. Protect all worker routes with dedicated credentials.
- URL handling: allowlist metadata providers; reject internal IPs, loopback, link-local, local DNS rebinding targets and disallowed redirect chains; strictly separate browsing/external link discovery from media retrieval. No open proxy endpoints or arbitrary server-side fetch from user input.
- HTML output must escape lyrics/chord strings; parse ChordPro as data, not HTML; review SVG injection, CSP, upload MIME detection and content size limits.
- Store attribution and independent content permissions for audio, lyrics and charts. Software MIT license does not grant rights to third-party songs. `private/shared/public` visibility is **distinct** from redistribution right. Fail closed when rights are unknown; admin review required to publish content to broader audiences.
- Deletion: allow removing source artifacts and accounts, preserve necessary audit metadata, implement source retention policies and documented backups. Never include copyrighted song catalogs in seeded open-source fixtures.
- Log metadata and sanitized errors, not raw user audio/lyrics or full API tokens. Protect backups with encryption and off-host retention. Public access requires verified TLS and security review.

---

## 13. PWA / offline design

- App shell/assets cached by service worker with versioned cache strategy. **IndexedDB** stores opted-in ChartDocuments, safe metadata, version and per-user reader preferences. `localStorage` only tiny settings, not full catalog.
- Explicit user action “Save offline”. Show saved timestamp, schema version and number of charts; permit removing a saved chart, clearing all and refreshing.
- Auth-protected/private charts require deliberate product behavior: do not leak content across accounts on a shared browser; namespace cache by account or clear private caches on logout; disclose local device storage implication.
- Offline theory/transpose/capo and SVG voicings work entirely client-side. No remote requests needed once resources loaded.
- Migrations: when cached schema is incompatible, attempt known migration or show non-destructive error and refetch when online; never silently render corrupted chart.
- Do **not** make embedded copyrighted audio downloadable for offline playback.

---

## 14. Observability, maintenance and operational budgets

- Structured logging with requestId, jobId, non-sensitive source ID, stage, duration, trace-like correlation. Include retry and error codes, never credentials.
- Health: Web liveness, DB readiness, worker heartbeat age, pending/running/failed jobs, artifact retention status and disk free space. An offline worker should degrade generation functionality, not catalog reads.
- Resource safety: bounded audio duration (configurable), concurrency 1 GPU job initially, CPU process memory/timeout limits, cleanup temp directories, stale lease recovery and max retry attempts.
- Backup/restore runbook with smoke restore from dump; avoid silently wiping database volumes. Migration backward-compatibility or documented downtime required.
- Credits are not operational guarantees. Owner's Google Cloud billing account is upgraded; post-credit usage may charge payment method. Provider-specific quota/budget alert plus **application-enforced call budget** are separate controls. OpenAI API credits reserved for other projects by default; no auto-use. AMD cloud credit optional; never depend on time-limited promo.
- Cloud provider neutrality: external config (`DATABASE_URL`, `APP_BASE_URL`, `LLM_PROVIDER`, `VERTEX_PROJECT_ID`, `GCP_LOCATION`, `WORKER_TOKEN` etc.), no hardcoded region/account/project or private hostname.

---

## 15. Testing strategy and CI gates

### Test layers

1. **Unit (Vitest):** parsing, theory, voicing validity/ranking, chart schema and grapheme offsets; run fully without network or Docker.
2. **Property/golden tests:** transposition invariants, import/export semantic round-trips, cross-language JSON fixture validity, record-version mapping invariants.
3. **Component + browser (Playwright):** lyric/chord positioning, chart controls, keyboard accessibility, responsive and page/continuous reading, saved offline chart.
4. **API contract:** synthetic fixtures against Zod/OpenAPI and Python Pydantic; role/error/paging/job-idempotency tests.
5. **DB integration:** ephemeral PostgreSQL (when container daemon available), run migrations, duplicates and concurrency, transactional publish/lease semantics. CI may use PostgreSQL service without invoking local Docker commands.
6. **Python unit (`pytest`):** CPU-only stages, fake providers/processors, retries, timebase and uncertain alignment logic, artifact schemas.
7. **GPU acceptance (owner's host):** pinned CUDA image smoke test and small legal audio benchmark; never claim passing from Claude GPU-less sandbox.
8. **Deployment smoke:** `docker compose config`, Web/DB health/readiness, mock worker end-to-end, backup/restore. Skip with recorded reason if Docker unavailable in cloud session.

### Required CI jobs

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (deterministic, offline where possible)
- `pnpm build`
- `pnpm exec playwright test` (browser available in CI; document local install)
- `python -m pytest` for CPU-only worker
- license/security checks for dependencies and secret scanning (tools chosen in M0).

No network calls to paid LLM APIs in unit/CI. No massive model weight downloads in CI. If Playwright browser binaries are unavailable in a disposable cloud session, install via documented scripts or report exact skipped suite while retaining CI verification.

### Performance goals (initial engineering targets, to validate by measurement)

- Search and chart load from local DB should feel interactive under modest catalog size; establish p95 benchmarks after implementation instead of promising hard production SLO immediately.
- Viewer scroll should visually remain smooth on current mobile/desktop devices; do not regress with a large chart.
- SVG diagrams should render from cached data with no network request and be accessible.
- AI job page is responsive to user input regardless of running GPU workload.

---

## 16. Milestones, priorities and executable task boundaries

**Important time constraint:** Claude Code Cloud Sessions development credits expire **2026-11-05**. As of **2026-10-23**, there are about 13 calendar days. Prioritize **GPU-free working software** rather than trying to build and evaluate all models in a GPU-less sandbox. Accept clean milestones over unfinished scaffolding.

### M0 — foundation, deterministic toolchain and Docker skeleton (**P0**)

**Tasks:** initialize pnpm workspace / Next App Router with TypeScript strict and zh-TW; Tailwind, formatting, lint, Vitest, Playwright, pytest skeleton; AGENTS.md + README + env example; root Compose with Postgres/web (web may start in demo mode); CI workflows and fixtures. Basic layout shell and demo route.

**Acceptance:** fresh clone can install, test/typecheck/build; `/demo` works with no DB or GPU; Compose configuration valid, DB volume persistent in documented local environment; no secrets committed; GitHub CI configured. **Commit(s):** `chore: bootstrap monorepo`, `ci: establish quality gates`, `chore: add docker base`.

### M1 — Chart schema, domain identity, fixtures (**P0; freeze contracts**)

**Tasks:** Work/Recording/Arrangement/ChartRevision/RecordingSync Zod types + JSON Schema and synthetic valid/invalid fixtures. Domain entity relationships documented; chart grapheme index validator; model cache keys; draft/rights status enums.

**Acceptance:** examples in §4 accepted, invalid anchors/times rejected; relationship and schema version tests; fake in-memory chart repository. **Commit(s):** `feat(schema): chart v1`, `test(schema): exhaustive fixture validation`.

**Gate:** M1 reviewed/frozen before parallel M2–M6 implement schema consumers. Further changes require migration/contract test updates.

### M2 — pure music theory + guitar notation (**P0**)

**Tasks:** chord AST parser, naming, intervals, accidentals/key-aware spelling, transpose, capo semantics, Nashville/Roman mode, explicit unsupported states. Use modular Tonal.js when useful; audit license.

**Acceptance:** all §5 tests; no imports from `apps/web`/Python; deterministic standalone Node tests; no arbitrary regex replacement of raw chord strings. **Commit(s):** separate parser / transpose / capo / number tests and implementation commits.

### M3 — ChordPro import/export (**P0**)

**Tasks:** robust custom ChordPro supported subset importer to canonical chart, exporter, clear errors, preservation of unknown directives where possible.

**Acceptance:** fixture/golden tests in §6, Chinese/English/multibyte positions, semantic round-trip; no GPL dependency. **Commit(s):** parser, exporter, documentation.

### M4 — chord viewer + layout and controls (**P0; central user value**)

**Tasks:** line segment renderer, sections, responsive fonts, transpose/capo/number mode UI, accessible keyboard controls, Chinese text positioning, mock song view.

**Acceptance:** functional full song fixture; Playwright interactions and visual test set; no backend/GPU required; source chart unchanged when controls change. **Commit(s):** layout core, playback controls, tests.

### M5 — SVG voicings + player modes + PWA (**P0**)

**Tasks:** curated common chord fingerings, alternate voicing chooser and SVG, recommendations (basic simple deterministic scoring), continuous autoscroll, paginated/column mode, IndexedDB offline with service worker.

**Acceptance:** §7/§8/§13 tests; uncommon chords show transparent fallback; offline chart works after network simulation; chart fingering changes do not corrupt source. **Commit(s):** voicing engine, renderer, player mode, offline.

### M6 — Postgres catalog, search, accounts and revisions (**P0 / P1**)

**Tasks:** Drizzle schema and migrations, search and catalog routes, fake/realtime Repository adapter, Work/Recording↔Arrangement relationship, revision storage and basic invite/admin operations, source rights visibility. Use secure maintained auth library; no guess at credentials.

**Acceptance:** migration tests, search by artist/version, duplicate source handling, revision immutability, private access enforcement, demo path remains runnable. **Commit(s):** DB/schema, search API, auth, revision publication.

### M7 — durable generation jobs + CPU mock worker (**P1; high value before deadline**)

**Tasks:** job persistence/leases/state-machine/idempotency, worker API/auth, Python Pydantic client, mock processor chain, artifact manifest, draft review UI, fake LLM provider and error/retry handling.

**Acceptance:** from admin “generate demo chart” through queued → claimed → progress → draft → review; duplicate request does not duplicate work; simulate worker offline and retry; all CPU-only. **Commit(s):** job schema, coordinator, mock worker, review UI.

### M8 — local GPU inference (after M0–M7; **P2**)

**Tasks:** owner-local pinned CUDA stack, model adapter, authorized audio, original-vs-separated evaluation, lyric alignment adapters, timebase/artifact persistence, bounded resource management. Validate on RTX 5090; AMD/ROCm later.

**Acceptance:** actual permitted audio benchmark, reproducible model config/version, documented quality/uncertainty, no misrepresentation of failed alignments; CPU mock tests remain passing.

### M9 — quality review and publication improvements (**P2**)

**Tasks:** editor for chord anchors/sections, sync-timeline viewer, LLM structured suggestions through Vertex AI (opt-in), review diff, source attribution/rights audit, voicing-transition ranking improvement.

**Acceptance:** edits create new revision, preserve original machine prediction, review and publish requires permitted content rights, deterministic fallback when LLM disabled.

### Recommended cloud-session execution plan (maximize pre-11/05 impact)

1. **Session A (critical path):** M0 → M1 → review/freeze chart & worker contracts. Include reproducible handoff in Git.
2. **Session B:** M2 theory (independent after M1 types are stable).
3. **Session C:** M3 ChordPro import/export (after M1; merge with M2 only at defined interfaces).
4. **Session D:** M4 responsive Viewer from fixtures (after M1; build early, refine with M2/M3).
5. **Session E:** M5 voicings and PWA (after M1/M2, parallel with M6 where branch isolation possible).
6. **Session F:** M6 database API/auth/revisions (after M1). Include migrations and integration tests.
7. **Session G:** M7 jobs + Python fake worker (after M1 and draft/chart contract freeze). Do not block on M8.
8. **Integration/CI session before credit expiry:** merge conflicts, delete stale scaffolding, ensure clean build/tests, Docker smoke, update docs and list exact deferred GPU/local tasks.

**Parallelization rule:** use dedicated feature branches/worktrees or sequential tasks; no two sessions silently edit the same files; first session commits contract changes before independent sessions consume them. Never cherry-pick half-completed schema modifications without migrations. Main branch should always be buildable.

---

## 17. Session handoff and commit protocol

For **every** Claude Code cloud session:

1. Read `SPEC.md`, `AGENTS.md`, `docs/agent-handoff.md`, `git status`, package scripts and relevant package tests.
2. State target milestone/task and affected directories. Run baseline quality gates or record unavailability.
3. Add failing tests (when appropriate) and implementation in a small bounded batch. Use synthetic fixtures.
4. Run relevant targeted tests and global lint/typecheck; run full CI-equivalent commands before milestone close.
5. Commit with a focused conventional commit message. No secret files, weight files or downloaded media.
6. Update `docs/agent-handoff.md`: what works, exact test command/result, blockers, deferred options, next tasks and relevant commit hashes. If there are deviations from SPEC, document as explicit proposed ADR; do not silently rewrite fundamental assumptions.
7. Return compact completion report to operator. Stop after completed milestone and request next task only if necessary; do not promise future/background work.

### Example kickoff prompt (paste into Claude Code Cloud Session)

> You are the lead implementation agent for chordflow. Read `SPEC.md` fully, then inspect the repository before editing. Execute the next uncompleted milestone in section 16, beginning with M0 if the repository is empty. Preserve strict contract-first, TDD, fixture-only GPU-free development and Docker-first local deployment. Create small focused commits and tests. Do not request credentials, scrape songs, download model weights or depend on CUDA. Run all available checks, document skipped checks honestly and update `docs/agent-handoff.md` with commits, test results, decisions and next tasks. Keep UI zh-TW and API/type identifiers English. Do not attempt M8 unless specifically assigned on the local GPU machine.

---

## 18. Release readiness / verification checklist

### Before first private demo

- [ ] User can open synthetic chart in browser without GPU, auth or database (demo mode).
- [ ] Traditional Chinese lyric chords align correctly on mobile and desktop.
- [ ] Transpose, capo, slash bass and numbering modes pass tests and preserve source chart.
- [ ] At least two valid guitar shapes selectable for a common chord, with recommended labels.
- [ ] Continuous and tablet column/page mode work; readable without automatic audio sync.
- [ ] Explicit offline-save works, cache invalidation tested.
- [ ] Catalog can distinguish different singers' recordings and shared arrangements.
- [ ] Duplicate chart requests reuse existing chart; generated jobs do not block browsing.
- [ ] Local Compose web/db works; backup and migration path documented.
- [ ] Private login required for personal/user-generated data and protected routes.
- [ ] Build, TS unit, browser, contract, Python mock and migration suites reported accurately.
- [ ] Repo has LICENSE, README, AGENTS, `.env.example`, CI and no secrets/copyrighted media.

### Before exposing to public HTTPS

- [ ] Confirm DuckDNS hostname, existing 80/443 ownership and safe reverse proxy integration.
- [ ] HTTPS, secure cookies, robust auth, rate limiting and worker route isolation tested.
- [ ] No unapproved third-party audiovisual downloads, no public reuse of lyrics/charts without rights.
- [ ] Input SSRF and uploaded file validation, quotas, audit logs and artifact retention tested.
- [ ] Backups restored successfully, basic security audit and dependency scans done.
- [ ] Cloud migration documentation tested independently of local GPU.

### Before AI-generated chart promotion

- [ ] Legal authorized input and provenance recorded.
- [ ] Alignment missingness handled (no fake timing/confidence).
- [ ] Machine raw outputs, candidate modifications and editor approvals traceable.
- [ ] Publishing a revised chart leaves old revision untouched.
- [ ] LLM disabled path works; remote provider cost guard configured if enabled.

---

## 19. Decisions, future options and references

### Accepted default decisions

- **Local deployment:** A — private local Docker Compose first; later single-host VPS/VM migration. DuckDNS + fixed IP + optional existing Tailscale/public reverse proxy.
- **Main AI hardware:** owner's RTX 5090 / PyTorch CUDA. GPU work not necessary for early frontend/cloud sessions.
- **Optional cloud GPU:** AMD Instinct Developer Cloud direct access only if chosen later; redemption credit expires quickly and is not a persistent host. No AMD redemption workflow in chordflow.
- **Remote LLM:** opt-in Vertex AI first because operator already uses it elsewhere; **disabled by default** until environment variables and spend controls configured. OpenAI API credits explicitly reserved elsewhere; no auto-consumption.
- **Software license:** MIT provisional, audit dependencies before shipping. **Content license:** per-asset; no automatic right to redistribute third-party audio, lyrics, charts.
- **Source discovery:** public URL may resolve metadata and official playback but is not by itself authorized to provide audio bytes for analysis.
- **Audience:** guitar sing-along players, beginners/intermediate first; complexity optional. “Recommended fingering” not falsely described as original recorded fingering.
- **Development urgency:** available Claude Code Cloud Sessions credits expire 2026-11-05; prioritize verified no-GPU milestones before that date.

### Assumptions requiring config, not blocking questions

- Current host OS not conclusively specified: support Windows + WSL2 and Linux Docker in docs. CI on Linux. Actual NVIDIA runtime verified locally later.
- Existing reverse proxy and hostname unspecified: supply an integration template and checklist, do not change another project's configuration automatically.
- Admin bootstrap/invite transport unspecified: local CLI invite generation initially; paid email/SMS provider not needed.
- Actual Google Cloud billing credit eligibility and expiration per credit type must be read from operator Billing console; **never assume paid billing stops when credits reach zero**.
- Later scale/commercial use requires independent rights, cost, privacy and deployment review. Do not promise freely sublicensable chart data.

### Official reference sources to re-check when implementing

- ChordPro syntax/reference: https://www.chordpro.org/chordpro/chordpro-introduction/
- Tonal.js (MIT; validate installed package): https://github.com/tonaljs/tonal
- Docker Compose profiles: https://docs.docker.com/compose/how-tos/profiles/
- Docker GPU resource allocation: https://docs.docker.com/compose/how-tos/gpu-support/
- AMD Member Perks: https://developer.amd.com/member-perks/
- AMD Developer Cloud terms: https://www.amd.com/en/developer/resources/cloud-access/amd-developer-cloud.html
- Google Cloud Free Trial FAQ: https://cloud.google.com/signup-faqs
- YouTube API Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- Google Cloud Run pricing: https://cloud.google.com/run/pricing
- Azure Container Apps billing: https://learn.microsoft.com/en-us/azure/container-apps/billing
- AWS Lightsail pricing: https://aws.amazon.com/lightsail/pricing/

---

## 20. Final priority statement

**A great chart viewer is the product; AI is an optional expansion mechanism.** The first major deliverable is an independent, container-ready, licensed-code, tested app that loads a synthetic Chordflow Chart JSON document and supports guitar-friendly interaction on phone/tablet/desktop. The second is a shared searchable catalog with properly modeled songs/recordings/arrangements and durable revisions. The third is a safe mockable AI workflow. Real NVIDIA audio inference, optional LLM review and legal external audio acquisition integrations arrive only after these contracts stabilize.
