# OpenAGt Flutter Client

This package is intentionally kept as a deferred Flutter entry point.

The current stable OpenAGt surface is the CLI, TUI, headless server, web UI, and generated JavaScript SDK. The Flutter client remains a future mobile control panel over those backend contracts, not a currently supported runtime or release artifact.

## Current Status

- No server connection flow is shipped here.
- No REST, SSE, session, chat, coordinator, or theme implementation is maintained in this package.
- `lib/main.dart` is a minimal placeholder app so the package keeps a valid Flutter entry point.

## Future Rebuild Rules

When Flutter work resumes:

- Treat it as a client of the OpenAGt server and SDK contracts.
- Do not duplicate agent runtime, tool execution, permission policy, or session orchestration in Flutter.
- Add characterization tests around API payloads and event stream handling before rebuilding screens.
- Keep mobile UI work separate from CLI/TUI/web runtime refactors.
