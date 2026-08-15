# iPhone Simulator supplemental evidence

Date: 2026-08-15

Simulator: iPhone 17 Pro, iOS 26.5

Simulator ID: `A649F958-74D5-40EC-A164-7EC9A6CFEA50`

Candidate branch: `agent/specular-ui-rework`

Last committed candidate before this evidence package: `26851ba`

Policy: supplemental under [ADR 0007](../../adr/0007-launch-dictation-as-a-sites-pwa-beta.md)

## What this evidence means

This package is synthetic Simulator evidence. It is not physical-device certification and does not replace ADR 0007's documented iPhone and Android follow-up.

Two targets are deliberately kept separate:

- `live-safari-portrait.jpg` opens the currently deployed Site at `https://specular-thinking.madebyhenry.chatgpt.site`. It proves the real hosted route, Mobile Safari chrome, safe-area placement, and the fixed offline-ready notice. The deployed Site still shows the pre-rework tan entry surface, so this receipt does **not** prove the visual candidate.
- files beginning with `candidate-` open a loopback server built from the current branch with deterministic synthetic session, workspace, reflection, share, archive, and account data. They prove the UI candidate in Mobile Safari without publishing it.

No private author content was opened, copied, or captured.

## Reproducible command sequence

The named simulator and ordinary Safari state can be reproduced with:

```sh
SIMULATOR_ID=A649F958-74D5-40EC-A164-7EC9A6CFEA50
LIVE_SITE=https://specular-thinking.madebyhenry.chatgpt.site

xcodebuildmcp simulator-management boot --simulator-id "$SIMULATOR_ID"
xcodebuildmcp simulator-management open
xcodebuildmcp simulator launch-app \
  --simulator-id "$SIMULATOR_ID" \
  --bundle-id com.apple.mobilesafari
xcrun simctl openurl "$SIMULATOR_ID" "$LIVE_SITE"
xcodebuildmcp ui-automation snapshot-ui \
  --simulator-id "$SIMULATOR_ID"
xcodebuildmcp ui-automation screenshot \
  --simulator-id "$SIMULATOR_ID" \
  --return-format path
```

For the branch candidate, run the production build, serve it with deterministic synthetic APIs on loopback, and navigate Safari to that origin. The evidence run used `http://127.0.0.1:4180`. The simulator stream was mirrored for orientation and overlay interaction with:

```sh
npx --yes serve-sim@latest A649F958-74D5-40EC-A164-7EC9A6CFEA50
```

`serve-sim`'s **Rotate device** control was used to exercise portrait and landscape. The simulator was returned to upright portrait after capture.

For the focused-writing check, the text area was focused and the hardware-keyboard connection and software-keyboard visibility were toggled with the XcodeBuildMCP Simulator controls. The hardware-keyboard preference was restored after the run.

## Coverage and result

| Concern | Receipt | Result |
| --- | --- | --- |
| Real live route, Safari chrome, safe areas, fixed notice | `live-safari-portrait.jpg` | Pass for the deployed state; visual candidate not implied |
| Candidate portrait composition | `candidate-safari-device-portrait.jpg`, `candidate-safari-portrait.png` | Pass; the white authoring page remains visibly distinct over the cool neutral canvas |
| Candidate landscape reflow | `candidate-safari-landscape.png` | Pass; authoring and reflection regions remain reachable without clipping |
| Library overlay | `candidate-library-overlay.png` | Pass; modal is bounded within the safe area and controls remain visible |
| Snapshot overlay | `candidate-snapshot-overlay.png` | Pass; full overlay and footer actions remain visible within Safari |
| Focused writing and keyboard accommodation | `candidate-keyboard-device.jpg`, `candidate-keyboard-focus.png` | Partial Simulator evidence; field focus and Safari's input accessory strip were captured with no content occlusion |
| Semantic UI snapshot | XcodeBuildMCP runtime snapshot | Captured 141 elements, three Safari input-accessory targets, and two scroll areas |

## Explicit limitations

- On this iOS 26.5 Simulator run, disconnecting the hardware keyboard and invoking **Toggle Software Keyboard** exposed Safari's input accessory strip but not the full on-screen key grid. The focused field, caret, safe area, and viewport accommodation are evidenced; a full key-grid occlusion claim is not made.
- The semantic bridge exposed Safari chrome, web-view containers, scroll areas, and the input accessory controls, but it did not expose the hosted page's internal text as actionable runtime elements. Browser-level component and accessibility tests remain the source for page semantics.
- This run exercised ordinary Mobile Safari. An installed standalone PWA is a different state and was not captured. **Add to Home Screen** remains a manual step; no browser screenshot is substituted for it.
- No physical device, interruption recovery, microphone path, or production sign-in was certified by this package.

## Receipt index

- `live-safari-portrait.jpg` — deployed Site in ordinary Mobile Safari, including the fixed offline-ready notice.
- `candidate-safari-device-portrait.jpg` — direct device screenshot of the synthetic candidate.
- `candidate-safari-portrait.png` — mirrored portrait receipt with simulator identity and controls visible.
- `candidate-safari-landscape.png` — mirrored landscape reflow receipt.
- `candidate-library-overlay.png` — Library overlay on the candidate.
- `candidate-snapshot-overlay.png` — Snapshot overlay on the candidate.
- `candidate-keyboard-device.jpg` — direct device receipt with the writing field focused.
- `candidate-keyboard-focus.png` — mirrored focused-writing receipt showing Safari's input accessory strip.
