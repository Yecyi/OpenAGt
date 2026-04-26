# OpenAGt Flutter Mobile Client

A native iOS/Android mobile client for OpenCode AI coding agent. Connects to the server via HTTP/REST API and SSE for real-time streaming.

---

## Status

**MVP (Minimum Viable Product)** — Core functionality is working. Some features remain planned.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Flutter App                              │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Presentation Layer                        │   │
│  │  ConnectionScreen | SessionListScreen | ChatScreen  │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              State Layer (Riverpod)                  │   │
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
│              OpenCode Server (localhost:4096 default)      │
└────────────────────────────────────────────────────────────┘
```

---

## Implementation Status

### Working (MVP Complete)

| Feature                                 | File                            | Status |
| --------------------------------------- | ------------------------------- | ------ |
| App entry + server connection           | `main.dart`, `ConnectionScreen` | ✅     |
| Session list (list/create/delete)       | `session_list_screen.dart`      | ✅     |
| Chat interface (send/receive)           | `chat_screen.dart`              | ✅     |
| Real-time SSE streaming                 | `sse_client.dart`               | ✅     |
| REST API client (Dio)                   | `opencode_api_client.dart`      | ✅     |
| Light + dark theme                      | `openag_theme.dart`             | ✅     |
| Material Design 3 styling               | `openag_theme.dart`             | ✅     |
| Local storage (Hive, SharedPreferences) | `pubspec.yaml` deps             | ✅     |

### Planned / Incomplete

| Feature                  | Priority |
| ------------------------ | -------- |
| Tool call visualization  | P2       |
| Markdown/code rendering  | P2       |
| Diff visualization       | P2       |
| File browser             | P2       |
| Provider/model switching | P2       |
| Settings page            | P2       |
| Push notifications       | P3       |
| Offline mode             | P3       |
| Multi-device sync        | P3       |
| Deep linking             | P3       |
| Biometric auth           | P3       |

---

## API Integration

### REST API Endpoints

```
GET    /session              # List sessions
POST   /session              # Create session
GET    /session/:id          # Get session
POST   /session/:id/message  # Send message (streaming)
DELETE /session/:id          # Delete session
POST   /session/:id/abort    # Abort current operation
POST   /session/:id/fork     # Fork session

GET    /permission           # Get pending permissions
POST   /permission/:id/reply # Respond to permission

GET    /config               # Get configuration
GET    /provider             # List providers
GET    /agent                # List agents
```

### SSE Event Types

```
session.created       # New session created
session.updated       # Session updated
message.updated       # Message updated
message.part.updated  # Part updated
message.part.delta    # Streaming text delta
permission.asked     # Permission requested
question.asked        # Question asked
```

---

## Technology Stack

| Component        | Technology                     |
| ---------------- | ------------------------------ |
| Framework        | Flutter 3.x                    |
| State Management | flutter_riverpod               |
| HTTP Client      | Dio                            |
| Real-time        | web_socket_channel (SSE)       |
| Local Storage    | Hive + shared_preferences      |
| Markdown         | flutter_markdown               |
| Utilities        | uuid, intl, equatable, freezed |

---

## Getting Started

```bash
# 1. Install Flutter SDK 3.x
# https://docs.flutter.dev/get-started/install

# 2. Install dependencies
flutter pub get

# 3. Run on device/emulator
flutter run
```

The app connects to `localhost:4096` by default. Configure the server URL on the connection screen.

---

## Related Documents

- [Main README](../../README.md) — Project overview
- [packages/openagt/README.md](../../packages/openagt/README.md) — Core agent engine
