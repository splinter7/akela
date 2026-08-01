# Akela explainer video design

**Date:** 2026-07-26  
**Status:** Approved for planning  
**Approach:** Stitched hybrid (local motion-graphics hook + real screen capture)

## Goal

Ship a short (~30–45s) product explainer for Akela and embed it near the top of `README.md`, aimed at both PMs/analytics folks and developers evaluating the repo.

## Audience & format

| Decision | Choice |
|---|---|
| Audience | Both: problem hook, then technical demo |
| Length | ~30–45 seconds |
| Style | Hybrid: stylized hook + real CLI/report footage |
| Audio | On-screen captions + light music (no voiceover; readable muted) |
| AI video (Runway) | Out of scope — no Runway access |

## Narrative / shot list

| Time | Visual | Caption |
|------|--------|---------|
| 0–8s | Local motion graphics: analytics “black box” / uncertain event stream → tension | Did your analytics event actually fire? |
| 8–15s | Transition into product: Akela name, journey YAML flash | Akela verifies it in the browser. |
| 15–30s | Real capture: terminal runs journey (`akela` / `npm run track -- run journeys/demo.yaml`) | Define a journey. Run it. |
| 30–40s | Real capture: HTML report opens with **PASS**, `page_view` + `cta_click` | See PASS/FAIL with the events you expected. |
| 40–45s | End card: **Akela** + one-liner | Clone. Run a journey. Open the report. |

Tone: calm, technical, not hype. Captions large enough to read muted.

## Production

1. **Stylized hook (~15s)** — local motion graphics via ffmpeg (and optional still frames): dark title cards, animated captions, simple graphic accents (e.g. waveform / particle / ken-burns stills). Not cinematic generative AI footage.
2. **Screen recording** — real demo: start demo server → run example journey → open `report.html` showing PASS.
3. **Edit** — stitch hook → terminal → report → end card; burn in captions; add royalty-free light music; export H.264 MP4 ~1080p 16:9.
4. **Asset path** — `docs/assets/akela-explainer.mp4`. Use Git LFS only if file size warrants it; otherwise plain commit.

## README

- Add a short **Explainer** section immediately under the opening product blurb (before Quick start).
- Embed so the video renders on github.com (prefer a working raw/release/asset URL over a fragile relative `<video>` tag). Confirm the embedding method after the file is in the repo.

## Out of scope

- Runway / generative AI video
- Voiceover
- Multiple language versions
- YouTube upload (optional later)
- Renaming or changing product behavior

## Verification

1. Video length ~30–45s; captions readable without sound.
2. Demo segment shows real CLI run and PASS report with expected events.
3. File exists at `docs/assets/akela-explainer.mp4`.
4. README Explainer section links/embeds the video and renders on GitHub.
5. Music is clearly royalty-free / appropriately licensed for the repo.

## Risks

- **GitHub embed quirks:** relative video embeds may not play in README; may need raw URL or release asset.
- **Large binary:** MP4 may bloat the repo; mitigate with compression or Git LFS if needed.
- **Screen-recording environment:** demo must be runnable locally to capture authentic footage.
