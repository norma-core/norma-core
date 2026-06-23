import X8Cellulard.Actuation

namespace X8Cellulard

inductive Failure where
  | commandTimeout
  | commandFailed
  | permissionDenied
  | resourceUnavailable
  | rebootFailed
  deriving DecidableEq, Repr

structure FailedAction where
  action : Action
  failure : Failure
  deriving Repr

def Modem.applyFailedAction (slot : Slot) (action : Action) (failure : Failure)
    (m : Modem) : Modem :=
  match action with
  | .powerOn s =>
      if s == slot then
        { m with
          presence := .vanished
          health := .failed
          recoveryAttempts := m.recoveryAttempts + 1 }
      else m
  | .reconnect s =>
      if s == slot then
        { m with
          data := .failed
          health := .failed
          recoveryAttempts := m.recoveryAttempts + 1 }
      else m
  | .connect s =>
      if s == slot then
        { m with
          data := .failed
          ip := .none
          health := .failed
          recoveryAttempts := m.recoveryAttempts + 1 }
      else m
  | .configureIp s =>
      if s == slot then
        { m with
          ip := .failed
          health := .failed
          recoveryAttempts := m.recoveryAttempts + 1 }
      else m
  | .installRoute s _metric =>
      if s == slot then
        { m with
          ip := .addressReady
          health := .failed
          recoveryAttempts := m.recoveryAttempts + 1 }
      else m
  | .removeRoute s =>
      if s == slot then
        { m with recoveryAttempts := m.recoveryAttempts + 1 }
      else m
  | .powerCycle s =>
      if s == slot then
        match failure with
        | .permissionDenied =>
            { m with
              health := .failed
              recoveryAttempts := m.recoveryAttempts + 1 }
        | _ =>
            { m with
              presence := .vanished
              health := .failed
              recoveryAttempts := m.recoveryAttempts + 1 }
      else m
  | _ => m

def System.applyFailedAction (action : Action) (failure : Failure)
    (s : System) : System :=
  match action with
  | .restartService service =>
      let failedState :=
        match failure with
        | .commandTimeout => .hung
        | _ => .crashed
      s.withService service failedState
  | .reconcileRoutes =>
      { s with routesStale := true }
  | .syncClock =>
      { s with clock := .failed }
  | .forceReboot _ =>
      { s with platform := .fatal }
  | .powerOn _ | .powerCycle _ =>
      match failure with
      | .permissionDenied => { s with platform := .fatal }
      | .resourceUnavailable => { s with resources := .cannotFork }
      | _ => { s with platform := .lowPowerSuspected }
  | .installRoute _ _ | .removeRoute _ | .configureIp _ =>
      match failure with
      | .resourceUnavailable => { s with resources := .cannotFork }
      | _ => s
  | .reconnect _ | .connect _ | .hold _ _ | .noOp => s

def applyFailedAction (failed : FailedAction) (w : World) : World :=
  let external := Modem.applyFailedAction .external failed.action failed.failure w.external
  let sara := Modem.applyFailedAction .sara failed.action failed.failure w.sara
  let system := System.applyFailedAction failed.action failed.failure w.system
  { w with external := external, sara := sara, system := system }

def applyPlanWithFailures (p : Plan) (failures : List FailedAction)
    (w : World) : World :=
  let attempted := applyPlan p w
  failures.foldl (fun acc failed => applyFailedAction failed acc) attempted

end X8Cellulard
