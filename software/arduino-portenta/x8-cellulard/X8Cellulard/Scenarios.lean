import X8Cellulard.Invariants

namespace X8Cellulard

def externalBroken : Modem :=
  { bootingExternal with
    power := .railOn
    presence := .vanished
    sim := .ready
    radio := .registeredHome
    recoveryAttempts := 3
    powerCycles := 2 }

def saraNoSim : Modem :=
  { bootingSara with
    power := .railOn
    presence := .modemManagerSeen
    sim := .missing
    radio := .disabled
    recoveryAttempts := 3 }

def bothHealthy : World where
  external := healthyExternal
  sara := healthySara
  preferred := .external
  bootAgeSec := 600

def externalDownSaraHealthy : World where
  external := externalBroken
  sara := healthySara
  preferred := .external
  bootAgeSec := 600
  allLinksDownForSec := 0

def externalBrokenSaraNoSim : World where
  external := externalBroken
  sara := saraNoSim
  preferred := .external
  bootAgeSec := 900
  allLinksDownForSec := 600

def lowPowerBothDown : World where
  external := { externalBroken with powerCycles := 2 }
  sara := { bootingSara with presence := .vanished, sim := .ready, powerCycles := 2 }
  system := { platform := .lowPowerSuspected }
  preferred := .external
  bootAgeSec := 900
  allLinksDownForSec := 600

example : bothHealthy.preferredSlot = .external := by
  rfl

example : (decide defaults bothHealthy).hasForceReboot = false := by
  rfl

example : externalDownSaraHealthy.preferredSlot = .sara := by
  rfl

example : (decide defaults externalDownSaraHealthy).hasForceReboot = false := by
  rfl

example : rebootReason? defaults externalBrokenSaraNoSim = some .allLinksDown := by
  rfl

example : rebootReason? defaults lowPowerBothDown = some .platformFault := by
  rfl

end X8Cellulard
