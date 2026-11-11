# Runtime shared by the Electron baseline and the native spike: same distro,
# same Xvfb, same software Vulkan (lavapipe), so a comparison isn't also a
# comparison of two userlands. pacman -Syu floats, so results.json records the
# versions that were actually installed (env.packages).
FROM archlinux:latest

RUN pacman -Syu --noconfirm --needed \
      alsa-lib at-spi2-core dbus file gtk3 libcups libnotify libsecret libxss \
      mesa noto-fonts noto-fonts-emoji nss nodejs npm python python-jsonschema \
      ttf-dejavu util-linux vulkan-icd-loader vulkan-swrast vulkan-tools \
      xdotool xorg-server-xvfb xorg-xauth xorg-xwininfo \
  && rm -rf /var/cache/pacman/pkg/*

# Driver (playwright-core, same version as frontend's @playwright/test) and
# synthetic publishers. The sources are mounted at /opt/baseline/src, so they
# resolve these from /opt/baseline/node_modules.
RUN mkdir -p /opt/baseline && cd /opt/baseline \
  && npm init -y >/dev/null && npm pkg set type=module \
  && npm install --no-audit --no-fund \
       playwright-core@1.64.0 @livekit/rtc-node@1.2.1 livekit-server-sdk@2
