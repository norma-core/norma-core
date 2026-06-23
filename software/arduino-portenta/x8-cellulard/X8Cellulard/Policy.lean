import X8Cellulard.State

namespace X8Cellulard

inductive Action where
  | noOp
  | hold (slot : Slot) (fault : Fault)
  | powerOn (slot : Slot)
  | reconnect (slot : Slot)
  | connect (slot : Slot)
  | configureIp (slot : Slot)
  | installRoute (slot : Slot) (metric : Nat)
  | removeRoute (slot : Slot)
  | powerCycle (slot : Slot)
  | restartService (service : Service)
  | reconcileRoutes
  | syncClock
  | forceReboot (reason : RebootReason)
  deriving DecidableEq, Repr

def Action.isNoOp : Action -> Bool
  | .noOp => true
  | _ => false

def Action.isForceReboot : Action -> Bool
  | .forceReboot _ => true
  | _ => false

def Action.hardCyclesSlot (slot : Slot) : Action -> Bool
  | .powerCycle s => s == slot
  | _ => false

def Action.hardCyclesAny (a : Action) : Bool :=
  a.hardCyclesSlot .external || a.hardCyclesSlot .sara

structure Plan where
  external : Action := .noOp
  sara : Action := .noOp
  system : Action := .noOp
  deriving Repr

def Plan.hasForceReboot (p : Plan) : Bool :=
  p.external.isForceReboot || p.sara.isForceReboot || p.system.isForceReboot

def Plan.hasDualHardCycle (p : Plan) : Bool :=
  p.external.hardCyclesAny && p.sara.hardCyclesAny

def recoverModem (slot : Slot) (m : Modem) : Action :=
  if m.canCarryTraffic then
    .noOp
  else if m.nonRecoverable then
    if m.sim == .missing then .hold slot .noSim
    else if m.sim == .pinRequired then .hold slot .pinRequired
    else if m.sim == .pukRequired then .hold slot .pukRequired
    else if m.sim == .failed then .hold slot .simFailure
    else if m.data == .apnRejected then .hold slot .apnRejected
    else .hold slot .registrationDenied
  else if m.cooldown then
    .noOp
  else match m.presence with
    | .absent => .powerOn slot
    | .vanished => .powerCycle slot
    | .usbPresent => .reconnect slot
    | .modemManagerSeen =>
        if m.sim != .ready then .hold slot .pinRequired
        else if !m.radioRegistered then .reconnect slot
        else if m.data != .connected then .connect slot
        else if m.ip != .routeInstalled then .configureIp slot
        else if m.health == .failed then
          if m.recoveryAttempts >= defaults.maxReconnectAttempts then .powerCycle slot
          else .reconnect slot
        else .noOp

def recoverBoth (w : World) : Plan :=
  let externalAction := recoverModem .external w.external
  let saraAction := recoverModem .sara w.sara
  if externalAction.hardCyclesAny && saraAction.hardCyclesAny then
    { external := externalAction, sara := .noOp }
  else
    { external := externalAction, sara := saraAction }

def routePlan (w : World) : Plan :=
  let systemAction := if w.system.needsTimeSync then .syncClock else .noOp
  if w.externalUsable then
    { external := .installRoute .external defaults.externalMetric
      sara := if w.saraUsable then .installRoute .sara defaults.saraMetric else .removeRoute .sara
      system := systemAction }
  else if w.saraUsable then
    { external := .removeRoute .external
      sara := .installRoute .sara defaults.saraMetric
      system := systemAction }
  else
    {}

def rebootAllowed (d : Defaults) (w : World) : Bool :=
  w.bootAgeSec >= d.bootGraceSec &&
  w.allLinksDownForSec >= d.allLinksDownTimeoutSec &&
  w.forcedRebootsLastHour < d.maxForcedRebootsPerHour

def rebootReason? (d : Defaults) (w : World) : Option RebootReason :=
  if w.anyUsable then
    none
  else if !rebootAllowed d w then
    none
  else if w.system.requiresReboot then
    if w.system.resources != .ok then some .resourceExhausted else some .platformFault
  else if !w.system.controlPlaneHealthy then
    some .controlPlaneWedged
  else if w.recoveryBudgetsExhausted d then
    some .allLinksDown
  else
    none

def controlPlanePlan (w : World) : Plan :=
  if w.system.dbus != .running then
    { system := .restartService .dbus }
  else if w.system.modemManager != .running then
    { system := .restartService .modemManager }
  else if w.system.tailscaled != .running then
    { system := .restartService .tailscaled }
  else if w.system.ntpClient != .running then
    { system := .restartService .ntpClient }
  else if w.system.routesStale then
    { system := .reconcileRoutes }
  else
    {}

def decide (d : Defaults) (w : World) : Plan :=
  if w.anyUsable then
    routePlan w
  else
    match rebootReason? d w with
    | some reason => { system := .forceReboot reason }
    | none =>
        let cp := controlPlanePlan w
        if cp.system.isNoOp then recoverBoth w else cp

end X8Cellulard
