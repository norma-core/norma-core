import X8Cellulard.TraceScenarios
import X8Cellulard.Actuation

namespace X8Cellulard

def staleHealthyAfterApply : World :=
  (applyDecision defaults staleHealthyRoutes).1

def connectedClockUnknownAfterApply : World :=
  (applyDecision defaults connectedClockUnknown).1

def connectedClockValidAfterApply : World :=
  (applyDecision defaults connectedClockValid).1

def fatalAfterApply : World :=
  (applyDecision defaults (platformFaultAfterBudget .fatal)).1

def dbusRestartAfterApply : World :=
  (applyDecision defaults dbusHungBeforeRebootBudget).1

def bothWantCycleAfterApply : World :=
  (applyDecision defaults bothUsbVanishedBeforeBudget).1

def allDownRebootStep : World × Plan :=
  closedStep defaults shortOutageAllDown (.tick 240)

def primaryRecoveredAfterApply : World :=
  (applyDecision defaults flappingPrimaryRecovers).1

def closedBootToHealthy : World :=
  runClosed defaults {}
    [ .tick 30
    , .modemObserved .external healthyExternal
    , .modemObserved .sara healthySara
    , .clockChanged .valid
    ]

-- Applying a route plan repairs route metrics and clears stale-route state.
example : staleHealthyAfterApply.external.routeMetric = defaults.externalMetric := by
  rfl

example : staleHealthyAfterApply.system.routesStale = false := by
  rfl

-- Clock sync starts after connectivity when the clock is not valid.
example : (applyDecision defaults connectedClockUnknown).2.system = .syncClock := by
  rfl

example : connectedClockUnknownAfterApply.system.clock = .syncing := by
  rfl

example : (applyDecision defaults connectedClockValid).2.system = .noOp := by
  rfl

example : connectedClockValidAfterApply.system.clock = .valid := by
  rfl

-- Force reboot applies the volatile reset and increments the reboot guard.
example : (applyDecision defaults (platformFaultAfterBudget .fatal)).2.system =
    .forceReboot .platformFault := by
  rfl

example : fatalAfterApply.bootAgeSec = 0 := by
  rfl

example : fatalAfterApply.forcedRebootsLastHour = 1 := by
  rfl

example : fatalAfterApply.external.presence = .absent := by
  rfl

-- Service restart actions recover the modeled service state.
example : (applyDecision defaults dbusHungBeforeRebootBudget).2.system =
    .restartService .dbus := by
  rfl

example : dbusRestartAfterApply.system.dbus = .running := by
  rfl

-- If both modems ask for hard power cycling, applying the plan cycles only one.
example : bothWantCycleAfterApply.external.powerCycles = 1 := by
  rfl

example : bothWantCycleAfterApply.sara.powerCycles = 0 := by
  rfl

example : bothWantCycleAfterApply.external.cooldown = true := by
  rfl

-- A timed all-links-down closed step emits and applies force reboot.
example : allDownRebootStep.2.system = .forceReboot .allLinksDown := by
  rfl

example : allDownRebootStep.1.bootAgeSec = 0 := by
  rfl

example : allDownRebootStep.1.forcedRebootsLastHour = 1 := by
  rfl

-- Primary restoration converges to the external route metric again.
example : primaryRecoveredAfterApply.external.routeMetric = defaults.externalMetric := by
  rfl

example : primaryRecoveredAfterApply.preferredSlot = .external := by
  rfl

-- A simple boot trace with both modems observed healthy ends with external preferred.
example : closedBootToHealthy.preferredSlot = .external := by
  rfl

example : closedBootToHealthy.external.routeMetric = defaults.externalMetric := by
  rfl

example : closedBootToHealthy.system.clock = .valid := by
  rfl

end X8Cellulard
