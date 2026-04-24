import 'dart:async';

import 'package:flutter/material.dart';
import 'package:opencode_flutter/src/core/api/opencode_api_client.dart';
import 'package:opencode_flutter/src/core/sse/sse_client.dart';
import 'package:opencode_flutter/src/features/chat/chat_screen.dart';
import 'package:opencode_flutter/src/features/coordinator/coordinator_models.dart';
import 'package:opencode_flutter/src/shared/theme/openag_theme.dart';

class MissionControlScreen extends StatefulWidget {
  final OpenCodeApiClient apiClient;
  final SSEClient sseClient;
  final String runId;
  final String sessionId;

  const MissionControlScreen({
    super.key,
    required this.apiClient,
    required this.sseClient,
    required this.runId,
    required this.sessionId,
  });

  @override
  State<MissionControlScreen> createState() => _MissionControlScreenState();
}

class _MissionControlScreenState extends State<MissionControlScreen> {
  late final SSEClient _missionSseClient;
  StreamSubscription<SSEEvent>? _subscription;
  CoordinatorProjection? _projection;
  bool _isLoading = true;
  bool _isActing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _missionSseClient = SSEClient(baseUrl: widget.sseClient.baseUrl);
    _loadProjection();
    _subscription = _missionSseClient
        .connect(sessionId: widget.sessionId)
        .listen(_handleEvent, onError: (error) {
      debugPrint('Mission Control SSE error: $error');
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _missionSseClient.dispose();
    super.dispose();
  }

  Future<void> _loadProjection() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final projection = await widget.apiClient.getCoordinatorProjection(widget.runId);
      if (!mounted) return;
      setState(() => _projection = projection);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Projection refresh failed: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _handleEvent(SSEEvent event) {
    if (event.type == SSEEventType.coordinatorCreated ||
        event.type == SSEEventType.coordinatorUpdated ||
        event.type == SSEEventType.coordinatorCompleted ||
        event.type == SSEEventType.taskUpdated) {
      _loadProjection();
    }
  }

  Future<void> _approve() async {
    await _act(() => widget.apiClient.approveCoordinatorRun(widget.runId));
  }

  Future<void> _cancel() async {
    await _act(() => widget.apiClient.cancelCoordinatorRun(widget.runId));
  }

  Future<void> _resume() async {
    await _act(() => widget.apiClient.resumeCoordinatorRun(widget.runId));
  }

  Future<void> _act(Future<CoordinatorRun> Function() action) async {
    setState(() {
      _isActing = true;
      _error = null;
    });
    try {
      await action();
      await _loadProjection();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Action failed: $e');
    } finally {
      if (mounted) setState(() => _isActing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final projection = _projection;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mission Control'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _isLoading ? null : _loadProjection,
          ),
        ],
      ),
      body: _isLoading && projection == null
          ? const Center(child: CircularProgressIndicator())
          : projection == null
              ? _ErrorView(message: _error ?? 'Mission not found.')
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _MissionHeader(
                      projection: projection,
                      isActing: _isActing,
                      onApprove: _approve,
                      onCancel: _cancel,
                      onResume: _resume,
                      onRefresh: _loadProjection,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        _error!,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: OpenAGtColors.error,
                            ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    _DagView(
                      projection: projection,
                      onOpenTask: _openTaskSession,
                    ),
                    const SizedBox(height: 16),
                    _ResultsView(projection: projection),
                  ],
                ),
    );
  }

  void _openTaskSession(CoordinatorTask task) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => ChatScreen(
          sessionId: task.childSessionId,
          apiClient: widget.apiClient,
          sseClient: SSEClient(baseUrl: widget.sseClient.baseUrl),
          disposeSseClient: true,
        ),
      ),
    );
  }
}

class _MissionHeader extends StatelessWidget {
  final CoordinatorProjection projection;
  final bool isActing;
  final VoidCallback onApprove;
  final VoidCallback onCancel;
  final VoidCallback onResume;
  final VoidCallback onRefresh;

  const _MissionHeader({
    required this.projection,
    required this.isActing,
    required this.onApprove,
    required this.onCancel,
    required this.onResume,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    final run = projection.run;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: OpenAGtColors.surfaceContainerLowest,
        border: Border.all(color: OpenAGtColors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(run.goal, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _StatusChip(label: run.state, status: run.state),
              _StatusChip(label: run.mode, status: run.mode),
              _StatusChip(label: run.workflow, status: run.workflow),
              _StatusChip(label: 'risk ${run.intent.riskLevel}', status: run.intent.riskLevel),
            ],
          ),
          if (run.summary != null && run.summary!.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(run.summary!, style: Theme.of(context).textTheme.bodySmall),
          ],
          const SizedBox(height: 12),
          _CountRow(counts: projection.counts),
          const SizedBox(height: 12),
          _ControlRow(
            state: run.state,
            isActing: isActing,
            onApprove: onApprove,
            onCancel: onCancel,
            onResume: onResume,
            onRefresh: onRefresh,
          ),
        ],
      ),
    );
  }
}

class _ControlRow extends StatelessWidget {
  final String state;
  final bool isActing;
  final VoidCallback onApprove;
  final VoidCallback onCancel;
  final VoidCallback onResume;
  final VoidCallback onRefresh;

  const _ControlRow({
    required this.state,
    required this.isActing,
    required this.onApprove,
    required this.onCancel,
    required this.onResume,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    if (state == 'awaiting_approval') {
      return Row(
        children: [
          Expanded(
            child: ElevatedButton.icon(
              onPressed: isActing ? null : onApprove,
              icon: const Icon(Icons.check),
              label: const Text('Approve'),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: isActing ? null : onCancel,
              icon: const Icon(Icons.close),
              label: const Text('Cancel'),
            ),
          ),
        ],
      );
    }
    if (state == 'active' || state == 'blocked') {
      return Row(
        children: [
          Expanded(
            child: ElevatedButton.icon(
              onPressed: isActing ? null : onResume,
              icon: const Icon(Icons.play_arrow),
              label: const Text('Resume'),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: isActing ? null : onCancel,
              icon: const Icon(Icons.stop),
              label: const Text('Cancel'),
            ),
          ),
        ],
      );
    }
    return OutlinedButton.icon(
      onPressed: isActing ? null : onRefresh,
      icon: const Icon(Icons.refresh),
      label: const Text('Refresh'),
    );
  }
}

class _DagView extends StatelessWidget {
  final CoordinatorProjection projection;
  final ValueChanged<CoordinatorTask> onOpenTask;

  const _DagView({
    required this.projection,
    required this.onOpenTask,
  });

  @override
  Widget build(BuildContext context) {
    final tasksByNode = {
      for (final task in projection.tasks)
        if (task.coordinatorNodeId.isNotEmpty) task.coordinatorNodeId: task,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Subagents', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        ...projection.run.plan.nodes.asMap().entries.map((entry) {
          final fallbackTask =
              entry.key < projection.tasks.length ? projection.tasks[entry.key] : null;
          final task = tasksByNode[entry.value.id] ?? fallbackTask;
          return _NodeCard(
            node: entry.value,
            task: task,
            onOpenTask: task == null ? null : () => onOpenTask(task),
          );
        }),
      ],
    );
  }
}

class _NodeCard extends StatelessWidget {
  final CoordinatorNode node;
  final CoordinatorTask? task;
  final VoidCallback? onOpenTask;

  const _NodeCard({
    required this.node,
    required this.task,
    required this.onOpenTask,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: OpenAGtColors.surfaceContainerLow,
        border: Border.all(color: OpenAGtColors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_roleIcon(node.role), size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  node.description,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ),
              _StatusChip(label: task?.status ?? 'pending', status: task?.status ?? 'pending'),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _MetaText('${node.role} / ${node.taskKind}'),
              _MetaText('risk ${node.risk}'),
              if (node.model != null)
                _MetaText('${node.model!.providerId}/${node.model!.modelId}'),
            ],
          ),
          const SizedBox(height: 8),
          _InlineList(label: 'Reads', items: node.readScope),
          _InlineList(label: 'Writes', items: node.writeScope),
          _InlineList(label: 'Checks', items: node.acceptanceChecks),
          if (task?.resultSummary != null || task?.errorSummary != null) ...[
            const SizedBox(height: 8),
            Text(
              task?.resultSummary ?? task?.errorSummary ?? '',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: onOpenTask,
              icon: const Icon(Icons.open_in_new, size: 16),
              label: const Text('Open session'),
            ),
          ),
        ],
      ),
    );
  }
}

class _ResultsView extends StatelessWidget {
  final CoordinatorProjection projection;

  const _ResultsView({required this.projection});

  @override
  Widget build(BuildContext context) {
    final finished = projection.tasks
        .where((task) => task.resultSummary != null || task.errorSummary != null)
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Results', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        if (finished.isEmpty)
          Text('No task output yet.', style: Theme.of(context).textTheme.bodySmall)
        else
          ...finished.map((task) => Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: OpenAGtColors.surfaceContainerLowest,
                  border: Border.all(color: OpenAGtColors.outlineVariant),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(task.description),
                    const SizedBox(height: 4),
                    Text(
                      task.resultSummary ?? task.errorSummary ?? '',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              )),
      ],
    );
  }
}

class _CountRow extends StatelessWidget {
  final Map<String, int> counts;

  const _CountRow({required this.counts});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: ['pending', 'running', 'completed', 'failed', 'cancelled']
          .map((key) => _MetaText('$key ${counts[key] ?? 0}'))
          .toList(),
    );
  }
}

class _InlineList extends StatelessWidget {
  final String label;
  final List<String> items;

  const _InlineList({
    required this.label,
    required this.items,
  });

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text(
        '$label: ${items.join(', ')}',
        style: Theme.of(context).textTheme.labelSmall,
      ),
    );
  }
}

class _MetaText extends StatelessWidget {
  final String text;

  const _MetaText(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(text, style: Theme.of(context).textTheme.labelSmall);
  }
}

class _StatusChip extends StatelessWidget {
  final String label;
  final String status;

  const _StatusChip({
    required this.label,
    required this.status,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: _statusColor(status),
        border: Border.all(color: OpenAGtColors.outlineVariant),
      ),
      child: Text(label, style: Theme.of(context).textTheme.labelMedium),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;

  const _ErrorView({required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          message,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: OpenAGtColors.error,
              ),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}

Color _statusColor(String status) {
  switch (status) {
    case 'completed':
    case 'autonomous':
    case 'low':
      return const Color(0xFFE2F2E8);
    case 'failed':
    case 'high':
      return OpenAGtColors.errorContainer;
    case 'running':
    case 'active':
    case 'assisted':
      return const Color(0xFFE2EAF6);
    case 'blocked':
    case 'awaiting_approval':
    case 'medium':
      return const Color(0xFFFFF2CC);
    default:
      return OpenAGtColors.surfaceContainerHigh;
  }
}

IconData _roleIcon(String role) {
  switch (role) {
    case 'researcher':
      return Icons.search;
    case 'implementer':
      return Icons.build_outlined;
    case 'verifier':
      return Icons.fact_check_outlined;
    case 'reviewer':
      return Icons.rate_review_outlined;
    case 'debugger':
      return Icons.bug_report_outlined;
    case 'writer':
      return Icons.edit_note;
    case 'environment-auditor':
      return Icons.computer;
    case 'automation-planner':
      return Icons.schedule;
    default:
      return Icons.account_tree_outlined;
  }
}
