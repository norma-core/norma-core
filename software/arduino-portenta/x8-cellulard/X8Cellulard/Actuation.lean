import X8Cellulard.Transition

namespace X8Cellulard

def Action.touchesRoutes : Action -> Bool
  | .installRoute _ _ => true
  | .removeRoute _ => true
  | .reconcileRoutes => true
  | _ => false

def Modem.applyAction (slot : Slot) (action : Action) (m : Modem) : Modem :=
  match action with
  | .powerOn s =>
      if s == slot then
        { m with
          power := .railOn
          presence := .usbPresent
          recoveryAttempts := m.recoveryAttempts + 1 }
      else m
  | .reconnect s =>
      if s == slot then
        { m with
          data := .connecting
          health := .unknown
          recoveryAttempts := m.recoveryAttempts + 1 }
      else m
  | .connect s =>
      if s == slot then
        { m with
          data := .connected
          ip := .needsDhcp
          health := .unknown }
      else m
  | .configureIp s =>
      if s == slot then
        { m with ip := .addressReady }
      else m
  | .installRoute s metric =>
      if s == slot then
        { m with
          ip := .routeInstalled
          routeMetric := metric }
      else m
  | .removeRoute s =>
      if s == slot then
        { m with
          ip := if m.ip == .routeInstalled then .addressReady else m.ip }
      else m
  | .powerCycle s =>
      if s == slot then
        { m with
          power := .cycling
          presence := .absent
          data := .disconnected
          ip := .none
          health := .unknown
          powerCycles := m.powerCycles + 1
          cooldown := true }
      else m
  | _ => m

def System.applyAction (action : Action) (s : System) : System :=
  match action with
  | .restartService service => s.withService service .running
  | .reconcileRoutes => { s with routesStale := false }
  | .syncClock => { s with clock := .syncing }
  | _ => s

def applyPlan (p : Plan) (w : World) : World :=
  if p.hasForceReboot then
    observe w .rebootCompleted
  else
    let external := (Modem.applyAction .external p.sara
      (Modem.applyAction .external p.external w.external))
    let sara := (Modem.applyAction .sara p.sara
      (Modem.applyAction .sara p.external w.sara))
    let routesStale :=
      if p.external.touchesRoutes || p.sara.touchesRoutes || p.system.touchesRoutes then
        false
      else
        w.system.routesStale
    let system := System.applyAction p.system { w.system with routesStale := routesStale }
    { w with external := external, sara := sara, system := system }

def applyDecision (d : Defaults) (w : World) : World × Plan :=
  let plan := decide d w
  (applyPlan plan w, plan)

def closedStep (d : Defaults) (w : World) (event : Event) : World × Plan :=
  applyDecision d (observe w event)

def runClosed (d : Defaults) (w : World) : List Event -> World
  | [] => w
  | event :: rest => runClosed d (closedStep d w event).1 rest

end X8Cellulard
