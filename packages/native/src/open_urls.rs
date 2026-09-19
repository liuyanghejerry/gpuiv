//! GPUI open requests can arrive during `run_embedded`, before JS can arm
//! its callback. Keep those batches in order at the FFI boundary. GPUI owns
//! OS delivery; this queue only bridges the Rust-to-JS registration gap.

use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

#[derive(Default)]
pub(crate) struct OpenUrls {
    callback: Option<ThreadsafeFunction<Vec<String>>>,
    pending: Vec<Vec<String>>,
}

impl OpenUrls {
    pub(crate) const fn new() -> Self {
        Self {
            callback: None,
            pending: Vec::new(),
        }
    }

    pub(crate) fn emit(&mut self, urls: Vec<String>) {
        if urls.is_empty() {
            return;
        }
        if let Some(callback) = &self.callback {
            callback.call(Ok(urls), ThreadsafeFunctionCallMode::NonBlocking);
        } else {
            self.pending.push(urls);
        }
    }

    pub(crate) fn register(&mut self, callback: Option<ThreadsafeFunction<Vec<String>>>) {
        self.callback = callback;
        if let Some(callback) = &self.callback {
            for urls in self.pending.drain(..) {
                callback.call(Ok(urls), ThreadsafeFunctionCallMode::NonBlocking);
            }
        }
    }
}
