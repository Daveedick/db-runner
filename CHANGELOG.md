# Changelog

User-visible changes, newest first. Version headings use `## [x.y.z] - YYYY-MM-DD`, followed by `Added`, `Changed`, or `Fixed` sections. Dates are release-commit dates, not claims about exact deployment time. Earlier entries were reconstructed from Git history; unnumbered deliveries are explicitly identified. Git commits remain the detailed technical record.

## [0.7.1] - 2026-10-22

### Changed

- Use the new menu loop with a half-second fade on entry. Start each run with Intro once, then repeat Main continuously. Pausing retains the current part and position; new runs return to Intro. Audio settings apply to all tracks, and hidden tabs stay silent until manual interaction.
- Try menu autoplay on load when the browser permits it; otherwise start after the first click, tap or key on the page without requiring a run to begin.

### Fixed

- Keep the completed-run screen visible when a jump key is pressed at the fatal obstacle. Restart requires the explicit New game button, and completing a run resets its gameplay music.

## [0.7.0] - 2026-10-19

### Added

- Guest profiles with nicknames and optional participation in a shared best-distance leaderboard; personal run history stays on this device.
- Public links to individual completed runs, with system sharing or link copying.
- Optional recovery codes to reopen the same profile on another device without registration.
- Complete English and Russian interfaces, with a language choice beside the audio settings, saved in this browser. English is the default; shared-run pages also support both languages.

### Changed

- Use consistent sizes for menu buttons, panel headings, explanatory text and inputs across personal statistics and online features. Longer labels wrap or scroll within their panel.
- Use “Give it a go” / “Попробовать” for the shared-run page's game button.

## [0.6.0] - 2026-10-13

### Added

- Sort Statistics by date, distance, bars, duration or peak speed using the column headers. Distance defaults to longest first; selecting a different column starts descending and repeating the selection reverses it. Legacy rows without a peak speed stay last in both directions.
- Airborne chains of 5–7 PUMP BITE bars with wider spacing. Each jump takes two, occasionally three bars; repeat jumps to continue, or skip late rewards to prepare for an optional obstacle after the chain. Each train shares one gentle horizontal speed and retains light levitation.

### Changed

- Rename the game to Drum & Bass Runner, with D&B Runner in the interface and the full name in the browser tab and current product documentation.
- Temporarily remove the variant selector. The game opens only with the original Gainer runner, gym and soundtrack; dormant Korona assets and browser history are retained.
- Increase each five-bar speed upgrade from 10% to 15%, retaining the 25 km/h start, one-second ramp and uncapped progression.
- Let bars travel forward in the world at 4–8% of runner speed, so the runner catches them and their screen approach is 4–8% slower than equipment. Retain at most ±2.5 logical pixels of vertical bob. Preserve comfortable and precise rewards; put risky low rewards immediately after the first visible obstacle rather than ahead of unseen hazards.
- Introduce precision patterns and trains after the first 18 active seconds. Risky pairs also require two speed upgrades. Withhold risky pairs and trains when the scene cannot provide adequate warning at the current speed, allowing for two further upgrades during a train.

### Fixed

- Use each flying bar's own frame displacement for swept pickup detection at high speeds. Remove unused selector styles and compact-menu grid space.

## [0.5.0] - 2026-09-09

### Added

- Save the maximum speed actually reached in each completed Gainer or Korona run. Show it in Statistics and the completion summary; older rows display an explicit unrecorded value instead of an estimated speed.
- Celebrate a new distance record with an amber completion panel, a large result and the improvement over the previous best. The first record has its own congratulation; tied or shorter runs keep the ordinary completion screen.

### Changed

- Both Gainer and Korona start at 25 km/h. Every five pickups adds 10% of the current speed, with a smooth one-second ramp and no progression cap.
- Korona shares Gainer's jump, input buffer, three lives, damage immunity, distance, run summary and Statistics. Each mode keeps its own paused progress and browser-local history; existing Gainer records remain compatible.
- Replace protein-bar branding with fictional PUMP BITE wrappers in four flavors. Rename the second mode and Rio sign to KORONA; its floating bottles replace bars in the course, HUD and statistics.
- Preserve each mode's scenery, soundtrack and character, gym equipment in Gainer and the original green prototype obstacles in Korona.

### Fixed

- Detect pickups and obstacle collisions across frame travel at high speeds; scale approach and landing spacing with progression.

## [0.4.0] - 2026-09-06

### Added

- Gainer runs with three lives, 1.2 seconds of damage immunity, a run-complete summary and restart. Each obstacle can damage the player only once.
- Distance, personal best and a Statistics menu with the last 20 completed runs, dates, time and bar counts. History stays in this browser; unavailable storage does not block play.
- Collectible protein bars in chocolate, berry, coconut and pistachio wrappers, with independent bobbing, a quiet mute/volume-aware pickup sound and outlined +1 feedback above the runner.
- Digital speedometer and smooth +5% boosts every 10 collected bars, capped at +30% after 60 bars. Restart resets progression.

### Changed

- Mix free pickups, single obstacles, rewards above equipment, pairs and longer quiet sections; preserve a gentle opening and speed-aware landing gaps. Risky reward layouts remain disabled after playtesting.
- Raise starting speed by 5% to 220.5 logical px/s (22.7 km/h displayed). Lengthen the jump by approximately 18% versus the original trajectory, using impulse -624 and gravity 1450.
- Keep the six equipment silhouettes from 0.3.4, with solid-body hitboxes and narrowed step platforms. Corona retains its original speed, physics, scenery, soundtrack and endless rules.

### Fixed

- Buffer fresh jump presses for 140 ms before landing; held-key repeat cannot create automatic jumps. Pause, hidden state and restart clear the buffer.
- Preserve each variant's player motion independently; paused selection cannot advance or evade a Gainer run. Statistics/menu controls do not trigger jumps.
- Keep pickup feedback visible above the hero, support reduced motion, and fit HUD/statistics controls to narrow and short layouts.
- Cover gameplay, storage, input/audio lifecycle, all seven speed tiers and release-version consistency with automated tests.

## [0.3.4] - 2026-09-06

### Changed

- Replace Gainer's green placeholder obstacles with six readable gym-equipment sprites: dumbbell, plates, step and untidy variants with piled dumbbells, displaced plates and a towel.
- Fit collision bounds to solid bodies, excluding thin protrusions and cloth; retain image-load fallbacks and safe spacing.
- Keep Corona's original obstacles, both worlds' artwork/music and the existing endless-run rules. No lives, statistics or pickups in this snapshot.
- This is a separately validated Git milestone, delivered together with 0.4.0 rather than deployed independently.

## [0.3.3] - 2026-09-03

### Added

- Corona: Rio Night Meet — nighttime skyline, distant Christ statue, friends, parked cars and illuminated bar signs, with independent parallax layers loaded on first selection.
- A separate three-minute Bandolero remix for Corona, trimmed from the supplied track with a short fade-out; Gainer retains its soundtrack.

### Changed

- Rename the menu group to Variant and the options to Gainer / Corona, with a smaller Extra subtitle.
- Reduce the car-meet background layer by 15% after playtesting.
- Preserve each world's scrolling phase and each track's playback position across paused selection; share mute/volume without autoplay on selection.
- Keep both runner rendering modes and existing jump/obstacle behavior. Document artwork/audio provenance and add scene, audio and lifecycle coverage (32 tests).

## [0.3.2] - 2026-09-03

### Added

- Виндизейнер: white sleeveless tank and metallic cross at both sprite resolutions, with CORONA → replacing GAINER → in the gym sign.
- Качок / Виндизейнер selector in the start and pause menus. Selection stays paused, defaults to Качок on reload and is independent of the rendering query parameter.

### Fixed

- Keep menu controls out of jump routing and fit the expanded selector to short viewports.

## [0.3.1] - 2026-09-03

### Added

- Runner refactored: opt-in full-resolution sprite rendering with `?runner=refactored`; `?runner=restored` remains an alias.
- Source artwork and reproducible alpha-extraction documentation, with fallback to the original atlas if detailed artwork fails.

### Changed

- Keep the original runner as default; preserve character scale, hitbox, physics and four-frame running cadence.

## [0.3.0] - 2026-09-03

### Added

- DDX-inspired Neon Gym: graphite equipment, mirrors, violet lighting and amber GAINER → navigation, inspired by Hotline Miami and Katana ZERO.
- Repeating background and independently scrolling cached floor, extending decor around the centered gameplay scene.
- Scenery fallback and mocked lifecycle tests; artwork provenance, design concept and local QA documentation.

### Changed

- Match the interface to the violet/amber gym palette; replace the prototype sky, clouds and green ground line.
- Preserve the animated runner, prototype obstacles and core gameplay. The package version is 0.3.0; the historical UI displayed V0.3.

## [0.2.0] - 2026-09-01

### Added

- Animated muscular runner with idle, four running frames at 8 FPS and an airborne pose, replacing the geometric character.
- Design-concept tracker recording accepted milestones and deferred world-design work.

### Changed

- Package the existing obstacle prototype and mobile fixes with the first character milestone. The historical UI displayed V0.2.

## [0.1.0] - 2026-08-28

### Added

- Initial Vite/TypeScript Canvas runner with movement, jumping, explicit play/pause, keyboard and pointer controls.
- Optional looping soundtrack with mute/volume, user-gesture playback and page-visibility pause without automatic resume.
- Responsive, DPR-aware Canvas with a centered 640 × 360 logical scene and decorative ambient layers.
- Pause-menu controls, repository guidance and approval-gated Git delivery workflow.
- Docker/nginx production packaging with a health endpoint for the existing Coolify deployment.

### Changed

- Unnumbered delivery on 2026-08-30 (`0c5d4ea`): add low/tall/grouped obstacles, a safe opening, constrained random gaps, player collision bounds and temporary collision feedback; no lives or game-over yet.

### Fixed

- Unnumbered deliveries on 2026-08-30 (`7333d64`, `2baa9cd`): prevent unwanted mobile viewport/double-tap/gesture zoom. These commits retained package version 0.1.0; no historical 0.1.x patch numbers are invented.
