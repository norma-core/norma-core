import X8Cellulard.ClosedLoopScenarios
import X8Cellulard.ActionFailure

namespace X8Cellulard

def failedIpRouteInstall : World :=
  applyFailedAction
    { action := .installRoute .external defaults.externalMetric
      failure := .commandFailed }
    bothHealthy

def failedIpConfigure : World :=
  applyFailedAction
    { action := .configureIp .external
      failure := .commandTimeout }
    { bothHealthy with external := externalIpFailed }

def failedUdhcpcConfigure : World :=
  applyFailedAction
    { action := .configureIp .external
      failure := .commandFailed }
    { bothHealthy with external := externalRouteMissing }

def failedMmcliReconnect : World :=
  applyFailedAction
    { action := .reconnect .external
      failure := .commandTimeout }
    { bothHealthy with external := externalNoSignal }

def failedMmcliConnect : World :=
  applyFailedAction
    { action := .connect .external
      failure := .commandFailed }
    { bothHealthy with external := externalBearerLost }

def failedGpiosetCycle : World :=
  applyFailedAction
    { action := .powerCycle .external
      failure := .permissionDenied }
    { bothHealthy with external := externalHealthFailedHard }

def failedClockSyncAfterConnect : World :=
  applyFailedAction
    { action := .syncClock
      failure := .commandTimeout }
    connectedClockUnknownAfterApply

def failedServiceRestart : World :=
  applyFailedAction
    { action := .restartService .modemManager
      failure := .commandTimeout }
    modemManagerCrashedBeforeRebootBudget

def failedRebootAttempt : World :=
  applyFailedAction
    { action := .forceReboot .allLinksDown
      failure := .rebootFailed }
    externalBrokenSaraNoSim

def routePlanWithRouteFailure : World :=
  applyPlanWithFailures
    (decide defaults bothHealthy)
    [ { action := .installRoute .external defaults.externalMetric
        failure := .commandFailed } ]
    bothHealthy

def powerCyclePlanWithGpioFailure : World :=
  applyPlanWithFailures
    (recoverBoth bothUsbVanishedBeforeBudget)
    [ { action := .powerCycle .external
        failure := .permissionDenied } ]
    bothUsbVanishedBeforeBudget

-- Route installation failure should make the interface unhealthy and drive retry.
example : failedIpRouteInstall.external.ip = .addressReady := by
  rfl

example : failedIpRouteInstall.external.health = .failed := by
  rfl

example : recoverModem .external failedIpRouteInstall.external =
    .configureIp .external := by
  rfl

-- IP configuration failure remains an IP-layer recovery problem.
example : failedIpConfigure.external.ip = .failed := by
  rfl

example : recoverModem .external failedIpConfigure.external =
    .configureIp .external := by
  rfl

example : failedUdhcpcConfigure.external.ip = .failed := by
  rfl

example : recoverModem .external failedUdhcpcConfigure.external =
    .configureIp .external := by
  rfl

-- ModemManager connect/reconnect failure stays at modem session recovery.
example : failedMmcliReconnect.external.data = .failed := by
  rfl

example : recoverModem .external failedMmcliReconnect.external =
    .reconnect .external := by
  rfl

example : failedMmcliConnect.external.data = .failed := by
  rfl

example : recoverModem .external failedMmcliConnect.external =
    .connect .external := by
  rfl

-- GPIO failure is a platform fault, not a SIM/radio problem.
example : failedGpiosetCycle.system.platform = .fatal := by
  rfl

example : rebootReason? defaults
    { failedGpiosetCycle with
      sara := saraExhausted
      bootAgeSec := 900
      allLinksDownForSec := 600 } = some .platformFault := by
  rfl

-- NTP failure is observable but does not make the cellular route unusable.
example : failedClockSyncAfterConnect.system.clock = .failed := by
  rfl

example : failedClockSyncAfterConnect.external.canCarryTraffic = true := by
  rfl

example : (decide defaults failedClockSyncAfterConnect).system = .syncClock := by
  rfl

-- Failed service restart remains a control-plane recovery problem.
example : failedServiceRestart.system.modemManager = .hung := by
  rfl

example : (decide defaults failedServiceRestart).system =
    .restartService .modemManager := by
  rfl

-- Failed reboot stays fatal, so the next decision still asks for reboot.
example : failedRebootAttempt.system.platform = .fatal := by
  rfl

example : rebootReason? defaults failedRebootAttempt = some .platformFault := by
  rfl

-- Failure-aware plan application exposes partial success.
example : routePlanWithRouteFailure.external.ip = .addressReady := by
  rfl

example : routePlanWithRouteFailure.system.clock = .syncing := by
  rfl

example : powerCyclePlanWithGpioFailure.external.powerCycles = 1 := by
  rfl

example : powerCyclePlanWithGpioFailure.system.platform = .fatal := by
  rfl

end X8Cellulard
