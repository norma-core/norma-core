namespace X8Cellulard

inductive Slot where
  | external
  | sara
  deriving DecidableEq, Repr

def Slot.other : Slot -> Slot
  | .external => .sara
  | .sara => .external

inductive Service where
  | dbus
  | modemManager
  | tailscaled
  | ntpClient
  deriving DecidableEq, Repr

inductive ServiceState where
  | running
  | stopped
  | crashed
  | hung
  deriving DecidableEq, Repr

inductive PowerState where
  | off
  | railOn
  | resetting
  | cycling
  | cooldown
  deriving DecidableEq, Repr

inductive PresenceState where
  | absent
  | usbPresent
  | modemManagerSeen
  | vanished
  deriving DecidableEq, Repr

inductive SimState where
  | unknown
  | missing
  | pinRequired
  | pukRequired
  | ready
  | failed
  deriving DecidableEq, Repr

inductive RadioState where
  | disabled
  | enabling
  | enabled
  | searching
  | registeredHome
  | registeredRoaming
  | denied
  | noSignal
  deriving DecidableEq, Repr

inductive DataState where
  | disconnected
  | connecting
  | connected
  | disconnecting
  | failed
  | apnRejected
  deriving DecidableEq, Repr

inductive IpState where
  | none
  | needsDhcp
  | configuring
  | addressReady
  | routeInstalled
  | failed
  deriving DecidableEq, Repr

inductive HealthState where
  | unknown
  | healthy
  | degraded
  | failed
  deriving DecidableEq, Repr

inductive ResourceState where
  | ok
  | storageFull
  | runUnavailable
  | oomPressure
  | cannotFork
  deriving DecidableEq, Repr

inductive PlatformState where
  | ok
  | lowPowerSuspected
  | thermalStress
  | usbControllerWedged
  | fatal
  deriving DecidableEq, Repr

inductive ClockState where
  | unknown
  | syncNeeded
  | syncing
  | valid
  | failed
  deriving DecidableEq, Repr

inductive Fault where
  | noSim
  | pinRequired
  | pukRequired
  | simFailure
  | apnRejected
  | registrationDenied
  | noSignal
  | usbVanished
  | modemManagerLost
  | bearerLost
  | ipConfigFailed
  | routeMissing
  | healthFailed
  | commandTimeout
  | cannotFork
  | runUnavailable
  | storageFull
  | oomPressure
  | lowPowerSuspected
  | usbControllerWedged
  deriving DecidableEq, Repr

inductive Recoverability where
  | nonRecoverable
  | transient
  | modemReset
  | serviceRestart
  | platformReboot
  deriving DecidableEq, Repr

def Fault.recoverability : Fault -> Recoverability
  | .noSim => .nonRecoverable
  | .pinRequired => .nonRecoverable
  | .pukRequired => .nonRecoverable
  | .simFailure => .nonRecoverable
  | .apnRejected => .nonRecoverable
  | .registrationDenied => .nonRecoverable
  | .noSignal => .transient
  | .bearerLost => .transient
  | .ipConfigFailed => .transient
  | .routeMissing => .transient
  | .healthFailed => .transient
  | .usbVanished => .modemReset
  | .commandTimeout => .modemReset
  | .modemManagerLost => .serviceRestart
  | .cannotFork => .platformReboot
  | .runUnavailable => .platformReboot
  | .storageFull => .platformReboot
  | .oomPressure => .platformReboot
  | .lowPowerSuspected => .platformReboot
  | .usbControllerWedged => .platformReboot

inductive RebootReason where
  | allLinksDown
  | controlPlaneWedged
  | resourceExhausted
  | platformFault
  deriving DecidableEq, Repr

end X8Cellulard
