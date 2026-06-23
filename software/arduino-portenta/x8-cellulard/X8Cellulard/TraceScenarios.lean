import X8Cellulard.FaultMatrix
import X8Cellulard.Transition

namespace X8Cellulard

def wrongExternalMetric : World where
  external := { healthyExternal with routeMetric := 999 }
  sara := healthySara
  preferred := .external
  bootAgeSec := 900

def staleHealthyRoutes : World :=
  { wrongExternalMetric with system := { routesStale := true } }

def connectedClockUnknown : World :=
  bothHealthy

def connectedClockValid : World :=
  { bothHealthy with system := { clock := .valid } }

def connectedClockFailed : World :=
  observe connectedClockValid (.clockChanged .failed)

def saraOnlyClockUnknown : World :=
  externalNoSimSaraHealthy

def staleDeadRoutes : World :=
  { allDownBeforeBudget externalBroken saraNoSim with
    system := { routesStale := true } }

def helperTimeoutsExhaustExternal : World :=
  runEvents
    { bothUsbVanishedBeforeBudget with external := externalHealthFailedSoft }
    [ .helperTimeout .external .healthCheck
    , .helperTimeout .external .healthCheck
    , .helperTimeout .external .healthCheck
    ]

def mmcliTimeoutExternal : World :=
  observe bothHealthy (.helperTimeout .external .mmcli)

def ipTimeoutExternal : World :=
  observe bothHealthy (.helperTimeout .external .ip)

def udhcpcTimeoutExternal : World :=
  observe bothHealthy (.helperTimeout .external .udhcpc)

def gpiosetFailureAllDown : World :=
  runEvents
    (allDownAfterBudget externalHealthFailedHard saraExhausted)
    [ .helperTimeout .external .gpioset
    , .helperTimeout .sara .gpioset
    ]

def flappingPrimaryRecovers : World :=
  runEvents externalDownSaraHealthy
    [ .tick 20
    , .modemObserved .external externalHealthFailedSoft
    , .tick 20
    , .modemObserved .external healthyExternal
    , .tick 20
    ]

def allDownCrossesRebootBudget : World :=
  runEvents shortOutageAllDown
    [ .tick 240 ]

def healthyTickClearsAllDownTimer : World :=
  runEvents
    { bothHealthy with allLinksDownForSec := 200 }
    [ .tick 10 ]

def daemonRestartWithHealthyLinks : World :=
  observe bothHealthy .daemonRestarted

def daemonRestartAllDown : World :=
  observe (allDownBeforeBudget externalBroken saraNoSim) .daemonRestarted

def modemManagerRestartRenumbersExternal : World :=
  runEvents bothHealthy
    [ .serviceChanged .modemManager .crashed
    , .serviceChanged .modemManager .running
    , .modemIdentityChanged .external
    ]

def rebootAfterFatalAllDown : World :=
  observe (platformFaultAfterBudget .fatal) .rebootCompleted

def otherModemDisturbedDuringRecovery : World :=
  runEvents externalDownSaraHealthy
    [ .modemObserved .sara saraVanished ]

def physicallyAbsentExternalSaraHealthy : World where
  external := { bootingExternal with presence := .absent }
  sara := healthySara
  preferred := .external
  bootAgeSec := 900

def bothNoCoverageLong : World :=
  allDownAfterBudget
    { externalNoSignal with recoveryAttempts := defaults.maxReconnectAttempts }
    { healthySara with
      radio := .noSignal
      data := .disconnected
      ip := .none
      health := .failed
      recoveryAttempts := defaults.maxReconnectAttempts }

def repeatedRebootsEventuallyGuarded : World :=
  runEvents externalBrokenSaraNoSim
    [ .rebootCompleted
    , .rebootCompleted
    , .rebootCompleted
    , .tick 900
    , .modemObserved .external externalBroken
    , .modemObserved .sara saraNoSim
    , .tick 600
    ]

-- Healthy route repair wins over stale/wrong metric state.
example : (decide defaults wrongExternalMetric).external =
    .installRoute .external defaults.externalMetric := by
  rfl

example : (decide defaults staleHealthyRoutes).external =
    .installRoute .external defaults.externalMetric := by
  rfl

example : (decide defaults staleHealthyRoutes).hasForceReboot = false := by
  rfl

-- Time sync is kicked after network connect, but is not a route prerequisite.
example : (decide defaults connectedClockUnknown).system = .syncClock := by
  rfl

example : (decide defaults connectedClockValid).system = .noOp := by
  rfl

example : (decide defaults connectedClockFailed).system = .syncClock := by
  rfl

example : (decide defaults saraOnlyClockUnknown).sara =
    .installRoute .sara defaults.saraMetric := by
  rfl

example : (decide defaults saraOnlyClockUnknown).system = .syncClock := by
  rfl

-- If all links are down and route state is stale, reconcile before modem recovery.
example : (decide defaults staleDeadRoutes).system = .reconcileRoutes := by
  rfl

-- Helper timeouts advance modem recovery state and eventually trigger hard recovery.
example : helperTimeoutsExhaustExternal.external.recoveryAttempts = 4 := by
  rfl

example : (recoverModem .external helperTimeoutsExhaustExternal.external) =
    .powerCycle .external := by
  rfl

example : (recoverModem .external mmcliTimeoutExternal.external) =
    .reconnect .external := by
  rfl

example : (recoverModem .external ipTimeoutExternal.external) =
    .configureIp .external := by
  rfl

example : (recoverModem .external udhcpcTimeoutExternal.external) =
    .configureIp .external := by
  rfl

example : gpiosetFailureAllDown.external.presence = .vanished := by
  rfl

example : rebootReason? defaults gpiosetFailureAllDown = some .allLinksDown := by
  rfl

-- Flapping primary returns to preferred service after it becomes healthy again.
example : flappingPrimaryRecovers.preferredSlot = .external := by
  rfl

example : (decide defaults flappingPrimaryRecovers).external =
    .installRoute .external defaults.externalMetric := by
  rfl

-- Timers move all-links-down into reboot territory, but healthy links reset the timer.
example : allDownCrossesRebootBudget.allLinksDownForSec = 300 := by
  rfl

example : rebootReason? defaults allDownCrossesRebootBudget = some .allLinksDown := by
  rfl

example : healthyTickClearsAllDownTimer.allLinksDownForSec = 0 := by
  rfl

-- Daemon restart does not erase modem reality; it forces route reconciliation.
example : daemonRestartWithHealthyLinks.system.routesStale = true := by
  rfl

example : (decide defaults daemonRestartWithHealthyLinks).hasForceReboot = false := by
  rfl

example : (decide defaults daemonRestartAllDown).system = .reconcileRoutes := by
  rfl

-- ModemManager ID renumbering is intentionally ignored by policy.
example : modemManagerRestartRenumbersExternal.external.canCarryTraffic = true := by
  rfl

example : modemManagerRestartRenumbersExternal.preferredSlot = .external := by
  rfl

-- Reboot resets volatile state and increments the reboot guard counter.
example : rebootAfterFatalAllDown.bootAgeSec = 0 := by
  rfl

example : rebootAfterFatalAllDown.forcedRebootsLastHour = 1 := by
  rfl

example : rebootAfterFatalAllDown.external.presence = .absent := by
  rfl

-- A recovery action that disturbs the backup still does not permit dual hard cycles.
example : (recoverBoth otherModemDisturbedDuringRecovery).hasDualHardCycle = false := by
  rfl

-- Physical absence of external LTE is fine when SARA can carry traffic.
example : physicallyAbsentExternalSaraHealthy.preferredSlot = .sara := by
  rfl

example : (decide defaults physicallyAbsentExternalSaraHealthy).hasForceReboot = false := by
  rfl

-- Long no-coverage on both paths still becomes all-links-down after budget.
example : rebootReason? defaults bothNoCoverageLong = some .allLinksDown := by
  rfl

-- Reboot-loop guard prevents the fourth forced reboot inside the modeled hour.
example : repeatedRebootsEventuallyGuarded.forcedRebootsLastHour =
    defaults.maxForcedRebootsPerHour := by
  rfl

example : rebootReason? defaults repeatedRebootsEventuallyGuarded = none := by
  rfl

end X8Cellulard
