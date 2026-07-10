# Browser Compatibility Evidence

The automated mobile matrix runs the complete acceptance flow at 320, 375, and 430 CSS pixels with Playwright 1.61.1.

- Chromium 149.0.7827.55 (Playwright build 1228)
- WebKit 26.5 (Playwright build 2311)

These engine runs are automated compatibility evidence, not a claim of physical-device testing. At each release, the production operator must additionally run the same `tests/e2e/specular.spec.ts` flows on the latest two major iOS Safari releases and the latest two major Android Chrome releases, record the OS/browser/build and device viewport, and attach the results to the release audit. A generic emulated device does not satisfy that release record.
