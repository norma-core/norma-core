import X8Cellulard.Types

namespace X8Cellulard

structure Defaults where
  externalMetric : Nat := 100
  saraMetric : Nat := 500
  bootGraceSec : Nat := 240
  allLinksDownTimeoutSec : Nat := 300
  maxPowerCyclesPerModem : Nat := 2
  maxReconnectAttempts : Nat := 3
  maxForcedRebootsPerHour : Nat := 3
  deriving Repr

def defaults : Defaults := {}

structure Modem where
  power : PowerState
  presence : PresenceState
  sim : SimState
  radio : RadioState
  data : DataState
  ip : IpState
  health : HealthState
  routeMetric : Nat
  recoveryAttempts : Nat := 0
  powerCycles : Nat := 0
  cooldown : Bool := false
  deriving Repr

def Modem.radioRegistered (m : Modem) : Bool :=
  m.radio == .registeredHome || m.radio == .registeredRoaming

def Modem.canCarryTraffic (m : Modem) : Bool :=
  m.presence == .modemManagerSeen &&
  m.sim == .ready &&
  m.radioRegistered &&
  m.data == .connected &&
  m.ip == .routeInstalled &&
  m.health == .healthy

def Modem.nonRecoverable (m : Modem) : Bool :=
  m.sim == .missing ||
  m.sim == .pinRequired ||
  m.sim == .pukRequired ||
  m.sim == .failed ||
  m.radio == .denied ||
  m.data == .apnRejected

def Modem.recoveryExhausted (d : Defaults) (m : Modem) : Bool :=
  m.nonRecoverable ||
  m.powerCycles >= d.maxPowerCyclesPerModem ||
  m.recoveryAttempts >= d.maxReconnectAttempts

def Modem.needsHardPowerCycle (m : Modem) : Bool :=
  !m.nonRecoverable &&
  !m.cooldown &&
  (m.presence == .vanished ||
    (m.health == .failed && m.recoveryAttempts >= defaults.maxReconnectAttempts))

def healthyExternal : Modem where
  power := .railOn
  presence := .modemManagerSeen
  sim := .ready
  radio := .registeredHome
  data := .connected
  ip := .routeInstalled
  health := .healthy
  routeMetric := defaults.externalMetric

def healthySara : Modem where
  power := .railOn
  presence := .modemManagerSeen
  sim := .ready
  radio := .registeredHome
  data := .connected
  ip := .routeInstalled
  health := .healthy
  routeMetric := defaults.saraMetric

def bootingExternal : Modem where
  power := .off
  presence := .absent
  sim := .unknown
  radio := .disabled
  data := .disconnected
  ip := .none
  health := .unknown
  routeMetric := defaults.externalMetric

def bootingSara : Modem where
  power := .off
  presence := .absent
  sim := .unknown
  radio := .disabled
  data := .disconnected
  ip := .none
  health := .unknown
  routeMetric := defaults.saraMetric

structure System where
  dbus : ServiceState := .running
  modemManager : ServiceState := .running
  tailscaled : ServiceState := .running
  ntpClient : ServiceState := .running
  routesStale : Bool := false
  resources : ResourceState := .ok
  platform : PlatformState := .ok
  clock : ClockState := .unknown
  deriving Repr

def System.controlPlaneHealthy (s : System) : Bool :=
  s.dbus == .running &&
  s.modemManager == .running &&
  s.ntpClient == .running &&
  s.resources == .ok &&
  s.platform == .ok

def System.needsTimeSync (s : System) : Bool :=
  s.clock == .unknown ||
  s.clock == .syncNeeded ||
  s.clock == .failed

def System.requiresReboot (s : System) : Bool :=
  s.resources == .cannotFork ||
  s.resources == .runUnavailable ||
  s.resources == .storageFull ||
  s.resources == .oomPressure ||
  s.platform == .lowPowerSuspected ||
  s.platform == .thermalStress ||
  s.platform == .usbControllerWedged ||
  s.platform == .fatal

structure World where
  external : Modem := bootingExternal
  sara : Modem := bootingSara
  preferred : Slot := .external
  system : System := {}
  bootAgeSec : Nat := 0
  allLinksDownForSec : Nat := 0
  forcedRebootsLastHour : Nat := 0
  deriving Repr

def World.modem (w : World) : Slot -> Modem
  | .external => w.external
  | .sara => w.sara

def World.externalUsable (w : World) : Bool :=
  w.external.canCarryTraffic

def World.saraUsable (w : World) : Bool :=
  w.sara.canCarryTraffic

def World.anyUsable (w : World) : Bool :=
  w.externalUsable || w.saraUsable

def World.allLinksDown (w : World) : Bool :=
  !w.anyUsable

def World.preferredSlot (w : World) : Slot :=
  if w.externalUsable then .external
  else if w.saraUsable then .sara
  else w.preferred

def World.recoveryBudgetsExhausted (d : Defaults) (w : World) : Bool :=
  w.external.recoveryExhausted d && w.sara.recoveryExhausted d

end X8Cellulard
