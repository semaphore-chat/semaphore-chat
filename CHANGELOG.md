# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.0.3] - 2025-02-11

### Added

- **Reset Default Roles** — Communities can now reset roles back to defaults (#65)
- **Typed API Pipeline** — Shared WebSocket types package and fully typed API client generation (#53)
- **Screen Share Diagnostics** — Diagnostic logging for audio capture failures in screen sharing (#50)
- **Electron Screen Share** — Graceful audio fallback for improved Electron screen sharing

### Changed

- **TanStack Query Migration** — Migrated frontend from RTK Query to TanStack Query v5 (#59)
- **Backend Code Review** — Comprehensive backend code quality improvements (#44, #51)
- **Frontend Beta Readiness** — Frontend polish and readiness fixes (#45)

### Fixed

- **OpenAPI Response Types** — Added remaining response types, eliminating 93+ unknown type generations (#57, #63)
- **Replay Trim UI** — Fixed trim UI bugs, Wayland screen sharing, and Redux messages migration (#64)
- **PIP Auto-Restore** — Fixed auto-restore of picture-in-picture from maximized state on navigation
- **Video Overlay UX** — Improved video overlay interactions and fixed replay message bug (#47)
- **Production Dockerfile** — Fixed workspace layout, dist output path, and start script for production builds

### DevOps

- **GHCR Push on Main** — Docker images now push to GHCR on every push to main

## [0.0.1] - 2025-01-01

### Added

- **Real-time Messaging**
  - WebSocket-based messaging with instant delivery
  - File attachments with drag-and-drop support
  - Message reactions and emoji support
  - @mentions for users and groups (alias groups)
  - Message editing and deletion

- **Voice & Video**
  - LiveKit-powered voice and video calls
  - Screen sharing with system audio capture
  - Replay buffer for screen recording clips
  - Persistent voice connections across navigation

- **Communities**
  - Community-based server organization
  - Text and voice channels
  - Private channels with membership control
  - Community roles and permissions

- **Direct Messages**
  - Private 1:1 and group messaging
  - File attachments in DMs
  - Read receipts and typing indicators

- **User System**
  - User profiles with avatars and banners
  - Online/offline presence tracking
  - Friend system
  - Push-to-talk support

- **Notifications**
  - @mention notifications
  - Do Not Disturb mode
  - Desktop notifications (Electron)
  - Notification settings per channel/DM

- **Admin Dashboard**
  - Instance statistics and monitoring
  - User management (roles, bans)
  - Community management
  - Storage quota management
  - Instance roles configuration

- **Security**
  - JWT-based authentication
  - Role-based access control (RBAC)
  - Private channel membership
  - Instance and community invites

- **Deployment**
  - Docker Compose for development
  - Docker images for production
  - Helm chart for Kubernetes
  - Electron desktop app (Windows, Linux)
  - Auto-update support for Electron

### Technical

- NestJS backend with modular architecture
- React 19 frontend with Material-UI
- Redux Toolkit with RTK Query for state management
- PostgreSQL with Prisma ORM
- Redis for caching and WebSocket scaling
- LiveKit for WebRTC media
