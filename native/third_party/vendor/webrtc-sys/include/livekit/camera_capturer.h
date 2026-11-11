/*
 * Semaphore patch: libwebrtc's VideoCaptureModule (cameras) for Rust. PipeWire or V4L2 on
 * Linux, DirectShow on Windows. Frames go to a NativeVideoSink, as a remote track's do.
 * Licensed under the Apache License, Version 2.0, like the rest of this crate.
 */

#pragma once

#include <condition_variable>
#include <memory>
#include <mutex>

#include "api/scoped_refptr.h"
#include "livekit/video_track.h"
#include "modules/video_capture/video_capture.h"
#include "rust/cxx.h"
#if defined(WEBRTC_LINUX)
#include "modules/video_capture/video_capture_options.h"
#endif

namespace livekit_ffi {
class CameraCapturer;
struct CameraCapturerOptions;
struct CameraDevice;
struct CameraCapability;
}  // namespace livekit_ffi

#include "webrtc-sys/src/camera_capturer.rs.h"

namespace livekit_ffi {

// Linux needs VideoCaptureOptions (PipeWire or V4L2) and waits for it to
// initialize; elsewhere the factory needs nothing.
class CameraCapturer
#if defined(WEBRTC_LINUX)
    : public webrtc::VideoCaptureOptions::Callback
#endif
{
 public:
  explicit CameraCapturer(CameraCapturerOptions options);
  ~CameraCapturer();

  // 0 when ready; otherwise a webrtc::VideoCaptureOptions::Status, or
  // kInitTimedOut.
  int32_t init_status() const { return status_; }
  rust::Vec<CameraDevice> devices() const;
  bool start(rust::Str unique_id,
             CameraCapability capability,
             std::shared_ptr<NativeVideoSink> sink) const;
  void stop() const;
  bool is_capturing() const;

#if defined(WEBRTC_LINUX)
  void OnInitialized(webrtc::VideoCaptureOptions::Status status) override;
#endif

 private:
#if defined(WEBRTC_LINUX)
  void wait_for_init(uint32_t timeout_ms);
#endif
  webrtc::VideoCaptureModule::DeviceInfo* device_info() const;

  mutable std::mutex mutex_;
  std::condition_variable initialized_;
  bool init_done_ = false;
  int32_t status_ = 0;
#if defined(WEBRTC_LINUX)
  std::unique_ptr<webrtc::VideoCaptureOptions> options_;
#endif
  mutable std::unique_ptr<webrtc::VideoCaptureModule::DeviceInfo> info_;
  mutable webrtc::scoped_refptr<webrtc::VideoCaptureModule> module_;
  mutable std::shared_ptr<NativeVideoSink> sink_;
};

std::unique_ptr<CameraCapturer> new_camera_capturer(
    CameraCapturerOptions options);

}  // namespace livekit_ffi
