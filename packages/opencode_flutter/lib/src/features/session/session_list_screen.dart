import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:opencode_flutter/src/core/api/opencode_api_client.dart';
import 'package:opencode_flutter/src/core/sse/sse_client.dart';
import 'package:opencode_flutter/src/features/chat/chat_screen.dart';
import 'package:opencode_flutter/src/shared/theme/openag_theme.dart';

class SessionListScreen extends ConsumerStatefulWidget {
  final OpenCodeApiClient apiClient;
  final SSEClient sseClient;

  const SessionListScreen({
    super.key,
    required this.apiClient,
    required this.sseClient,
  });

  @override
  ConsumerState<SessionListScreen> createState() => _SessionListScreenState();
}

class _SessionListScreenState extends ConsumerState<SessionListScreen> {
  List<_SessionItem> _sessions = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadSessions();
  }

  Future<void> _loadSessions() async {
    setState(() => _isLoading = true);
    try {
      final sessions = await widget.apiClient.listSessions();
      setState(() {
        _sessions = sessions.map((s) => _SessionItem.fromJson(s)).toList();
        _isLoading = false;
      });
    } catch (e) {
      debugPrint('Failed to load sessions: $e');
      setState(() => _isLoading = false);
    }
  }

  Future<void> _createSession() async {
    try {
      final session = await widget.apiClient.createSession();
      final sessionId = session['id'] as String?;
      if (sessionId != null && mounted) {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => ChatScreen(
              sessionId: sessionId,
              apiClient: widget.apiClient,
              sseClient: widget.sseClient,
            ),
          ),
        );
      }
    } catch (e) {
      debugPrint('Failed to create session: $e');
    }
  }

  String _formatTimestamp(DateTime? timestamp) {
    if (timestamp == null) return '';
    final now = DateTime.now();
    final diff = now.difference(timestamp);

    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${timestamp.month}/${timestamp.day}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sessions'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.pushNamed(context, '/settings'),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _sessions.isEmpty
              ? _buildEmptyState()
              : _buildSessionList(),
      floatingActionButton: FloatingActionButton(
        onPressed: _createSession,
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.terminal,
            size: 64,
            color: OpenAGColors.onSurfaceVariant,
          ),
          const SizedBox(height: 16),
          Text(
            'No sessions yet',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            'Create a new session to get started',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _buildSessionList() {
    return RefreshIndicator(
      onRefresh: _loadSessions,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: _sessions.length,
        itemBuilder: (context, index) {
          final session = _sessions[index];
          return _SessionTile(
            session: session,
            timestamp: _formatTimestamp(session.updatedAt),
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => ChatScreen(
                    sessionId: session.id,
                    apiClient: widget.apiClient,
                    sseClient: widget.sseClient,
                  ),
                ),
              );
            },
            onDelete: () async {
              await widget.apiClient.deleteSession(session.id);
              _loadSessions();
            },
          );
        },
      ),
    );
  }
}

class _SessionTile extends StatelessWidget {
  final _SessionItem session;
  final String timestamp;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const _SessionTile({
    required this.session,
    required this.timestamp,
    required this.onTap,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Dismissible(
      key: Key(session.id),
      direction: DismissDirection.endToStart,
      background: Container(
        color: OpenAGColors.error,
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 16),
        child: const Icon(Icons.delete, color: Colors.white),
      ),
      onDismissed: (_) => onDelete(),
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: OpenAGColors.surfaceContainerHighest,
            border: Border.all(color: OpenAGColors.outlineVariant),
          ),
          child: Icon(
            session.status == 'active' ? Icons.terminal : Icons.folder,
            color: OpenAGColors.onSurfaceVariant,
            size: 20,
          ),
        ),
        title: Text(
          session.title.isNotEmpty ? session.title : 'Untitled Session',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          timestamp,
          style: Theme.of(context).textTheme.labelSmall,
        ),
        trailing: const Icon(
          Icons.chevron_right,
          color: OpenAGColors.onSurfaceVariant,
        ),
        onTap: onTap,
      ),
    );
  }
}

class _SessionItem {
  final String id;
  final String title;
  final String status;
  final DateTime? updatedAt;

  _SessionItem({
    required this.id,
    required this.title,
    required this.status,
    this.updatedAt,
  });

  factory _SessionItem.fromJson(Map<String, dynamic> json) {
    return _SessionItem(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      status: json['status'] as String? ?? 'idle',
      updatedAt: json['updated_at'] != null
          ? DateTime.tryParse(json['updated_at'] as String)
          : null,
    );
  }
}
