# Study records and compatibility

The synchronized document is `schemaVersion: 3` containing a `workspace.version: 2`. Existing workspace version 1 and document schema version 2 are read through explicit, idempotent `migrateWorkspace()` and `migrateWorkspaceDocument()` functions in `lib/workspace.js`. New saves and exports use the upgraded version. Older released clients reject schema 3 instead of silently dropping the new collections; update every device before continuing synchronization. Versions later than the supported versions fail closed.

Migration preserves IDs, FSRS schedules, review and recall records, notes, original relationships, safely preserved extension fields, and existing record timestamps. The existing normalized `learning_steps: 0` fallback remains unchanged. New collections start empty: an existing checked free-recall note is not automatically converted into a dated attempt, and historical reviews acquire neither fabricated pre-review context nor a presumed closed-book mode. Migration does not create a viewing, transcription, duration, confidence, or outcome history. Persistence adapters retain the original local state using the existing backup mechanism before committing migration.

## Authoritative collections

All collections are arrays of records with stable `id` values. Collection versions and deletion tombstones live beside the workspace, outside the interface's arrays. Actual activity timestamps are ISO UTC instants. Synchronization `versions` track when the record changed and are not activity dates. `studySettings` defaults calendar grouping to `Asia/Amman` and can store another valid IANA timezone.

| Collection | Source of truth and important fields |
| --- | --- |
| `lecturePlans` | One per lecture: `lectureId`, optional `durationSeconds`, `baselineCompleteCount`, `transcriptionScope` (`none`, `full`, `selected`), `targetRanges`, `transcriptionMethod` (`verbatim`, `own-words`, `memory`). The undated baseline is separate from dated passes and excluded from period analytics. |
| `viewingPasses` | Intentional traversal: `lectureId`, `kind` (`first`, `rewatch`, `targeted`), `status` (`in-progress`, `complete`), `startedAt`, nullable `completedAt`, nullable `completion` (`manual`, `coverage`). Completion requires an explicit time and method. |
| `studySessions` | One sitting: `lectureId`, `occurredAt`, distinct `activities` (`viewing`, `transcription`, `notes`, `memory`, `application`), optional `passId`, source `ranges`, optional `effortMinutes`, `reason`, `note`, `conceptIds`, `cardIds`, `gapIds`. Multiple labels do not multiply the sitting or its optional duration. |
| `transcriptionSegments` | Current effective progress: `lectureId`, `start`, `end`, `status` (`not-started`, `written`, `verified`), `method`, `occurredAt`, `modifiedAt`, optional `sessionId`, `reference`, `note`, local `attachmentId`. Coverage derives from current segments; removal or loss of verification removes its contribution. |
| `concepts` | Lightweight concept: `courseId`, optional `lectureId`, `title`, `tag`. Consistent card tags can connect existing flashcards; optional explicit `card.conceptIds` are validated when present. |
| `gaps` | Observation: `lectureId`, optional `conceptId` and `recallAttemptId`, `text`, `status` (`open`, `addressed`, `rechecked`), `occurredAt`, nullable `addressedAt`, nullable `recheckedAt`, `evidence`. Addressed/rechecked states require their respective dates. |
| `recallAttempts` | Distinct attempt: `lectureId`, optional source `recallId`, `occurredAt`, `body`, `gaps`, explicit `expectedIdeas: [{id,text}]`, optional `confidence`, `confidenceTiming` (`before`, `after`, `none`), linked `studySessionIds`. Subsequent edits retain the attempt ID. |
| `assessments` | Structured manual evidence: `lectureId`, optional `conceptId`, `recallAttemptId`, `expectedIdeaId`, historical `cardId`, `kind` (`recall-idea`, `explanation`, `example`, `application`), `outcome` (`correct`, `partial`, `missing`, `incorrect`, `not-assessed`), `occurredAt`, `note`, optional confidence/timing and `studySessionIds`. Unassessed is separate from failure. |
| `studySettings` | At most one record `{id: "preferences", timezone: "Asia/Amman", dismissedInsightIds: []}`. An empty array uses the default timezone without claiming preferences were explicitly recorded. |
| `media` | Content-addressed card-image metadata: SHA-256 `id`, `mimeType`, `byteLength`, `width`, `height`, `fileName`. Shared media is independent of a single card or lecture. |

Optional relation IDs normalize to an empty string, arrays to empty arrays, confidence/duration to `null`, and optional text to an empty string. Real activity dates are required and never guessed. Required relationships must remain in the same course/lecture. Synchronized JSON contains image/file metadata, IDs or notebook/page labels, never binary data or absolute machine paths. Reference PDFs do not automatically generate manual transcription records. Private image/file synchronization is handled by the file transport separately from workspace JSON.

## Image cards and occlusion

Cards can optionally contain `questionImages` and `answerImages`, arrays of `{mediaId, description}`. A face can have empty text when that face has valid images. Existing text cards acquire no new empty fields during normalization. An optional `occlusion` contains `{mediaId, regions, targetRegionId, hideOthers}`; regions contain `{id, x, y, width, height, label}` with normalized coordinates inside the image. The target must be a member of the region list; valid occlusion supplies content to both faces. Normalization fills missing image descriptions/region labels with empty text and `hideOthers` with `false`.

Image metadata accepts PNG, JPEG and WebP only. IDs are lowercase SHA-256 content hashes; file names are the corresponding hash plus the correct extension. Images are limited to 10 MiB, 20,000 pixels per dimension and 40 million pixels total. Each face supports at most 50 images and an occlusion at most 100 regions. Every card image must reference live metadata. Removing a card or a face image leaves shared metadata intact. A media deletion racing a new referring card produces an explicit reference-group conflict; choosing its deletion also tombstones the affected new card while preserving independent course/lecture edits.

## Review provenance

Original review fields `id`, `cardId`, `rating`, and `at` remain unchanged, and the scheduler is unchanged. Newly captured optional provenance is validated when present:

- `preReview: {state, lastReviewAt, dueAt, scheduledDays, stability, difficulty}` is the scheduler state before answering.
- `association: {courseId, lectureId, conceptIds, tags}`, `snapshotLabels: {courseTitle?, lectureTitle?, cardQuestion?}`, `contentRevision`, and optional `cardCreatedAt` preserve the historical context even when a card is edited, moved, or deleted.
- `practiceMode` is `closed-book`, `open-book`, or `revealed`. Absence means unknown.
- `confidence` is nullable or between 0 and 100, and `confidenceTiming` is `none` or `before-answer`. Optional positive `durationSeconds` is context, not a score.
- `studySessionIds` are explicit links. Historical reviews tolerate missing/deleted association IDs and never acquire guessed method links during migration.
- An optional `operationId` matches the review ID, enabling idempotent retries.

Stored confidence, observed/self-rated outcomes, activity, and scheduler estimates remain separate evidence. No stored aggregate is an independently editable mastery or retention score.

## Saving, deletion and synchronization

`createWorkspaceDocument()` stamps only changed live records, creates tombstones for explicit deletions, and retains prior tombstones. Original interface snapshots that omit the new collections carry them forward. Deleting a course or lecture through that interface cascades to its current study records with tombstones. Deleting optional links such as a pass, concept, or session clears related live links while preserving observations. Removing an expected idea keeps the associated assessment, with its expected-idea link cleared. Review provenance and historical assessment card IDs survive deleted cards.

Three-way merge uses stable IDs across every collection. Independent additions survive; repeated sync does not create copies. Divergent same-record edits expose local and remote alternatives. A parent deletion racing a new child record creates a recoverable dependency-group conflict; choosing deletion also removes related children and prevents stale devices from resurrecting the group. The configured data repository, branch, and path remain authoritative: this schema does not choose or redirect the synchronization destination.

Validation rejects malformed or oversized JSON, reserved field names, invalid timestamps, duplicate IDs, unsupported versions, nonfinite/negative durations, invalid ranges, ranges beyond a known lecture duration, cross-lecture live references, duplicate lecture plans, and invalid timezones. Unknown-duration source ranges remain valid without inventing a percentage. Limits include a 10 MB synchronized document, 500 lecture plans, 10,000 passes, 20,000 sessions/segments/assessments, and 10,000 gaps/attempts, with bounded notes and range arrays.

Synthetic regression coverage lives in `tests/study-schema.test.js` and `tests/media-schema.test.js`. It exercises lossless migration, export/import, defaults, invalid ranges/references, original snapshot preservation, cascades, review provenance, independent additions, repeated merge, image-only/occlusion-only cards, invalid image metadata/regions, and deletion/edit dependency conflicts.
