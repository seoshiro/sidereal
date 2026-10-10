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

The new local [20-scenario browser receipt](browser-v2-report.json) and [five interaction checks](interaction-v2-report.json) are included. Published-site and asset receipts are added after deployment and use the same scripts. The published index and every production asset are compared with the local build under the repository base path.

## Remaining verification limits

No human auditory review or physical Safari/iOS device check was available. Headless background tabs keep `document.hidden` false; the pause handler was checked with an explicitly synthetic visibilitychange. No claim of real background-tab lifecycle verification is made.

The supported Library upload workflow reported `Library prepare_uploads is not available`; there are no `library_file_id` values. The requested fallback is the real public PNG files in `docs/screenshots/`.

An earlier attempt to use `21st review` was rejected by automatic approval review because the third-party CLI's network behavior and possible source disclosure were not established. It was not retried; this revision was audited through local source inspection, runtime interaction and actual screenshots.
