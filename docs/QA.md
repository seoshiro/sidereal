# SIDEREAL graphite revision — verification

This document concerns the revised interface, practice guide and persistence behavior. Previous interface reports are not counted as evidence for this revision.

## Visual audit

Actual Chromium PNGs were reviewed separately from functional assertions. The chosen composition uses graphite `#0C0D12`, surface `#171921`, text `#F2F3F7`, secondary `#A7ADBD` and accent `#B9C9FF`. Lyra, Cygnus and Vela use pale blue, rose and sea glass. Fine orbit lines carry musical coordinates; only the selected note is labelled in the sky. A precise cursor and short note pulses follow music. No particle field, decorative gradients or procedural 3D.

Corrections made from real captures: constrain the orbit in both dimensions; fix tablet aspect ratio; remove mobile horizontal overflow caused by an invisible tooltip; enlarge mobile header targets; compact the tablet save control; close export popovers after selection/outside interaction; keep Play/Undo focus; preserve an open note list; keep background controls inert while the mobile sheet updates.

Real screenshots:

- [Desktop 1920 × 1080](screenshots/editor-1920.png), [1440 × 900](screenshots/editor-1440.png), [1366 × 768](screenshots/editor-1366.png), [short laptop 1366 × 600](screenshots/editor-short.png)
- [Phone 390](screenshots/editor-mobile390.png), [phone 360](screenshots/editor-mobile360.png), [phone in Russian](screenshots/editor-mobile390-ru.png), [tablet 768](screenshots/editor-tablet768.png)
- [Mobile note sheet](screenshots/note-mobile.png), [desktop guide](screenshots/tour-desktop.png), [mobile guide](screenshots/tour-mobile.png)
- [Preparation loader](screenshots/loading.png), [reduced-motion mobile loader](screenshots/loading-reduced-mobile.png)
- [200% mobile text](screenshots/text200-mobile.png), [200% focused note sheet](screenshots/text200-panel.png)

## UX audit

The guide uses a separate validated `sidereal.lesson.v2` record. Browser checks compare the original `sidereal.draft.v1` and `sidereal.atlas.v1` strings before/after practice, saved practice, Back, reload, Skip and completion. Shared URL fragments remain intact throughout practice. Playback never starts on entry or reload. Listening mode preserves score, selection and disclosures. Exact parameters and the note list complement drag; dense notes open a chooser. Failed draft writes are visibly distinguished from atlas saving.

## Accessibility audit

Normal control labels are at least 14 px. Measured contrast: secondary on surface **7.81:1**, text on surface **15.82:1**, text on raised surface **14.09:1**, primary control **11.89:1**. Key controls expose names, states and visible focus. M/S tooltips work by hover and focus. DOM order follows orbit → transport → layers → note inspector. Mobile sheets contain focus, make background controls inert and return focus on close. A 200% root text-size pass verifies no horizontal overflow and an unobscured focused field. Reduced motion cancels the cursor/pulse assembly while retaining audio/readout.

## Reproducible checks

`npm test`: **10 passing groups**. Existing v1 validation, deterministic music, 480 coordinate round-trips, scales, mute/solo, hostile/oversized input and Unicode shares; new practice validation, strict draft/atlas isolation and blocked-storage checks.

`npm run build`: strict TypeScript and static Vite build. `src/audio.ts` is byte-for-byte unchanged: SHA-256 `125c1db26c0ffec247f678432145bcae7608b579d3b82d38d6a19f6b4e338946`. `src/model.ts` changes only the palette export; v1 schema, storage keys, presets, timing and share encoding remain compatible.

`scripts/browser-v2.mjs`: first-entry guide; six steps on desktop/mobile; real AudioContext play/pause/resume/stop; preset/live-tempo changes; drag/keyboard; duplicate/limit/history/focus; notes/durations/intensity/tuning/timbres; layer/master mute and solo; multiple atlas entries/reload; malformed/hostile/oversized imports; share output and denied-clipboard fallback; practice interruption/reload/Back/Skip/completion isolation; listening mode; PNG/WAV decoding; maximum 96-note audio export and exact silence when all layers mute; repeated clicks; stopped visual loops and beat-only updates; RU/EN at 360/390/768/1366/1440/1920 and 1366 × 600; 200% text; 70 seconds of bounded playback; unavailable audio/storage/WAV; real module-loading failure and working Retry.

`scripts/interaction-v2.mjs`: actual CDP touch swipe over empty SVG; 44 × 44 mobile primary targets; corrupt draft recovery without overwriting raw data; 200% focused field visibility; reduced-motion loader and real completion.

PNG decodes as **1600 × 1880**; its corner pixel is exactly `[12,13,18,255]`. WAV header is stereo **44.1 kHz PCM16**. Chromium's decoder can resample to its default 48 kHz context; reported decoded values state that rate explicitly. Peak and energy checks are waveform checks, not human listening.

The new local [20-scenario browser receipt](browser-v2-report.json) and [five interaction checks](interaction-v2-report.json) are included. The same **20 browser scenarios and five interaction checks passed on the published site**: [live browser receipt](live-browser-v2-report.json), [live interaction receipt](live-interaction-v2-report.json). No page errors occurred in normal browser scenarios.

The deployed source revision is [`189dbe9`](https://github.com/seoshiro/sidereal/commit/189dbe976d403a2a2d475be49a728a66aa8650cf); its [GitHub Actions build and deploy succeeded](https://github.com/seoshiro/sidereal/actions/runs/38053891275). The [deployment receipt](deployment-v2-report.json) verifies HTTP 200 and exact bytes/SHA-256 for index, favicon, both JavaScript bundles and CSS under `/sidereal/`.

The default exported WAV decoded with peak **0.06511** and RMS **0.01065** across stereo channels. The 96-note test at 80% master volume decoded with peak **0.22169**; all layers muted produced exact zero. This is numeric evidence and does not imply listening quality.

Final screenshots were captured from GitHub Pages. The loading captures hold the actual module request so the real preparation state can be inspected. The later user-requested change adds two seconds after preparation, without fake percentages. A separate screenshot audit caught overlapping layer names at 200% text despite a passing overflow assertion. The corrected layout stacks layers and panel triggers, gives the title its own row, and keeps all text readable.

## Logo return and loading follow-up

`scripts/home-loader-qa.mjs` checks the follow-up independently of the earlier music audit: actual additional loading duration; inert/silent loading and blocked Space shortcut; first-tour logo exit; ordinary editor and disclosure return; Enter/Space keyboard activation; listening return with uninterrupted playback; atlas, dense-picker and clipboard-fallback dialog return; tour data/history restoration; RU/EN names; pending shared URL preservation; real mobile touch in sheet/dialog/listening/tour; reload; reduced motion; immediate load failure and working Retry. Score, draft and atlas are compared before/after as exact data, not only note counts.

The logo is a native button. Its action does not navigate or reload. It closes auxiliary views, scrolls to the editor, preserves user music/history, and restores the original score when leaving practice. Modal views include an equivalent SIDEREAL action because the underlying header is correctly inert.

The [ten-scenario follow-up receipt](home-loader-local-report.json) includes measured delay and reduced-motion timings. Actual mobile [note sheet](screenshots/home-mobile-panel.png) and [atlas](screenshots/home-mobile-atlas.png) captures show the equivalent logo controls inside modals.

All ten scenarios also passed on [the live site](home-loader-live-report.json), with zero page errors. The [follow-up deployment receipt](home-loader-deployment-report.json) verifies the exact new index/CSS/JavaScript/fav icon bytes under `/sidereal/`. The [source commit 741a6c7](https://github.com/seoshiro/sidereal/commit/741a6c729e86f12cc9b1d84e3399c70467464735) has a [successful build and deploy](https://github.com/seoshiro/sidereal/actions/runs/38056946974). Real preparation-to-ready timings were approximately 2.0 seconds; the existing fade adds about 0.24 seconds in normal mode and zero in reduced motion. Failures offer Retry immediately, without this success pause.

## Remaining verification limits

No human auditory review or physical Safari/iOS device check was available. Headless background tabs keep `document.hidden` false; the pause handler was checked with an explicitly synthetic visibilitychange. No claim of real background-tab lifecycle verification is made.

The supported Library upload workflow reported `Library prepare_uploads is not available`; there are no `library_file_id` values. The requested fallback is the real public PNG files in `docs/screenshots/`.

An earlier attempt to use `21st review` was rejected by automatic approval review because the third-party CLI's network behavior and possible source disclosure were not established. It was not retried; this revision was audited through local source inspection, runtime interaction and actual screenshots.
