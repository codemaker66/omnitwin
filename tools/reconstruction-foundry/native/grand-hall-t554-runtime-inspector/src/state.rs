use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemovalDecision {
    Invoke(usize),
    AlreadyRemoved,
}

#[derive(Debug)]
enum HandleState {
    Active(usize),
    Removed,
}

#[derive(Debug)]
pub(crate) struct DirectoryHandleState {
    state: Mutex<HandleState>,
}

impl DirectoryHandleState {
    pub(crate) fn new(cookie: usize) -> Result<Self, &'static str> {
        if cookie == 0 {
            return Err("the Windows DLL-directory cookie must be non-zero");
        }
        Ok(Self {
            state: Mutex::new(HandleState::Active(cookie)),
        })
    }

    pub(crate) fn remove_with(
        &self,
        remove: impl FnOnce(usize) -> Result<(), String>,
    ) -> Result<RemovalDecision, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "the DLL-directory handle lock is poisoned".to_owned())?;
        let HandleState::Active(cookie) = *state else {
            return Ok(RemovalDecision::AlreadyRemoved);
        };

        remove(cookie)?;
        *state = HandleState::Removed;
        Ok(RemovalDecision::Invoke(cookie))
    }

    pub(crate) fn is_active(&self) -> Result<bool, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "the DLL-directory handle lock is poisoned".to_owned())?;
        Ok(matches!(*state, HandleState::Active(_)))
    }
}

#[cfg(test)]
mod tests {
    use super::{DirectoryHandleState, RemovalDecision};
    use std::cell::Cell;

    #[test]
    fn non_zero_cookie_is_required() {
        assert!(DirectoryHandleState::new(0).is_err());
    }

    #[test]
    fn successful_removal_is_one_shot() {
        let handle = DirectoryHandleState::new(42).expect("valid handle");
        let calls = Cell::new(0);

        let first = handle
            .remove_with(|cookie| {
                assert_eq!(cookie, 42);
                calls.set(calls.get() + 1);
                Ok(())
            })
            .expect("first removal succeeds");
        let second = handle
            .remove_with(|_| {
                calls.set(calls.get() + 1);
                Ok(())
            })
            .expect("second removal is an idempotent observation");

        assert_eq!(first, RemovalDecision::Invoke(42));
        assert_eq!(second, RemovalDecision::AlreadyRemoved);
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn failed_removal_remains_active_for_cleanup_retry() {
        let handle = DirectoryHandleState::new(7).expect("valid handle");
        assert!(handle
            .remove_with(|_| Err("synthetic failure".to_owned()))
            .is_err());

        assert_eq!(
            handle.remove_with(|_| Ok(())).expect("retry succeeds"),
            RemovalDecision::Invoke(7)
        );
    }

    #[test]
    fn active_state_tracks_successful_removal() {
        let handle = DirectoryHandleState::new(11).expect("valid handle");
        assert!(handle.is_active().expect("state is readable"));
        handle.remove_with(|_| Ok(())).expect("removal succeeds");
        assert!(!handle.is_active().expect("state is readable"));
    }
}
