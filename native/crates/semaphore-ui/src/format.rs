//! Display formatting shared by every screen, matching `frontend/src/utils/format.ts`.
//!
//! The web client formats a byte count in one place, `formatFileSize`, and every screen that
//! shows one — the attachment chip, the player's size badge, the clip library, the admin
//! dashboard and storage screens, upload limits — reads it from there. So does the native client,
//! through [`file_size`].

/// `formatFileSize`: 1024 steps from bytes to petabytes, at most two decimals, "0 Bytes" for
/// nothing. A whole number prints bare, as the web's `Math.round(x * 100) / 100` stringifies.
pub fn file_size(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
    if bytes == 0 {
        return "0 Bytes".to_owned();
    }
    let value = bytes as f64;
    // The step the web's `Math.floor(Math.log(bytes) / Math.log(1024))` finds, counted rather
    // than logged: an exact power of 1024 must land in the larger unit, which the log cannot
    // promise in floating point.
    let mut unit = 0;
    while unit + 1 < UNITS.len() && value >= 1024f64.powi(unit as i32 + 1) {
        unit += 1;
    }
    let scaled = (value / 1024f64.powi(unit as i32) * 100.).round() / 100.;
    format!("{scaled} {}", UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    const K: u64 = 1024;
    const M: u64 = K * K;
    const G: u64 = M * K;
    const T: u64 = G * K;
    const P: u64 = T * K;

    #[test]
    fn nothing_is_zero_bytes() {
        assert_eq!(file_size(0), "0 Bytes");
    }

    #[test]
    fn bytes_below_a_kilobyte_count_whole_bytes() {
        assert_eq!(file_size(1), "1 Bytes");
        assert_eq!(file_size(500), "500 Bytes");
        assert_eq!(file_size(999), "999 Bytes");
        assert_eq!(file_size(K - 1), "1023 Bytes");
    }

    #[test]
    fn each_unit_starts_at_its_own_power_and_rounds_to_two_decimals() {
        assert_eq!(file_size(K), "1 KB");
        assert_eq!(file_size(K + 1), "1 KB");
        assert_eq!(file_size(K + K / 2), "1.5 KB");
        assert_eq!(file_size(K + K / 3), "1.33 KB");
        assert_eq!(file_size(M - 1), "1024 KB");
        assert_eq!(file_size(M), "1 MB");
        assert_eq!(file_size(M + 1), "1 MB");
        assert_eq!(file_size(M + M / 2), "1.5 MB");
        assert_eq!(file_size(G - 1), "1024 MB");
        assert_eq!(file_size(G), "1 GB");
        assert_eq!(file_size(G + 1), "1 GB");
        assert_eq!(file_size(T - 1), "1024 GB");
        assert_eq!(file_size(T), "1 TB");
        assert_eq!(file_size(T + 1), "1 TB");
        assert_eq!(file_size(P - 1), "1024 TB");
        assert_eq!(file_size(P), "1 PB");
        assert_eq!(file_size(P + 1), "1 PB");
    }

    #[test]
    fn decimals_round_as_the_web_rounds_them() {
        // As the web's formatter does: 2^20 - 512 bytes is 1023.5 KB, which keeps its half.
        assert_eq!(file_size(M - 512), "1023.5 KB");
        assert_eq!(file_size(5 * M + 300_000), "5.29 MB");
        assert_eq!(file_size(3_350_000), "3.19 MB");
    }

    #[test]
    fn the_web_clients_own_examples() {
        // `frontend/src/__tests__/utils/format.test.ts`, case for case.
        assert_eq!(file_size(0), "0 Bytes");
        assert_eq!(file_size(500), "500 Bytes");
        assert_eq!(file_size(1024), "1 KB");
        assert_eq!(file_size(1536), "1.5 KB");
        assert_eq!(file_size(1_048_576), "1 MB");
        assert_eq!(file_size(10 * 1_048_576), "10 MB");
        assert_eq!(file_size(524_288_000), "500 MB");
        assert_eq!(file_size(1_073_741_824), "1 GB");
        assert_eq!(file_size(1024u64.pow(4)), "1 TB");
    }

    #[test]
    fn very_large_counts_stay_in_petabytes() {
        assert_eq!(file_size(1024u64.pow(5) * 3), "3 PB");
        assert_eq!(file_size(1024u64.pow(6)), "1024 PB");
        assert_eq!(file_size(u64::MAX), "16384 PB");
    }
}
