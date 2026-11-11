//! The risk the design named first: the headless context runs GPUI on a test scheduler. A
//! foreground task waiting on a channel that a Tokio thread feeds, after real time passes, must
//! still wake and run once the rig ticks the scheduler again.

use gpui_kit::*;
use std::cell::Cell;
use std::prelude::rust_2024::test;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[test]
fn a_foreground_task_wakes_from_a_tokio_thread() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let cx = HeadlessAppContext::with_platform(
        gpui_kit::platform::current_platform(true).text_system(),
        Arc::new(()),
        || Ok(None),
    );
    cx.allow_parking();
    let (sender, receiver) = async_channel::unbounded::<u32>();
    let seen = Rc::new(Cell::new(0u32));
    let task_seen = seen.clone();
    let task = cx.foreground_executor.spawn(async move {
        while let Ok(value) = receiver.recv().await {
            task_seen.set(task_seen.get() + value);
        }
    });
    runtime.spawn(async move {
        for _ in 0..3 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            sender.send(1).await.unwrap();
        }
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while seen.get() < 3 {
        cx.run_until_parked();
        assert!(Instant::now() < deadline, "woke {} of 3 times", seen.get());
        std::thread::yield_now();
    }
    drop(task);
}
