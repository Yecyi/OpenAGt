import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:opencode_flutter/src/core/api/opencode_api_client.dart';
import 'package:opencode_flutter/src/core/sse/sse_client.dart';
import 'package:opencode_flutter/src/shared/theme/openag_theme.dart';

class ChatScreen extends ConsumerStatefulWidget {
  final String sessionId;
  final OpenCodeApiClient apiClient;
  final SSEClient sseClient;

  const ChatScreen({
    super.key,
    required this.sessionId,
    required this.apiClient,
    required this.sseClient,
  });

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<_ChatMessage> _messages = [];
  StreamSubscription<SSEEvent>? _sseSubscription;
  bool _isLoading = false;
  bool _isAgentTyping = false;

  @override
  void initState() {
    super.initState();
    _loadSession();
    _connectSSE();
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    _sseSubscription?.cancel();
    super.dispose();
  }

  Future<void> _loadSession() async {
    try {
      final session = await widget.apiClient.getSession(widget.sessionId);
      final messages = session['messages'] as List? ?? [];
      setState(() {
        _messages.clear();
        for (final msg in messages) {
          _messages.add(_ChatMessage.fromJson(msg));
        }
      });
    } catch (e) {
      debugPrint('Failed to load session: $e');
    }
  }

  void _connectSSE() {
    _sseSubscription = widget.sseClient
        .connect(sessionId: widget.sessionId)
        .listen(_handleSSEEvent);
  }

  void _handleSSEEvent(SSEEvent event) {
    switch (event.type) {
      case SSEEventType.messagePartDelta:
        _handleTextDelta(event);
        break;
      case SSEEventType.messageUpdated:
        _handleMessageUpdated(event);
        break;
      case SSEEventType.permissionAsked:
        _handlePermissionAsked(event);
        break;
      default:
        break;
    }
  }

  void _handleTextDelta(SSEEvent event) {
    final partId = event.partId;
    final data = event.data;
    if (partId == null || data == null) return;

    setState(() {
      if (_messages.isNotEmpty && _messages.last.isAgent) {
        _messages.last.content += data;
      }
    });
    _scrollToBottom();
  }

  void _handleMessageUpdated(SSEEvent event) {
    _loadSession();
    setState(() {
      _isAgentTyping = false;
    });
  }

  void _handlePermissionAsked(SSEEvent event) {
    final payload = event.payload;
    if (payload == null) return;

    showDialog(
      context: context,
      builder: (context) => _PermissionDialog(
        title: payload['title']?.toString() ?? 'Permission Required',
        description: payload['description']?.toString() ?? '',
        onAllow: () async {
          Navigator.pop(context);
          await widget.apiClient.respondToPermission(
            payload['id']?.toString() ?? '',
            true,
          );
        },
        onDeny: () async {
          Navigator.pop(context);
          await widget.apiClient.respondToPermission(
            payload['id']?.toString() ?? '',
            false,
          );
        },
      ),
    );
  }

  Future<void> _sendMessage() async {
    final content = _messageController.text.trim();
    if (content.isEmpty) return;

    setState(() {
      _isLoading = true;
      _messages.add(_ChatMessage(
        content: content,
        isAgent: false,
      ));
      _isAgentTyping = true;
    });
    _messageController.clear();
    _scrollToBottom();

    try {
      await widget.apiClient.sendMessage(widget.sessionId, content);
    } catch (e) {
      debugPrint('Failed to send message: $e');
      setState(() {
        _isAgentTyping = false;
        if (_messages.isNotEmpty) {
          _messages.removeLast();
        }
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('OpenCode'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.pushNamed(context, '/settings'),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length + (_isAgentTyping ? 1 : 0),
              itemBuilder: (context, index) {
                if (index == _messages.length && _isAgentTyping) {
                  return _buildAgentTypingIndicator();
                }
                return _buildMessage(_messages[index]);
              },
            ),
          ),
          _buildInputArea(),
        ],
      ),
    );
  }

  Widget _buildMessage(_ChatMessage message) {
    return Align(
      alignment: message.isAgent ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: message.isAgent
              ? OpenAGColors.surfaceContainerHigh
              : OpenAGColors.primaryContainer,
          border: Border.all(color: OpenAGColors.outlineVariant),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (message.isAgent)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.smart_toy,
                      size: 16,
                      color: OpenAGColors.onSurfaceVariant,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'OpenCode Agent',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ],
                ),
              ),
            SelectableText(
              message.content,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAgentTypingIndicator() {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: OpenAGColors.surfaceContainerHigh,
          border: Border.all(color: OpenAGColors.outlineVariant),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: OpenAGColors.onSurfaceVariant,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              'Agent is thinking...',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInputArea() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: OpenAGColors.surfaceContainerLowest,
        border: Border(
          top: BorderSide(color: OpenAGColors.outlineVariant),
        ),
      ),
      child: SafeArea(
        child: Row(
          children: [
            IconButton(
              icon: const Icon(Icons.attach_file),
              onPressed: () {},
              color: OpenAGColors.onSurfaceVariant,
            ),
            Expanded(
              child: TextField(
                controller: _messageController,
                decoration: const InputDecoration(
                  hintText: 'Instruct the agent...',
                  border: InputBorder.none,
                ),
                maxLines: null,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _sendMessage(),
              ),
            ),
            IconButton(
              icon: Icon(
                Icons.arrow_upward,
                color: _isLoading
                    ? OpenAGColors.onSurfaceVariant
                    : OpenAGColors.primary,
              ),
              onPressed: _isLoading ? null : _sendMessage,
            ),
          ],
        ),
      ),
    );
  }
}

class _ChatMessage {
  final String content;
  final bool isAgent;
  final DateTime timestamp;

  _ChatMessage({
    required this.content,
    required this.isAgent,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  factory _ChatMessage.fromJson(Map<String, dynamic> json) {
    final role = json['role'] as String?;
    final parts = json['parts'] as List? ?? [];
    final content = parts
        .where((p) => p['type'] == 'text')
        .map((p) => p['text']?.toString() ?? '')
        .join('\n');

    return _ChatMessage(
      content: content,
      isAgent: role == 'assistant',
    );
  }
}

class _PermissionDialog extends StatelessWidget {
  final String title;
  final String description;
  final VoidCallback onAllow;
  final VoidCallback onDeny;

  const _PermissionDialog({
    required this.title,
    required this.description,
    required this.onAllow,
    required this.onDeny,
  });

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
      title: Text(title),
      content: Text(description),
      actions: [
        OutlinedButton(
          onPressed: onDeny,
          child: const Text('Deny'),
        ),
        ElevatedButton(
          onPressed: onAllow,
          child: const Text('Allow'),
        ),
      ],
    );
  }
}
