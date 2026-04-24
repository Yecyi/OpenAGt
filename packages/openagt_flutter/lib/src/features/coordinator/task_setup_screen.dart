import 'package:flutter/material.dart';
import 'package:opencode_flutter/src/core/api/opencode_api_client.dart';
import 'package:opencode_flutter/src/core/sse/sse_client.dart';
import 'package:opencode_flutter/src/features/coordinator/coordinator_models.dart';
import 'package:opencode_flutter/src/features/coordinator/mission_control_screen.dart';
import 'package:opencode_flutter/src/shared/theme/openag_theme.dart';

class TaskSetupScreen extends StatefulWidget {
  final OpenCodeApiClient apiClient;
  final SSEClient sseClient;

  const TaskSetupScreen({
    super.key,
    required this.apiClient,
    required this.sseClient,
  });

  @override
  State<TaskSetupScreen> createState() => _TaskSetupScreenState();
}

class _TaskSetupScreenState extends State<TaskSetupScreen> {
  final _goalController = TextEditingController();
  final _clarificationController = TextEditingController();
  final _reviewerProviderController = TextEditingController();
  final _reviewerModelController = TextEditingController();
  CoordinatorIntent? _intent;
  CoordinatorPlan? _plan;
  String _mode = 'autonomous';
  bool _isAnalyzing = false;
  bool _isStarting = false;
  String? _error;

  @override
  void dispose() {
    _goalController.dispose();
    _clarificationController.dispose();
    _reviewerProviderController.dispose();
    _reviewerModelController.dispose();
    super.dispose();
  }

  Future<void> _analyze() async {
    final goal = _goalController.text.trim();
    if (goal.isEmpty) {
      setState(() => _error = 'Enter a mission goal first.');
      return;
    }

    setState(() {
      _isAnalyzing = true;
      _error = null;
    });

    try {
      final intent = await widget.apiClient.settleCoordinatorIntent(goal);
      final plan = await widget.apiClient.generateCoordinatorPlan(
        goal: goal,
        intent: intent,
      );
      setState(() {
        _intent = intent;
        _plan = plan;
        _mode = intent.riskLevel == 'high' ? 'assisted' : 'autonomous';
      });
    } catch (e) {
      if (mounted) setState(() => _error = 'Analyze failed: $e');
    } finally {
      if (mounted) setState(() => _isAnalyzing = false);
    }
  }

  Future<void> _start() async {
    final intent = _intent;
    final plan = _plan;
    if (intent == null || plan == null) return;
    if (intent.needsUserClarification &&
        _clarificationController.text.trim().isEmpty) {
      setState(() => _error = 'Answer the clarification question before starting.');
      return;
    }

    setState(() {
      _isStarting = true;
      _error = null;
    });

    try {
      final session = await widget.apiClient.createSession();
      final sessionId = session['id']?.toString();
      if (sessionId == null || sessionId.isEmpty) {
        throw StateError('Session was created without an id.');
      }
      final runPlan = plan.withReviewerModel(
        _reviewerProviderController.text,
        _reviewerModelController.text,
      );
      final run = await widget.apiClient.runCoordinator(
        sessionId: sessionId,
        goal: _goalController.text.trim(),
        intent: intent,
        mode: _mode,
        nodes: runPlan.nodes,
      );
      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (context) => MissionControlScreen(
            apiClient: widget.apiClient,
            sseClient: widget.sseClient,
            runId: run.id,
            sessionId: sessionId,
          ),
        ),
      );
    } catch (e) {
      if (mounted) setState(() => _error = 'Start failed: $e');
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  bool get _canStart {
    final intent = _intent;
    if (intent == null || _plan == null || _isStarting) return false;
    if (!intent.needsUserClarification) return true;
    return _clarificationController.text.trim().isNotEmpty;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('New Mission'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _goalController,
            minLines: 3,
            maxLines: 6,
            decoration: const InputDecoration(
              labelText: 'Goal',
              hintText: 'Describe the work OpenAGt should complete.',
              prefixIcon: Icon(Icons.flag_outlined),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _isAnalyzing ? null : _analyze,
                  icon: _isAnalyzing
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.psychology_alt_outlined),
                  label: Text(_isAnalyzing ? 'Analyzing' : 'Analyze'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _canStart ? _start : null,
                  icon: const Icon(Icons.play_arrow),
                  label: Text(_isStarting ? 'Starting' : 'Start'),
                ),
              ),
            ],
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
          if (_intent != null) ...[
            const SizedBox(height: 20),
            _IntentSummary(
              intent: _intent!,
              mode: _mode,
              onModeChanged: (value) => setState(() => _mode = value),
            ),
            if (_intent!.needsUserClarification) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _clarificationController,
                onChanged: (_) => setState(() {}),
                minLines: 2,
                maxLines: 4,
                decoration: InputDecoration(
                  labelText: _intent!.clarificationQuestions.isEmpty
                      ? 'Clarification'
                      : _intent!.clarificationQuestions.first,
                  prefixIcon: const Icon(Icons.help_outline),
                ),
              ),
            ],
          ],
          if (_plan != null) ...[
            const SizedBox(height: 16),
            _AdvancedReviewerModel(
              providerController: _reviewerProviderController,
              modelController: _reviewerModelController,
            ),
            const SizedBox(height: 16),
            _PlanPreview(plan: _plan!),
          ],
        ],
      ),
    );
  }
}

class _IntentSummary extends StatelessWidget {
  final CoordinatorIntent intent;
  final String mode;
  final ValueChanged<String> onModeChanged;

  const _IntentSummary({
    required this.intent,
    required this.mode,
    required this.onModeChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: OpenAGtColors.surfaceContainerLowest,
        border: Border.all(color: OpenAGtColors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Intent', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _Chip(label: intent.taskType),
              _Chip(label: intent.workflow),
              _Chip(label: 'risk ${intent.riskLevel}'),
            ],
          ),
          const SizedBox(height: 12),
          Text(intent.expectedOutput),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: mode,
            decoration: const InputDecoration(labelText: 'Mode'),
            items: const [
              DropdownMenuItem(value: 'autonomous', child: Text('Autonomous')),
              DropdownMenuItem(value: 'assisted', child: Text('Assisted')),
              DropdownMenuItem(value: 'manual', child: Text('Manual')),
            ],
            onChanged: (value) {
              if (value != null) onModeChanged(value);
            },
          ),
          const SizedBox(height: 12),
          _BulletList(
            title: 'Success criteria',
            items: intent.successCriteria,
          ),
          _BulletList(
            title: 'Permissions',
            items: intent.permissionExpectations,
          ),
        ],
      ),
    );
  }
}

class _AdvancedReviewerModel extends StatelessWidget {
  final TextEditingController providerController;
  final TextEditingController modelController;

  const _AdvancedReviewerModel({
    required this.providerController,
    required this.modelController,
  });

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: const Text('Advanced reviewer model'),
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: providerController,
                decoration: const InputDecoration(
                  labelText: 'Provider ID',
                  hintText: 'openai',
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: modelController,
                decoration: const InputDecoration(
                  labelText: 'Model ID',
                  hintText: 'gpt-5.2',
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _PlanPreview extends StatelessWidget {
  final CoordinatorPlan plan;

  const _PlanPreview({required this.plan});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Plan', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        ...plan.nodes.map((node) => _NodePreview(node: node)),
      ],
    );
  }
}

class _NodePreview extends StatelessWidget {
  final CoordinatorNode node;

  const _NodePreview({required this.node});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: OpenAGtColors.surfaceContainerLow,
        border: Border.all(color: OpenAGtColors.outlineVariant),
      ),
      child: Row(
        children: [
          Icon(_roleIcon(node.role), size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(node.description),
                Text(
                  '${node.role} / ${node.taskKind} / ${node.risk}',
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BulletList extends StatelessWidget {
  final String title;
  final List<String> items;

  const _BulletList({
    required this.title,
    required this.items,
  });

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 4),
          ...items.map(
            (item) => Text(
              '- $item',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;

  const _Chip({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: OpenAGtColors.surfaceContainerHigh,
        border: Border.all(color: OpenAGtColors.outlineVariant),
      ),
      child: Text(label, style: Theme.of(context).textTheme.labelMedium),
    );
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
