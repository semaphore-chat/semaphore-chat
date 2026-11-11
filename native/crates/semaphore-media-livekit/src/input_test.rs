//! W4: the settings page's mic test: the input's level for the meter, and optionally the mic played
//! back on the output (loopback), with the processing the call would use. Outside a call only.
//!
//! A stub until W4-media: starting one says it can't.

use crate::LiveKitEngine;

/// A running mic test. Dropping it stops the test and closes the mic.
pub struct InputTest {
    _private: (),
}

impl InputTest {
    /// The input's level now, 0.0 (silence) to 1.0 (full scale), for `set_mic_level`.
    pub fn level(&self) -> f32 {
        0.0
    }
}

impl LiveKitEngine {
    /// Opens the selected input for a test. With `loopback`, it's also played on the selected
    /// output. Fails during a call, or when the device can't open, with why.
    pub fn start_input_test(&self, _loopback: bool) -> Result<InputTest, String> {
        Err("the mic test isn't available yet".into())
    }
}
