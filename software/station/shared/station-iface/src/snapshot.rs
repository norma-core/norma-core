use std::sync::{Arc, Condvar, Mutex};

/// Wakes the `inference-states` writer. Writes made while a [`SnapshotHold`] is alive
/// reach it as one snapshot.
#[derive(Clone, Default)]
pub struct SnapshotGate(Arc<Inner>);

#[derive(Default)]
struct Inner {
    state: Mutex<State>,
    cvar: Condvar,
}

#[derive(Default)]
struct State {
    changed: bool,
    held: usize,
    closed: bool,
}

pub struct SnapshotHold(SnapshotGate);

impl SnapshotGate {
    pub fn hold(&self) -> SnapshotHold {
        self.0.state.lock().unwrap().held += 1;
        SnapshotHold(self.clone())
    }

    pub fn changed(&self) {
        let mut state = self.0.state.lock().unwrap();
        state.changed = true;
        if state.held == 0 {
            self.0.cvar.notify_one();
        }
    }

    pub fn close(&self) {
        self.0.state.lock().unwrap().closed = true;
        self.0.cvar.notify_one();
    }

    /// Blocks until something changed and no hold is open; false once closed.
    pub fn wait(&self) -> bool {
        let mut state = self.0.state.lock().unwrap();
        while !state.closed && (!state.changed || state.held > 0) {
            state = self.0.cvar.wait(state).unwrap();
        }
        state.changed = false;
        !state.closed
    }
}

impl Drop for SnapshotHold {
    fn drop(&mut self) {
        let inner = &(self.0).0;
        let mut state = inner.state.lock().unwrap();
        state.held -= 1;
        if state.held == 0 && state.changed {
            inner.cvar.notify_one();
        }
    }
}
