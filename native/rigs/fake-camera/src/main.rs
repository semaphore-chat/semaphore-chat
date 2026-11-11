//! A camera for headless tests: a PipeWire `Video/Source` node with `media.role = Camera`, as
//! WirePlumber makes of a real webcam, offering one fixed mode (YUY2 640x480 at 30 fps), and
//! driving the graph itself at that rate. The picture is a horizontal luma ramp that moves one
//! step per frame, with neutral chroma: the mean luma changes a little every frame.
//!
//! `videotestsrc` can't stand in: it offers its sizes and rates as ranges, and libwebrtc keeps
//! only cameras whose modes it can list.
//!
//!   rig-fake-camera            runs until killed

#[cfg(target_os = "linux")]
fn main() -> Result<(), pipewire::Error> {
    linux::run()
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("rig-fake-camera is Linux only");
    std::process::exit(2);
}

#[cfg(target_os = "linux")]
mod linux {
    use pipewire as pw;
    use pw::properties::properties;
    use pw::spa;
    use spa::pod::{Object, Property, PropertyFlags, Value};
    use spa::utils::{Fraction, Id, Rectangle};
    use std::time::Duration;

    const WIDTH: u32 = 640;
    const HEIGHT: u32 = 480;
    const FPS: u32 = 30;
    /// YUY2: two bytes a pixel.
    const STRIDE: u32 = WIDTH * 2;

    fn property(key: u32, value: Value) -> Property {
        Property {
            key,
            flags: PropertyFlags::empty(),
            value,
        }
    }

    fn pod_bytes(type_: u32, id: u32, properties: Vec<Property>) -> Vec<u8> {
        spa::pod::serialize::PodSerializer::serialize(
            std::io::Cursor::new(Vec::new()),
            &Value::Object(Object {
                type_,
                id,
                properties,
            }),
        )
        .expect("a pod serializes")
        .0
        .into_inner()
    }

    /// Buffers big enough for a frame: the consumer (libwebrtc) leaves their size to us.
    fn buffers() -> Vec<u8> {
        let int = |key, value: u32| property(key, Value::Int(value as i32));
        pod_bytes(
            spa::sys::SPA_TYPE_OBJECT_ParamBuffers,
            spa::sys::SPA_PARAM_Buffers,
            vec![
                int(spa::sys::SPA_PARAM_BUFFERS_buffers, 8),
                int(spa::sys::SPA_PARAM_BUFFERS_blocks, 1),
                int(spa::sys::SPA_PARAM_BUFFERS_size, STRIDE * HEIGHT),
                int(spa::sys::SPA_PARAM_BUFFERS_stride, STRIDE),
                int(
                    spa::sys::SPA_PARAM_BUFFERS_dataType,
                    (1 << spa::sys::SPA_DATA_MemPtr) | (1 << spa::sys::SPA_DATA_MemFd),
                ),
            ],
        )
    }

    /// A header on every buffer, as a real camera's buffers have: libwebrtc reads its flags.
    fn header_meta() -> Vec<u8> {
        pod_bytes(
            spa::sys::SPA_TYPE_OBJECT_ParamMeta,
            spa::sys::SPA_PARAM_Meta,
            vec![
                property(
                    spa::sys::SPA_PARAM_META_type,
                    Value::Id(Id(spa::sys::SPA_META_Header)),
                ),
                property(
                    spa::sys::SPA_PARAM_META_size,
                    Value::Int(std::mem::size_of::<spa::sys::spa_meta_header>() as i32),
                ),
            ],
        )
    }

    pub fn run() -> Result<(), pw::Error> {
        pw::init();
        let mainloop = pw::main_loop::MainLoopRc::new(None)?;
        let context = pw::context::ContextRc::new(&mainloop, None)?;
        let core = context.connect_rc(None)?;
        let stream = pw::stream::StreamRc::new(
            core,
            "rig-camera",
            properties! {
                *pw::keys::MEDIA_TYPE => "Video",
                *pw::keys::MEDIA_CLASS => "Video/Source",
                *pw::keys::MEDIA_ROLE => "Camera",
                *pw::keys::NODE_NAME => "rig-camera",
                *pw::keys::NODE_DESCRIPTION => "Rig camera",
            },
        )?;

        let _listener = stream
            .add_local_listener_with_user_data(0u32)
            .param_changed(|stream, _, id, param| {
                if id == spa::sys::SPA_PARAM_Format && param.is_some() {
                    let (buffers, meta) = (buffers(), header_meta());
                    let parse = |bytes| spa::pod::Pod::from_bytes(bytes).expect("a pod parses");
                    let _ = stream.update_params(&mut [parse(&buffers), parse(&meta)]);
                }
            })
            .process(|stream, frame| {
                let Some(mut buffer) = stream.dequeue_buffer() else {
                    return;
                };
                let Some(data) = buffer.datas_mut().first_mut() else {
                    return;
                };
                let size = (STRIDE * HEIGHT) as usize;
                if let Some(bytes) = data.data() {
                    if bytes.len() < size {
                        return;
                    }
                    for row in bytes[..size].as_chunks_mut::<{ STRIDE as usize }>().0 {
                        for (x, pixel) in row.as_chunks_mut::<4>().0.iter_mut().enumerate() {
                            // Y0 U Y1 V for pixels 2x and 2x+1.
                            let luma = ((2 * x as u32 + *frame) % 256) as u8;
                            pixel.copy_from_slice(&[luma, 128, luma.wrapping_add(1), 128]);
                        }
                    }
                }
                let chunk = data.chunk_mut();
                *chunk.offset_mut() = 0;
                *chunk.stride_mut() = STRIDE as i32;
                *chunk.size_mut() = size as u32;
                *frame = frame.wrapping_add(1);
            })
            .register()?;

        let bytes = pod_bytes(
            spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
            spa::param::ParamType::EnumFormat.as_raw(),
            vec![
                property(
                    spa::sys::SPA_FORMAT_mediaType,
                    Value::Id(Id(spa::sys::SPA_MEDIA_TYPE_video)),
                ),
                property(
                    spa::sys::SPA_FORMAT_mediaSubtype,
                    Value::Id(Id(spa::sys::SPA_MEDIA_SUBTYPE_raw)),
                ),
                property(
                    spa::sys::SPA_FORMAT_VIDEO_format,
                    Value::Id(Id(spa::sys::SPA_VIDEO_FORMAT_YUY2)),
                ),
                property(
                    spa::sys::SPA_FORMAT_VIDEO_size,
                    Value::Rectangle(Rectangle {
                        width: WIDTH,
                        height: HEIGHT,
                    }),
                ),
                property(
                    spa::sys::SPA_FORMAT_VIDEO_framerate,
                    Value::Fraction(Fraction { num: FPS, denom: 1 }),
                ),
            ],
        );
        let pod = spa::pod::Pod::from_bytes(&bytes).expect("a format pod parses");
        // A driver: no sound card or other device clocks this graph, so the camera does, as a
        // real one does with its own sensor clock.
        stream.connect(
            spa::utils::Direction::Output,
            None,
            pw::stream::StreamFlags::DRIVER | pw::stream::StreamFlags::MAP_BUFFERS,
            &mut [pod],
        )?;

        let ticker = stream.clone();
        let timer = mainloop.loop_().add_timer(move |_| {
            let _ = ticker.trigger_process();
        });
        let period = Duration::from_nanos(1_000_000_000 / FPS as u64);
        timer
            .update_timer(Some(period), Some(period))
            .into_result()?;
        println!("rig-fake-camera: {WIDTH}x{HEIGHT} YUY2 at {FPS} fps");
        mainloop.run();
        Ok(())
    }
}
