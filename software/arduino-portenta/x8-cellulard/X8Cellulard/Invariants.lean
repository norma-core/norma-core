import X8Cellulard.Policy

namespace X8Cellulard

theorem preferred_external_when_usable (w : World)
    (h : w.externalUsable = true) :
    w.preferredSlot = .external := by
  simp [World.preferredSlot, h]

theorem preferred_sara_when_external_down_sara_usable (w : World)
    (he : w.externalUsable = false)
    (hs : w.saraUsable = true) :
    w.preferredSlot = .sara := by
  simp [World.preferredSlot, he, hs]

theorem rebootReason_none_when_any_usable (d : Defaults) (w : World)
    (h : w.anyUsable = true) :
    rebootReason? d w = none := by
  simp [rebootReason?, h]

theorem decide_never_reboots_when_any_usable (d : Defaults) (w : World)
    (h : w.anyUsable = true) :
    (decide d w).hasForceReboot = false := by
  unfold decide
  simp [h]
  unfold routePlan Plan.hasForceReboot Action.isForceReboot
  cases he : w.externalUsable <;> cases hs : w.saraUsable <;>
    cases hsync : w.system.needsTimeSync <;>
    simp [he, hs, World.anyUsable] at h ⊢

theorem recover_nonrecoverable_does_not_power_cycle (slot : Slot) (m : Modem)
    (h : m.nonRecoverable = true) :
    (recoverModem slot m).hardCyclesAny = false := by
  by_cases hc : m.canCarryTraffic = true
  · simp [recoverModem, hc, Action.hardCyclesAny, Action.hardCyclesSlot]
  · by_cases hmissing : m.sim = .missing
    · simp [recoverModem, hc, h, hmissing, Action.hardCyclesAny, Action.hardCyclesSlot]
    · by_cases hpin : m.sim = .pinRequired
      · simp [recoverModem, hc, h, hpin, Action.hardCyclesAny, Action.hardCyclesSlot]
      · by_cases hpuk : m.sim = .pukRequired
        · simp [recoverModem, hc, h, hpuk, Action.hardCyclesAny, Action.hardCyclesSlot]
        · by_cases hfailed : m.sim = .failed
          · simp [recoverModem, hc, h, hfailed, Action.hardCyclesAny, Action.hardCyclesSlot]
          · by_cases hapn : m.data = .apnRejected
            · simp [recoverModem, hc, h, hmissing, hpin, hpuk, hfailed, hapn, Action.hardCyclesAny, Action.hardCyclesSlot]
            · simp [recoverModem, hc, h, hmissing, hpin, hpuk, hfailed, hapn, Action.hardCyclesAny, Action.hardCyclesSlot]

theorem recoverBoth_never_hard_cycles_both (w : World) :
    (recoverBoth w).hasDualHardCycle = false := by
  unfold recoverBoth Plan.hasDualHardCycle
  cases he : (recoverModem Slot.external w.external).hardCyclesAny <;>
    cases hs : (recoverModem Slot.sara w.sara).hardCyclesAny <;>
    simp [he, hs]
  simp [Action.hardCyclesAny, Action.hardCyclesSlot]

end X8Cellulard
