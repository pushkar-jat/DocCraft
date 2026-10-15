use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Cancellation flags for running native jobs, keyed by a frontend-generated job id.
#[derive(Default)]
pub struct Jobs {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Jobs {
    pub fn register(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.lock().insert(id.to_owned(), flag.clone());
        flag
    }

    pub fn finish(&self, id: &str) {
        self.lock().remove(id);
    }

    /// Returns false if no job with that id is running (already finished or never started).
    pub fn cancel(&self, id: &str) -> bool {
        match self.lock().get(id) {
            Some(flag) => {
                flag.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.flags.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_sets_the_registered_flag_until_finished() {
        let jobs = Jobs::default();
        let flag = jobs.register("a");
        assert!(!flag.load(Ordering::SeqCst));
        assert!(jobs.cancel("a"));
        assert!(flag.load(Ordering::SeqCst));
        jobs.finish("a");
        assert!(!jobs.cancel("a"));
    }
}
