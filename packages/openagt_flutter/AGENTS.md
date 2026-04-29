# Flutter Package Agent Notes

This package is a deferred placeholder for a future OpenAGt Flutter client.

Do not add mobile screens, REST clients, SSE clients, state management, local storage, or theme systems here as part of routine runtime cleanup. The current supported surfaces are CLI, TUI, headless server, web UI, and the generated JavaScript SDK.

If Flutter work is explicitly resumed:

- Keep it as a server/client control panel.
- Do not duplicate agent runtime, tool execution, permissions, or session orchestration.
- Verify API and SSE contracts against `packages/openagt` before building UI.
- Run `flutter analyze` and `flutter test` from this directory when Flutter SDK is available.
