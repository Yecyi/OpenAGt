# Flutter App Agent

## Overview

This is the Flutter mobile client for OpenCode AI coding agent. It connects to the OpenCode server via HTTP/REST API and SSE/WebSocket for real-time updates.

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Flutter App                              │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Presentation Layer                        │   │
│  │  SessionListScreen | ChatScreen | SettingsScreen     │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              State Layer (Riverpod)                   │   │
│  │  apiClientProvider | sseClientProvider                │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Data Layer                              │   │
│  │  OpenCodeApiClient (Dio) | SSEClient                │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP + SSE
                              ▼
┌────────────────────────────────────────────────────────────┐
│              OpenCode Server (Hono)                       │
└────────────────────────────────────────────────────────────┘
```

## Key Features (MVP)

- [ ] Server connection management (URL input, auth)
- [ ] Session list with create/delete
- [ ] Chat interface with streaming text
- [ ] Tool call visualization
- [ ] Permission request handling
- [ ] Markdown/code rendering
- [ ] Diff visualization
- [ ] File browser
- [ ] Provider/model switching
- [ ] Settings page
- [ ] Push notifications
- [ ] Offline mode
- [ ] Multi-device sync

## API Integration

### REST API Endpoints

```
GET    /session              # List sessions
POST   /session              # Create session
GET    /session/:id          # Get session
POST   /session/:id/message  # Send message (streaming)
DELETE /session/:id         # Delete session
POST   /session/:id/abort   # Abort current operation
POST   /session/:id/fork    # Fork session

GET    /permission           # Get pending permissions
POST   /permission/:id/reply # Respond to permission

GET    /config              # Get configuration
GET    /provider            # List providers
GET    /agent              # List agents
```

### SSE Events

```
session.created       # New session created
session.updated       # Session updated
message.updated       # Message updated
message.part.updated  # Part updated
message.part.delta    # Streaming text delta
permission.asked      # Permission requested
question.asked       # Question asked
```

## Tech Stack

| Component        | Technology         |
| ---------------- | ------------------ |
| Framework        | Flutter 3.x        |
| State Management | Riverpod 2.x       |
| HTTP Client      | Dio                |
| WebSocket        | web_socket_channel |
| Local Storage    | Hive               |
| Markdown         | flutter_markdown   |

## Getting Started

1. Install Flutter SDK 3.x
2. Run `flutter pub get`
3. Run `flutter run`

## TODO

- [ ] Add deep linking support
- [ ] Add biometric auth
- [ ] Add widget for quick actions
- [ ] Implement proper error handling
- [ ] Add accessibility support
