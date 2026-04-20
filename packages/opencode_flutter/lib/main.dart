import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:opencode_flutter/src/core/api/opencode_api_client.dart';
import 'package:opencode_flutter/src/core/sse/sse_client.dart';
import 'package:opencode_flutter/src/features/chat/chat_screen.dart';
import 'package:opencode_flutter/src/features/session/session_list_screen.dart';
import 'package:opencode_flutter/src/shared/theme/openag_theme.dart';

void main() {
  runApp(
    const ProviderScope(
      child: OpenCodeFlutterApp(),
    ),
  );
}

class OpenCodeFlutterApp extends StatelessWidget {
  const OpenCodeFlutterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OpenCode',
      theme: OpenAGtTheme.lightTheme,
      darkTheme: OpenAGtTheme.darkTheme,
      themeMode: ThemeMode.system,
      debugShowCheckedModeBanner: false,
      home: const ServerConnectionScreen(),
    );
  }
}

final apiClientProvider = StateProvider<OpenCodeApiClient?>((ref) => null);
final sseClientProvider = StateProvider<SSEClient?>((ref) => null);

class ServerConnectionScreen extends ConsumerStatefulWidget {
  const ServerConnectionScreen({super.key});

  @override
  ConsumerState<ServerConnectionScreen> createState() => _ServerConnectionScreenState();
}

class _ServerConnectionScreenState extends ConsumerState<ServerConnectionScreen> {
  final _urlController = TextEditingController(text: 'http://localhost:4096');
  bool _isConnecting = false;
  String? _error;

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) {
      setState(() => _error = 'Please enter a server URL');
      return;
    }

    setState(() {
      _isConnecting = true;
      _error = null;
    });

    try {
      final apiClient = OpenCodeApiClient(baseUrl: url);
      final sseClient = SSEClient(baseUrl: url);

      await apiClient.listSessions();

      ref.read(apiClientProvider.notifier).state = apiClient;
      ref.read(sseClientProvider.notifier).state = sseClient;

      if (mounted) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (context) => SessionListScreen(
              apiClient: apiClient,
              sseClient: sseClient,
            ),
          ),
        );
      }
    } catch (e) {
      setState(() {
        _error = 'Failed to connect: $e';
        _isConnecting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Connect to Server'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Spacer(),
            Icon(
              Icons.terminal,
              size: 80,
              color: OpenAGtColors.primary,
            ),
            const SizedBox(height: 24),
            Text(
              'OpenCode',
              style: Theme.of(context).textTheme.displayMedium?.copyWith(
                    fontStyle: FontStyle.italic,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Connect to your OpenCode server',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: OpenAGtColors.onSurfaceVariant,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 48),
            TextField(
              controller: _urlController,
              decoration: const InputDecoration(
                labelText: 'Server URL',
                hintText: 'http://localhost:4096',
                prefixIcon: Icon(Icons.link),
              ),
              keyboardType: TextInputType.url,
              autocorrect: false,
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(
                _error!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: OpenAGtColors.error,
                    ),
                textAlign: TextAlign.center,
              ),
            ],
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: _isConnecting ? null : _connect,
              child: _isConnecting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Connect'),
            ),
            const Spacer(flex: 2),
          ],
        ),
      ),
    );
  }
}
