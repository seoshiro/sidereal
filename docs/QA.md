# Verification and visual audit

The visual result was inspected from actual Chromium screenshots, independently of the tests. The instrument uses a restricted ink / brass / sea-glass / lilac palette, a large circular score, clear selected-note hierarchy, thin functional construction lines, and serif titles with compact technical labels. No decorative particle field, stock recordings, procedural 3D, or repeated product cards are used.

## Changes from the first visual prototype

- Play, Stop, tempo and master controls were moved directly beneath the composition name so sound does not require finding controls below a large chart.
- The mobile transport stays available while scrolling.
- The mobile atlas was made visible, preserving the same saved-composition features as desktop.
- Desktop chart size was constrained and control labels enlarged.
- Mobile layers use a compact three-column arrangement, followed by full-width exact note controls.

## Evidence

Actual screenshots are stored in this repository:

- [Desktop 1440](screenshots/desktop-1440.png)
- [Desktop 1920](screenshots/desktop-1920.png)
- [Mobile 360](screenshots/mobile-360.png)
- [Mobile 390](screenshots/mobile-390.png)
- [Tablet 768](screenshots/tablet-768.png)
- [Mobile 390 in Russian](screenshots/mobile-390-ru.png)

The scripts in `scripts/` reproduce the functional checks and screenshots. JSON receipts in this folder record successful checks. They are evidence of browser and numeric behavior, not a rating of artistic quality.

## Core checks

`npm test`: seven test groups, including 480 reachable coordinate round-trips, deterministic presets, voice registers, mute/solo semantics, schema bounds, malicious identifiers, field stripping, Unicode shares, malformed JSON and large input rejection.

`npm run build`: TypeScript strict checking and static production build. No runtime libraries, remote fonts, or external audio assets.

## Browser checks

The browser report covers gesture-only audio initialization, real AudioContext running state, play/pause/resume/stop, preset changes, live tempo changes, mouse drag, keyboard editing, add/delete/undo/redo, exact note controls, voice/scale/root changes, layer mute/solo, master mute, local atlas and draft reload, malformed and hostile import, valid import/export, decoding both exported formats, RU/EN, dialog focus, reduced motion, share links, responsive widths, repeated preview clicks, and 70 seconds of bounded playback.

PNG was decoded by Chromium as 1600 × 1880. WAV was decoded through `AudioContext.decodeAudioData` as non-silent stereo PCM at 44.1 kHz; measured peak remained below clipping. Stop cleared all active voices. Refer to the report for the exact values and browser version.

The maximum-load check rendered 96 simultaneous stars at full intensity and 80% master volume. The decoded peak was **0.34514**, below full scale. Muting all three layers rendered a WAV with an exact zero peak. Escape while a form control has focus also stops playback and updates the transport.

## Environment limits encountered

- The supported Library upload helper reported `Library prepare_uploads is not available`. No Library IDs were created. The real PNG screenshots are provided in `docs/screenshots/` instead.
- The additional `21st review` CLI was rejected by automatic approval review because its network behavior and possible source disclosure were not established. The local source, runtime UI and real screenshots were audited directly.
- Chromium automation kept `document.hidden` false even in an owned offscreen/minimized browser with focus emulation disabled. The pause-on-visibility handler was checked with an explicitly **synthetic** event; an actual hidden-tab lifecycle still needs a manual device check. This is not presented as a real tab-switch verification.

## Limits

Human listening is unavailable in this execution environment. No claim of actual auditory review is made. Headless Chromium checks do not establish Safari/iOS compatibility or physical-device ergonomics. The edge report distinguishes actual lifecycle events from any headless environment limitation. GitHub CI and published-path verification are recorded after deployment.
