# 2026-09-03 — iOS TestFlight background crash (Swift 6 MainActor trap)

## Context

ContactLogo TestFlight 1.0.2 (`202608311128`) crashed on Jay's iPhone 16 Pro Max
while the app was not in the foreground.  iOS was launching it for the overnight
`BGProcessingTask` (`com.contactlogo.match`).  TestFlight then showed crash
alerts.  One report was sent to App Store Connect.

## Evidence

- ASC beta crash feedback `AKSCrgyHwHPlQg3-2nxKxYQ` (Wed, Sep 2, 2026 at
  1:28 PM CT).  Comment: "Unsure of what happened".  iPhone17,2 / iOS 27.0
  (24A5424a).
- Three matching on-device IPS reports on Sep 1 (3:58 PM, 10:47 PM, 11:21 PM
  CT).  Same build.  Queue `com.apple.BGTaskScheduler (com.contactlogo.match)`.
- Launch-to-crash 1–8 seconds.  Role unknown.  Parent `launchd`.

Stack:

```
EXC_BREAKPOINT / SIGTRAP
_dispatch_assert_queue_fail
swift_task_isCurrentExecutorWithFlagsImpl
closure #1 in ContactLogoiOSApp.init()
BGTaskScheduler _runTask:registration:
```

Sentry `contactlogo` had no events for this build (Cocoa DSN hygiene landed
after the Aug 31 TestFlight).

## Cause

`ContactLogoiOSApp` is `@MainActor`.  The `BGTaskScheduler.register` launch
handler was created in `init()` and captured `ReviewSession`, so Swift 6 treated
the closure as MainActor-isolated.  iOS invokes that handler on a background
scheduler queue.  The runtime isolation assert traps.  That is why the crash
dialog appears when the owner is not opening the app.

## Fix

- Bind the session on the main actor (`MatchBackgroundTask.bind`).
- Register a `nonisolated` launch handler that hops to MainActor before
  touching session state.
- Always call `setTaskCompleted` (wrong task type, missing session, success,
  and expiration).
- Serialize `setTaskCompleted` so expiration and the work task cannot double
  complete.

## Files

- `Apps/ContactLogoiOS/ContactLogoiOSApp.swift`
- `docs/rollouts/2026-09-03-ios-bgtask-mainactor-crash.md`
- `docs/EFFORT-LOG.md`

## Verification

- `swift test` — 101 passed.
- iOS shell typecheck of `ContactLogoiOSApp.swift` + siblings against the
  iPhoneSimulator stub SDK — clean (Swift 6 isolation of the new handler
  accepted).
- ContactLogoMac `xcodebuild` — BUILD SUCCEEDED.
- Full `xcodebuild` for ContactLogoiOS was not run on this Mac: Xcode 26.6
  has the iOS 26.5 SDK stub but no iOS platform / simulator runtime.  CI
  `apple` job on GitHub is the device-class compile.

## Follow-ups

- Do not extra-ship TestFlight from this lane.  The crash is in the live
  TestFlight binary until @Compiler ships a new build.
- Host pick and logo licensing remain owner calls (unchanged).
