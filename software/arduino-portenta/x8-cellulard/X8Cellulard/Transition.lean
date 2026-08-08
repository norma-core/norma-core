import X8Cellulard.Policy

namespace X8Cellulard

inductive Helper where
  | mmcli
  | ip
  | udhcpc
  | gpioset
  | healthCheck
  deriving DecidableEq, Repr

inductive Event where
  | tick (seconds : Nat)
  | modemObserved (slot : Slot) (modem : Modem)
  | modemIdentityChanged (slot : Slot)
  | helperTimeout (slot : Slot) (helper : Helper)
  | serviceChanged (service : Service) (state : ServiceState)
  | resourceChanged (state : ResourceState)
  | platformChanged (state : PlatformState)
  | clockChanged (state : ClockState)
  | routesBecameStale
  | routesReconciled
  | daemonRestarted
  | rebootCompleted
  deriving Repr

def World.withModem (w : World) (slot : Slot) (modem : Modem) : World :=
  match slot with
  | .external => { w with external := modem }
  | .sara => { w with sara := modem }

def World.updateModem (w : World) (slot : Slot) (f : Modem -> Modem) : World :=
  w.withModem slot (f (w.modem slot))

def System.withService (s : System) : Service -> ServiceState -> System
  | .dbus, state => { s with dbus := state }
  | .modemManager, state => { s with modemManager := state }
  | .tailscaled, state => { s with tailscaled := state }
  | .ntpClient, state => { s with ntpClient := state }

def Modem.noteHelperTimeout (helper : Helper) (m : Modem) : Modem :=
  let m := { m with
    recoveryAttempts := m.recoveryAttempts + 1
    health := .failed }
  match helper with
  | .mmcli => { m with presence := .usbPresent }
  | .ip => { m with ip := .failed }
  | .udhcpc => { m with ip := .failed }
  | .gpioset => { m with presence := .vanished }
  | .healthCheck => m

def World.advanceTime (w : World) (seconds : Nat) : World :=
  let downFor := if w.anyUsable then 0 else w.allLinksDownForSec + seconds
  { w with
    bootAgeSec := w.bootAgeSec + seconds
    allLinksDownForSec := downFor }

def observe (w : World) : Event -> World
  | .tick seconds => w.advanceTime seconds
  | .modemObserved slot modem => w.withModem slot modem
  | .modemIdentityChanged _slot => w
  | .helperTimeout slot helper => w.updateModem slot (Modem.noteHelperTimeout helper)
  | .serviceChanged service state =>
      { w with system := w.system.withService service state }
  | .resourceChanged state =>
      { w with system := { w.system with resources := state } }
  | .platformChanged state =>
      { w with system := { w.system with platform := state } }
  | .clockChanged state =>
      { w with system := { w.system with clock := state } }
  | .routesBecameStale =>
      { w with system := { w.system with routesStale := true } }
  | .routesReconciled =>
      { w with system := { w.system with routesStale := false } }
  | .daemonRestarted =>
      { w with system := { w.system with routesStale := true } }
  | .rebootCompleted =>
      { external := bootingExternal
        sara := bootingSara
        preferred := .external
        system := {}
        bootAgeSec := 0
        allLinksDownForSec := 0
        forcedRebootsLastHour := w.forcedRebootsLastHour + 1 }

def react (d : Defaults) (w : World) (event : Event) : World × Plan :=
  let next := observe w event
  (next, decide d next)

def runEvents (w : World) : List Event -> World
  | [] => w
  | event :: rest => runEvents (observe w event) rest

end X8Cellulard
