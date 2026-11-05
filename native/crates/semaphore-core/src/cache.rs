//! Query cache: the TanStack Query analog. It lives here rather than on GPUI entities
//! so a future mobile UI reads the same state; a UI only holds a projection of it.
//!
//! Unit U5 replaces JSON text with typed entries, because a direct update would otherwise reparse
//! on every event. Message rows don't live here at all, but in `store`. A UI never reads this
//! type directly, so that change doesn't reach the frozen API in `model` and `commands`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Hierarchical key, like a TanStack Query key: `["channels", "<id>", "messages"]`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct QueryKey {
    pub segments: Vec<String>,
}

impl QueryKey {
    pub fn new(segments: &[&str]) -> Self {
        Self {
            segments: segments.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    pub fn starts_with(&self, prefix: &QueryKey) -> bool {
        self.segments.starts_with(&prefix.segments)
    }
}

/// A cached response, kept as JSON text so it crosses an FFI boundary unchanged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheEntry {
    pub json: String,
    pub fetched_at_ms: u64,
    pub stale: bool,
}

#[derive(Debug, Default)]
pub struct QueryCache {
    entries: BTreeMap<QueryKey, CacheEntry>,
}

impl QueryCache {
    pub fn set(&mut self, key: QueryKey, json: String, fetched_at_ms: u64) {
        let entry = CacheEntry {
            json,
            fetched_at_ms,
            stale: false,
        };
        self.entries.insert(key, entry);
    }

    pub fn get(&self, key: &QueryKey) -> Option<&CacheEntry> {
        self.entries.get(key)
    }

    /// Marks matching entries stale, keeping their data so a UI can show it while a
    /// refetch runs. Returns the keys it marked.
    pub fn invalidate_prefix(&mut self, prefix: &QueryKey) -> Vec<QueryKey> {
        let mut marked = Vec::new();
        for (key, entry) in &mut self.entries {
            if key.starts_with(prefix) {
                entry.stale = true;
                marked.push(key.clone());
            }
        }
        marked
    }

    pub fn invalidate_all(&mut self) -> Vec<QueryKey> {
        self.invalidate_prefix(&QueryKey { segments: vec![] })
    }

    pub fn stale_keys(&self) -> Vec<QueryKey> {
        self.entries
            .iter()
            .filter(|(_, entry)| entry.stale)
            .map(|(key, _)| key.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalidating_a_prefix_keeps_data_and_leaves_other_keys_fresh() {
        let mut cache = QueryCache::default();
        let messages = QueryKey::new(&["channels", "a", "messages"]);
        let other = QueryKey::new(&["channels", "b", "messages"]);
        cache.set(messages.clone(), "[1]".into(), 10);
        cache.set(other.clone(), "[2]".into(), 10);

        let marked = cache.invalidate_prefix(&QueryKey::new(&["channels", "a"]));

        assert_eq!(marked, vec![messages.clone()]);
        let entry = cache.get(&messages).unwrap();
        assert!(entry.stale);
        assert_eq!(entry.json, "[1]");
        assert!(!cache.get(&other).unwrap().stale);
    }

    #[test]
    fn a_prefix_matches_whole_segments_only() {
        let key = QueryKey::new(&["channels", "ab"]);
        assert!(!key.starts_with(&QueryKey::new(&["channels", "a"])));
        assert!(key.starts_with(&QueryKey::new(&["channels"])));
    }

    #[test]
    fn a_fresh_set_clears_stale() {
        let mut cache = QueryCache::default();
        let key = QueryKey::new(&["me"]);
        cache.set(key.clone(), "1".into(), 1);
        assert_eq!(cache.invalidate_all(), vec![key.clone()]);
        cache.set(key.clone(), "2".into(), 2);
        assert!(cache.stale_keys().is_empty());
    }
}
