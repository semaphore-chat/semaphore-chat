/*
 * Semaphore patch: see include/livekit/camera_capturer.h.
 * Licensed under the Apache License, Version 2.0, like the rest of this crate.
 */

#include "livekit/camera_capturer.h"

#include <chrono>
#include <string>

#include "modules/video_capture/video_capture_factory.h"

namespace livekit_ffi {

namespace {
// Beyond VideoCaptureOptions::Status (0..4).
constexpr int32_t kInitTimedOut = 100;
constexpr uint32_t kNameLength = 1024;
}  // namespace

CameraCapturer::CameraCapturer(CameraCapturerOptions options) {
#if defined(WEBRTC_LINUX)
  options_ = std::make_unique<webrtc::VideoCaptureOptions>();
#if defined(WEBRTC_USE_PIPEWIRE)
  if (options.pipewire) {
    options_->set_allow_pipewire(true);
    // libwebrtc's PipeWire session takes the fd over (pw_context_connect_fd);
    // a negative one makes it ask the camera portal.
    options_->set_pipewire_fd(options.pipewire_fd);
  } else {
    options_->set_allow_v4l2(true);
  }
#else
  options_->set_allow_v4l2(true);
#endif
  options_->Init(this);
  wait_for_init(options.init_timeout_ms);
#else
  // Windows (DirectShow) and the rest need no initialization.
  (void)options;
  init_done_ = true;
#endif
}

CameraCapturer::~CameraCapturer() {
  stop();
  std::lock_guard<std::mutex> lock(mutex_);
  info_.reset();
  module_ = nullptr;
}

#if defined(WEBRTC_LINUX)
void CameraCapturer::OnInitialized(webrtc::VideoCaptureOptions::Status status) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!init_done_) {
    status_ = static_cast<int32_t>(status);
    init_done_ = true;
  }
  initialized_.notify_all();
}

void CameraCapturer::wait_for_init(uint32_t timeout_ms) {
  std::unique_lock<std::mutex> lock(mutex_);
  if (!initialized_.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                             [this] { return init_done_; })) {
    // A late callback only takes the lock and finds init_done_ set.
    status_ = kInitTimedOut;
    init_done_ = true;
  }
}
#endif

webrtc::VideoCaptureModule::DeviceInfo* CameraCapturer::device_info() const {
  if (!info_) {
#if defined(WEBRTC_LINUX)
    info_.reset(webrtc::VideoCaptureFactory::CreateDeviceInfo(options_.get()));
#else
    info_.reset(webrtc::VideoCaptureFactory::CreateDeviceInfo());
#endif
  }
  return info_.get();
}

rust::Vec<CameraDevice> CameraCapturer::devices() const {
  rust::Vec<CameraDevice> devices;
  std::lock_guard<std::mutex> lock(mutex_);
  if (status_ != 0) {
    return devices;
  }
  webrtc::VideoCaptureModule::DeviceInfo* info = device_info();
  if (!info) {
    return devices;
  }
  uint32_t count = info->NumberOfDevices();
  for (uint32_t i = 0; i < count; ++i) {
    char name[kNameLength] = {0};
    char unique_id[kNameLength] = {0};
    if (info->GetDeviceName(i, name, kNameLength, unique_id, kNameLength) != 0) {
      continue;
    }
    CameraDevice device;
    device.name = rust::String(name);
    device.unique_id = rust::String(unique_id);
    int32_t caps = info->NumberOfCapabilities(unique_id);
    for (int32_t c = 0; c < caps; ++c) {
      webrtc::VideoCaptureCapability capability;
      if (info->GetCapability(unique_id, c, capability) != 0) {
        continue;
      }
      device.capabilities.push_back(CameraCapability{
          capability.width, capability.height, capability.maxFPS,
          static_cast<int32_t>(capability.videoType), capability.interlaced});
    }
    devices.push_back(std::move(device));
  }
  return devices;
}

bool CameraCapturer::start(rust::Str unique_id,
                           CameraCapability capability,
                           std::shared_ptr<NativeVideoSink> sink) const {
  std::lock_guard<std::mutex> lock(mutex_);
  if (status_ != 0 || module_) {
    return false;
  }
  std::string id(unique_id.data(), unique_id.size());
#if defined(WEBRTC_LINUX)
  module_ = webrtc::VideoCaptureFactory::Create(options_.get(), id.c_str());
#else
  module_ = webrtc::VideoCaptureFactory::Create(id.c_str());
#endif
  if (!module_) {
    return false;
  }
  sink_ = std::move(sink);
  module_->RegisterCaptureDataCallback(sink_.get());
  webrtc::VideoCaptureCapability requested;
  requested.width = capability.width;
  requested.height = capability.height;
  requested.maxFPS = capability.max_fps;
  requested.videoType = static_cast<webrtc::VideoType>(capability.video_type);
  requested.interlaced = capability.interlaced;
  if (module_->StartCapture(requested) != 0) {
    module_->DeRegisterCaptureDataCallback();
    module_ = nullptr;
    sink_.reset();
    return false;
  }
  return true;
}

void CameraCapturer::stop() const {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!module_) {
    return;
  }
  module_->StopCapture();
  module_->DeRegisterCaptureDataCallback();
  module_ = nullptr;
  sink_.reset();
}

bool CameraCapturer::is_capturing() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return module_ && module_->CaptureStarted();
}

std::unique_ptr<CameraCapturer> new_camera_capturer(
    CameraCapturerOptions options) {
  return std::make_unique<CameraCapturer>(options);
}

}  // namespace livekit_ffi
