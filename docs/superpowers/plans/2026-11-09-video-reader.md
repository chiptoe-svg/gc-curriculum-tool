# Video Reader — Plan (draft)

**Status:** draft for the owner's review, 2026-11-09. Not started.

**Goal:** read a course video at the depth its tier asks for, with times attached, instead of storing a caption dump with no times.

**Decided with the owner (2026-11-09):**
- Tiers for videos (the classifier sets them; see STATE.md "File classification on campus"):
  - **background**: a passing reference, news clip, promo or entertainment. Stays as today: one digest of the transcript.
  - **middle**: a substantive teaching video. The full transcript, word for word, split at the video's chapters, or every 2–3 minutes cut at a pause when there are none. Each passage carries its chapter title and start time ("Assigning spot colors · 5:53").
  - **high**: an assignment walkthrough, student work, or a demo of exactly what students produce. The middle treatment plus a description of each sampled frame, placed among the passages by time, so on-screen steps (menus, panels, values) are captured.
- Minute-by-minute summaries were rejected: one minute (~150 words) is finer than a full-read passage (~500 tokens ≈ 2½ minutes), and summaries are not quotable.

**What exists (verified 2026-11-09):**
- The Mac's docling-serve (`127.0.0.1:5001`, our `DOCLING_FALLBACK_URL`) runs rag-core's fork and accepts `.mp4`/`.wav` on `/v1/convert/file/async` with the default pipeline. It returns timed text items (`source[{kind:"track", start_time, end_time}]`) by sending speech to OMLX `whisper-large-v3-turbo`, and cuts long recordings into 30-minute pieces with continuous times. It samples frames (default every 10 s, cap 200) and describes them when the request carries `do_picture_description=true` and `picture_description_api` pointing at RCD `qwen3.6-35b-a3b-fp8` with `chat_template_kwargs.enable_thinking=false`.
  - 11-minute tutorial: about 20 s for the transcript only (2,143 words, 127 items); about 62 s with all 67 frames described.
  - 63-minute lecture: 73 s.
- The campus docling (`DOCLING_URL`) cannot do this, so videos go to `:5001` directly, never through the main-then-fallback order.
- yt-dlp gives the chapter list (`--dump-json`, no download). 9 of the 12 longest course videos have chapters.
- The app's current path (`lib/youtube/fetch-transcript.ts`) joins captions into plain text and drops the times; Whisper (`transcribe-audio.ts`) is the no-captions fallback.

**Constraints (from rag-core):**
1. `/v1/status/poll` can report success when the document failed. Read the status in the `/v1/result` body.
2. The server is a fork, with upstream PRs pending (docling-serve#762, docling-jobkit#286, docling#5267/#5269, docling-serve#763). An upgrade could drop the feature, so keep a caption fallback and a health check.
3. Never write DoclingDocument 1.11.0 (docling ≥2.147) into anything rag-core reads. We consume the server's output only.
4. OMLX is shared (nanoclaw interviewers, voicelab). Send videos one at a time, and run backfills at night.
5. Recordings that show students wait for a consent basis. Instructor-made or public videos only.

**Tasks (to detail with writing-plans after the owner approves this draft):**
1. `lib/youtube/video-reader.ts`: download (yt-dlp, 360p mp4, into a temp dir that is deleted after), read chapters, POST to `:5001` async, poll, check the result body, then group the timed items into passages by chapter (or 2–3 min at a pause gap) with title and start time. High tier adds the frame-description fields, and descriptions slot in by time. Tests use a recorded docling JSON fixture.
2. Wire into ingest: a YouTube row at middle/high is indexed from the reader's passages (one chunk per passage, carrying its start time as metadata); background keeps the digest. On any reader failure, use today's captions/Whisper text, which is the current behavior.
3. Citations: the interview and wiki can show "at 5:53" next to a quote from a video passage.
4. Health check: a daily probe of `:5001` with a 10-second wav. When it fails, video rows fall back to captions and the materials panel says so.
5. Backfill (owner yes, list first): re-read the stored YouTube rows at their new tiers, one at a time, overnight.

**Open for the owner:**
- Whether a video's transcript should be quotable as exact words. Whisper and auto-captions are machine transcriptions, and rag-core labels them "not verbatim". The interview could attribute ("the video explains…") rather than quote.
- Frame descriptions cost about 3× the time. High-tier videos only, as decided, or also middle videos with few chapters?

---

## Owner decisions, 2026-11-09 (answers the two open questions above)

**Quoting video transcripts:** quotes are allowed, always with the timestamp and a "(transcribed)" marker, e.g. *the video, at 5:53 (transcribed): "set the underbase to 80 percent"*. The existing citation check still requires the quote to match the stored transcript. Text from frame descriptions is never put in quotation marks; it is paraphrased as what the video shows ("at 6:10 the video shows the Separations panel with…"). Why: a quote is checkable and the timestamp lets anyone hear it in seconds; an attribution-only rule can't be checked, so the model could misstate a video with nothing to catch it.

**Frame descriptions:** all three tiers sample by scene change, never at the 10-second default.
- **high:** about 2 frames per minute (`frame_sampling_mode=scene_change`, `cuts_per_minute=2.0`).
- **middle:** one frame at each chapter start plus large scene changes, at most about one per 2–3 minutes.
- **background:** none.

Why: tutorials teach on screen (menus, panels, values), and most course videos are middle. But a frame every 10 s gave 67 descriptions (~4,000 words) for 11 minutes, mostly repeats that would crowd out the spoken words in search.

**New first task (before Task 1):** a free check on 5–6 course tutorials. Run both samplings, then have a blind reviewer judge each description: does it add something the transcript lacks, repeat what the transcript or an earlier frame already says, or state something not on screen? If middle-tier frames rarely add anything, drop them and describe frames for high videos only.

## Folded in, 2026-11-09 (owner: "fold in 1-3")

**A. Recover the "inaccessible" YouTube rows.** 16 live rows say `YouTube: <id> (inaccessible)`. Checked today with yt-dlp (metadata only): 10 are public and have captions (3–11 min), so their earlier failure was transient. 6 are private or removed and can't be recovered. The reader's backfill (Task 5) re-tries the 10 through the reader. A row that succeeds gets its title and text and goes through `tierLinkedMaterial`. The 6 stay as they are, and the materials panel says "private or removed".

**B. One transcription route.** `lib/youtube/transcribe-audio.ts` runs `mlx_whisper` locally with `whisper-large-v3-turbo`, the same model OMLX serves, so moving it gains no accuracy. (A claim to the owner earlier today that it would was wrong.) What moving it does gain:
- timestamps (today it returns plain text);
- the 30-minute chunking for long recordings;
- one transcription path to maintain instead of two.

Once the reader works, the no-captions Whisper fallback becomes "download → :5001". Keep `mlx_whisper` as the fallback only while :5001's fork is unmerged upstream; the health check (Task 4) decides which one runs.

**C. Videos the app skips.**
- **Drive videos:** `lib/google-drive/fetch-pdf.ts` records any non-PDF Drive file as "unsupported" (1 live row today). A Drive file whose MIME type is `video/*` goes to the reader instead (download through the same public-export URL).
- **Lecture-capture platforms (Kaltura, Panopto, Mediasite, Vimeo):** no handling exists. yt-dlp supports most of them when the video is public, but Clemson's are usually behind a login. Step 1 is detection only: find these links in course text and list them on the materials panel as "linked lecture recording, not read". Reading them waits for a supported way in (an exported file or a Canvas media API), and for the consent rule when students appear.

## Note, 2026-11-09 (rag-core upgraded :5001 to docling 2.149)

:5001 now returns DoclingDocument 1.11.0 JSON by default; image data is left out unless `image_export_mode=embedded`. The reader (Task 1) reads JSON for the timed items, so it sends `Accept-Docling-Document-Version: 1.10.0`, or its parser and fixture target 1.11 explicitly. It needs no images. The app's existing docling calls are Markdown only and are unaffected.

## Note, 2026-11-10 (the campus Spark docling now reads video)

The campus docling (`DOCLING_URL`, Spark) now runs docling-serve 1.38.2 / docling 2.149.0 and accepts `.mp4` on `/v1/convert/file/async`. On the same 22 MB Photoshop tutorial it returned 2,315 words in 13 s, with 129 timed items (`source[{kind:"track",start_time,end_time}]`) and 67 sampled frames, in DoclingDocument 1.11.0. The Mac's :5001 gave 2,288 words. This replaces "The campus docling cannot do this" above: the reader can send videos to the Spark first and use `:5001` as the fallback, which takes video load off the shared OMLX. Still untested on the Spark: frame descriptions (`do_picture_description` with `picture_description_api`), recordings longer than 30 minutes, and which speech model it runs. Markdown output carries one `<!-- image -->` line per sampled frame, so the reader parses JSON rather than Markdown.

## Note, 2026-11-10 (frame descriptions measured; scene-change sampling now a request option)

- **Spark, frame descriptions:** they work with `do_picture_description=true` and `picture_description_api` pointing at RCD qwen3.6-35b-a3b-fp8. On the 11-minute tutorial, all 67 frames were described in 61 s, but the result was about 5,000 words, much of it repeated menu-bar lists. The `frame_sampling_mode`/`cuts_per_minute` fields were silently ignored: no docling-serve build passed frame settings through.
- **rag-core added request fields on the Mac's :5001** (from about 07:30 ET today; the Spark gets them when it is rebuilt): `video_frame_sampling_mode` (`fixed_interval` | `scene_change`), `video_cuts_per_minute`, `video_frame_interval_seconds`, `video_max_sampled_frames`, `video_scene_change_prominence`, `video_generate_frame_images`. Always send `video_cuts_per_minute` with `scene_change`: without it, a screen recording got 73 frames.
- **Measured on :5001** (scene_change, 2 cuts per minute, Qwen with a tight prompt: "state what is being done on screen: tool, panel, values; no menu bars; a person or title card in under ten words"): 16 frames, 431 words of description against 2,143 transcript words, 22 s in all. Each description names the tool and the values on screen (e.g. "Hue/Saturation… Reds channel… Hue 151"). The figures have not yet been checked against the frames; that is the blind check, still the first task.
- `created_by` reads "not-implemented" for API-described pictures (expected, per rag-core); the reader records the model name from its own request.
- So Task 1 uses these field names and this prompt as its starting point. It sends videos to `:5001` until the Spark has the fields, then to the Spark first.
