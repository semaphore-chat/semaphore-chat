//! A window around one view, recording what it emits: for the W2 views' tests.

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    AnyWindowHandle, AppContext as _, Bounds, Context, Entity, EventEmitter, Point, Render,
    TestAppContext, Window, WindowBounds, WindowOptions, px, size,
};
use std::cell::RefCell;
use std::rc::Rc;

pub(crate) struct Rig<V: 'static, E: 'static> {
    pub window: AnyWindowHandle,
    pub view: Entity<V>,
    pub events: Rc<RefCell<Vec<E>>>,
}

/// Opens a `width` x 800 window on the view `build` makes.
pub(crate) fn rig<V, E>(
    cx: &mut TestAppContext,
    width: f32,
    build: impl FnOnce(&mut Window, &mut Context<V>) -> V,
) -> Rig<V, E>
where
    V: Render + EventEmitter<E> + 'static,
    E: Clone + 'static,
{
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        crate::kit::set_reduced_motion(true, cx);
    });
    let events = Rc::new(RefCell::new(Vec::new()));
    let log = events.clone();
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Point::default(),
            size: size(px(width), px(800.)),
        })),
        ..Default::default()
    };
    let (window, view) = cx.update(|cx| {
        let mut made = None;
        let handle = gpui_kit::open_window(options, cx, |window, cx| {
            let view = cx.new(|cx| build(window, cx));
            cx.subscribe(&view, move |_, event: &E, _| {
                log.borrow_mut().push(event.clone());
            })
            .detach();
            made = Some(view.clone());
            view
        })
        .expect("window");
        (handle.0, made.expect("built"))
    });
    Rig {
        window,
        view,
        events,
    }
}

impl<V: 'static, E: Clone + 'static> Rig<V, E> {
    /// Runs `f` between two frames, then lets everything settle.
    pub fn with<R>(
        &self,
        cx: &mut TestAppContext,
        f: impl FnOnce(&Entity<V>, &mut Window, &mut gpui_kit::App) -> R,
    ) -> R {
        let out = cx
            .update_window(self.window, |_, window, cx| {
                window.render_frame(cx);
                let out = f(&self.view, window, cx);
                window.render_frame(cx);
                out
            })
            .expect("window");
        cx.run_until_parked();
        out
    }

    /// A click on the element with this id.
    pub fn click(&self, cx: &mut TestAppContext, id: &str) {
        let id = id.to_owned();
        self.with(cx, move |_, window, cx| window.click(id, cx));
    }

    /// Whether an element with this id is drawn.
    pub fn has(&self, cx: &mut TestAppContext, id: &str) -> bool {
        let id = id.to_owned();
        self.with(cx, move |_, window, _| window.try_find(id).is_some())
    }

    pub fn events(&self) -> Vec<E> {
        self.events.borrow().clone()
    }

    pub fn clear(&self) {
        self.events.borrow_mut().clear();
    }
}
