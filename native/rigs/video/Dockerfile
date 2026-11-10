# The pinned build image plus libyuv (the rig's "today" arms convert with it, as Zed does) and
# ffmpeg (generates the clips). Same archive snapshot as the base, so nothing else moves.
ARG BASE
FROM ${BASE}
USER root
RUN pacman -S --noconfirm --needed libyuv ffmpeg && rm -rf /var/cache/pacman/pkg/*
