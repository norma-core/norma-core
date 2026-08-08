import X8Cellulard.Scenarios

namespace X8Cellulard

def externalNoSim : Modem :=
  { healthyExternal with
    sim := .missing
    data := .disconnected
    ip := .none
    health := .failed }

def externalPinRequired : Modem :=
  { externalNoSim with sim := .pinRequired }

def externalPukRequired : Modem :=
  { externalNoSim with sim := .pukRequired }

def externalSimFailed : Modem :=
  { externalNoSim with sim := .failed }

def externalRegistrationDenied : Modem :=
  { healthyExternal with
    radio := .denied
    data := .disconnected
    ip := .none
    health := .failed }

def externalApnRejected : Modem :=
  { healthyExternal with
    data := .apnRejected
    ip := .none
    health := .failed }

def externalNoSignal : Modem :=
  { healthyExternal with
    radio := .noSignal
    data := .disconnected
    ip := .none
    health := .failed }

def externalBearerLost : Modem :=
  { healthyExternal with
    data := .disconnected
    ip := .none
    health := .unknown }

def externalIpFailed : Modem :=
  { healthyExternal with
    ip := .failed
    health := .unknown }

def externalRouteMissing : Modem :=
  { healthyExternal with
    ip := .addressReady
    health := .unknown }

def externalHealthFailedSoft : Modem :=
  { healthyExternal with
    health := .failed
    recoveryAttempts := 1 }

def externalHealthFailedHard : Modem :=
  { externalHealthFailedSoft with
    recoveryAttempts := defaults.maxReconnectAttempts }

def externalUsbVanished : Modem :=
  { healthyExternal with
    presence := .vanished
    data := .disconnected
    ip := .none
    health := .failed }

def externalUsbPresentNoMm : Modem :=
  { healthyExternal with
    presence := .usbPresent
    data := .disconnected
    ip := .none
    health := .unknown }

def saraVanished : Modem :=
  { healthySara with
    presence := .vanished
    data := .disconnected
    ip := .none
    health := .failed }

def saraExhausted : Modem :=
  { saraVanished with
    recoveryAttempts := defaults.maxReconnectAttempts
    powerCycles := defaults.maxPowerCyclesPerModem }

def allDownAfterBudget (external sara : Modem) : World where
  external := external
  sara := sara
  preferred := .external
  bootAgeSec := 900
  allLinksDownForSec := 600

def allDownBeforeBudget (external sara : Modem) : World where
  external := external
  sara := sara
  preferred := .external
  bootAgeSec := 900
  allLinksDownForSec := 30

def externalNoSimSaraHealthy : World where
  external := externalNoSim
  sara := healthySara
  preferred := .external
  bootAgeSec := 900

def externalHealthySaraNoSim : World where
  external := healthyExternal
  sara := saraNoSim
  preferred := .external
  bootAgeSec := 900

def bothNoSimAfterBudget : World :=
  allDownAfterBudget externalNoSim saraNoSim

def bothUsbVanishedBeforeBudget : World :=
  allDownBeforeBudget externalUsbVanished saraVanished

def dbusHungBeforeRebootBudget : World :=
  { allDownBeforeBudget externalBroken saraNoSim with
    system := { dbus := .hung } }

def modemManagerCrashedBeforeRebootBudget : World :=
  { allDownBeforeBudget externalBroken saraNoSim with
    system := { modemManager := .crashed } }

def tailscaledCrashedBeforeRebootBudget : World :=
  { allDownBeforeBudget externalBroken saraNoSim with
    system := { tailscaled := .crashed } }

def ntpClientCrashedBeforeRebootBudget : World :=
  { allDownBeforeBudget externalBroken saraNoSim with
    system := { ntpClient := .crashed } }

def staleRoutesBeforeRebootBudget : World :=
  { allDownBeforeBudget externalBroken saraNoSim with
    system := { routesStale := true } }

def resourceExhaustedAfterBudget (r : ResourceState) : World :=
  { allDownAfterBudget externalBroken saraExhausted with
    system := { resources := r } }

def platformFaultAfterBudget (p : PlatformState) : World :=
  { allDownAfterBudget externalBroken saraExhausted with
    system := { platform := p } }

def earlyBootAllDown : World :=
  { allDownAfterBudget externalBroken saraNoSim with
    bootAgeSec := 60 }

def shortOutageAllDown : World :=
  { allDownAfterBudget externalBroken saraNoSim with
    allLinksDownForSec := 60 }

def rebootLimitReachedAllDown : World :=
  { allDownAfterBudget externalBroken saraNoSim with
    forcedRebootsLastHour := defaults.maxForcedRebootsPerHour }

def saraHealthyButPlatformSuspicious : World where
  external := externalBroken
  sara := healthySara
  system := { platform := .lowPowerSuspected }
  preferred := .external
  bootAgeSec := 900
  allLinksDownForSec := 600

-- SIM and operator/config faults are held, not reset-looped.
example : recoverModem .external externalNoSim = .hold .external .noSim := by
  rfl

example : recoverModem .external externalPinRequired = .hold .external .pinRequired := by
  rfl

example : recoverModem .external externalPukRequired = .hold .external .pukRequired := by
  rfl

example : recoverModem .external externalSimFailed = .hold .external .simFailure := by
  rfl

example :
    recoverModem .external externalRegistrationDenied =
      .hold .external .registrationDenied := by
  rfl

example : recoverModem .external externalApnRejected = .hold .external .apnRejected := by
  rfl

-- Radio, bearer, IP, and health faults get progressively stronger recovery.
example : recoverModem .external externalNoSignal = .reconnect .external := by
  rfl

example : recoverModem .external externalBearerLost = .connect .external := by
  rfl

example : recoverModem .external externalIpFailed = .configureIp .external := by
  rfl

example : recoverModem .external externalRouteMissing = .configureIp .external := by
  rfl

example : recoverModem .external externalHealthFailedSoft = .reconnect .external := by
  rfl

example : recoverModem .external externalHealthFailedHard = .powerCycle .external := by
  rfl

example : recoverModem .external externalUsbVanished = .powerCycle .external := by
  rfl

example : recoverModem .external externalUsbPresentNoMm = .reconnect .external := by
  rfl

-- If both modems want a hard cycle, choose one and leave the other alone.
example : (recoverBoth bothUsbVanishedBeforeBudget).external = .powerCycle .external := by
  rfl

example : (recoverBoth bothUsbVanishedBeforeBudget).sara = .noOp := by
  rfl

example : (recoverBoth bothUsbVanishedBeforeBudget).hasDualHardCycle = false := by
  rfl

-- Route decisions prefer external, then SARA, and never reboot while one route works.
example : externalHealthySaraNoSim.preferredSlot = .external := by
  rfl

example : (decide defaults externalHealthySaraNoSim).external =
    .installRoute .external defaults.externalMetric := by
  rfl

example : (decide defaults externalHealthySaraNoSim).sara = .removeRoute .sara := by
  rfl

example : externalNoSimSaraHealthy.preferredSlot = .sara := by
  rfl

example : (decide defaults externalNoSimSaraHealthy).external =
    .removeRoute .external := by
  rfl

example : (decide defaults externalNoSimSaraHealthy).sara =
    .installRoute .sara defaults.saraMetric := by
  rfl

example : (decide defaults saraHealthyButPlatformSuspicious).hasForceReboot = false := by
  rfl

-- Control-plane failures are restarted before the all-links-down reboot budget expires.
example : (decide defaults dbusHungBeforeRebootBudget).system =
    .restartService .dbus := by
  rfl

example : (decide defaults modemManagerCrashedBeforeRebootBudget).system =
    .restartService .modemManager := by
  rfl

example : (decide defaults tailscaledCrashedBeforeRebootBudget).system =
    .restartService .tailscaled := by
  rfl

example : (decide defaults ntpClientCrashedBeforeRebootBudget).system =
    .restartService .ntpClient := by
  rfl

example : (decide defaults staleRoutesBeforeRebootBudget).system =
    .reconcileRoutes := by
  rfl

-- Resource and platform faults become reboot decisions only when no link works.
example :
    rebootReason? defaults (resourceExhaustedAfterBudget .cannotFork) =
      some .resourceExhausted := by
  rfl

example :
    rebootReason? defaults (resourceExhaustedAfterBudget .runUnavailable) =
      some .resourceExhausted := by
  rfl

example :
    rebootReason? defaults (resourceExhaustedAfterBudget .storageFull) =
      some .resourceExhausted := by
  rfl

example :
    rebootReason? defaults (resourceExhaustedAfterBudget .oomPressure) =
      some .resourceExhausted := by
  rfl

example :
    rebootReason? defaults (platformFaultAfterBudget .lowPowerSuspected) =
      some .platformFault := by
  rfl

example :
    rebootReason? defaults (platformFaultAfterBudget .thermalStress) =
      some .platformFault := by
  rfl

example :
    rebootReason? defaults (platformFaultAfterBudget .usbControllerWedged) =
      some .platformFault := by
  rfl

example :
    rebootReason? defaults (platformFaultAfterBudget .fatal) =
      some .platformFault := by
  rfl

-- Reboot-loop guards block forced reboot during early boot, short outages, or rate limits.
example : rebootReason? defaults earlyBootAllDown = none := by
  rfl

example : rebootReason? defaults shortOutageAllDown = none := by
  rfl

example : rebootReason? defaults rebootLimitReachedAllDown = none := by
  rfl

-- Once both paths are unusable and budgets are exhausted, reboot is allowed.
example : rebootReason? defaults bothNoSimAfterBudget = some .allLinksDown := by
  rfl

example : rebootReason? defaults externalBrokenSaraNoSim = some .allLinksDown := by
  rfl

end X8Cellulard
