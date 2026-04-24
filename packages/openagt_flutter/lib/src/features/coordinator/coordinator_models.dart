class CoordinatorIntent {
  final String goal;
  final String taskType;
  final List<String> successCriteria;
  final String riskLevel;
  final bool needsUserClarification;
  final List<String> clarificationQuestions;
  final String workflow;
  final String expectedOutput;
  final List<String> permissionExpectations;

  const CoordinatorIntent({
    required this.goal,
    required this.taskType,
    required this.successCriteria,
    required this.riskLevel,
    required this.needsUserClarification,
    required this.clarificationQuestions,
    required this.workflow,
    required this.expectedOutput,
    required this.permissionExpectations,
  });

  factory CoordinatorIntent.fromJson(Map<String, dynamic> json) {
    return CoordinatorIntent(
      goal: json['goal']?.toString() ?? '',
      taskType: json['task_type']?.toString() ?? 'general-operations',
      successCriteria: _stringList(json['success_criteria']),
      riskLevel: json['risk_level']?.toString() ?? 'medium',
      needsUserClarification: json['needs_user_clarification'] == true,
      clarificationQuestions: _stringList(json['clarification_questions']),
      workflow: json['workflow']?.toString() ?? 'general-operations',
      expectedOutput: json['expected_output']?.toString() ?? '',
      permissionExpectations: _stringList(json['permission_expectations']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'goal': goal,
      'task_type': taskType,
      'success_criteria': successCriteria,
      'risk_level': riskLevel,
      'needs_user_clarification': needsUserClarification,
      'clarification_questions': clarificationQuestions,
      'workflow': workflow,
      'expected_output': expectedOutput,
      'permission_expectations': permissionExpectations,
    };
  }
}

class CoordinatorPlan {
  final String goal;
  final List<CoordinatorNode> nodes;

  const CoordinatorPlan({
    required this.goal,
    required this.nodes,
  });

  factory CoordinatorPlan.fromJson(Map<String, dynamic> json) {
    return CoordinatorPlan(
      goal: json['goal']?.toString() ?? '',
      nodes: _mapList(json['nodes']).map(CoordinatorNode.fromJson).toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'goal': goal,
      'nodes': nodes.map((node) => node.toJson()).toList(),
    };
  }

  CoordinatorPlan withReviewerModel(String? providerId, String? modelId) {
    final nextProviderId = (providerId ?? '').trim();
    final nextModelId = (modelId ?? '').trim();
    if (nextProviderId.isEmpty || nextModelId.isEmpty) {
      return this;
    }
    return CoordinatorPlan(
      goal: goal,
      nodes: nodes
          .map((node) => node.role == 'reviewer'
              ? node.withModel(nextProviderId, nextModelId)
              : node)
          .toList(),
    );
  }
}

class CoordinatorNode {
  final String id;
  final String description;
  final String prompt;
  final String taskKind;
  final String subagentType;
  final String role;
  final CoordinatorModel? model;
  final String risk;
  final List<String> dependsOn;
  final List<String> writeScope;
  final List<String> readScope;
  final List<String> acceptanceChecks;
  final String outputSchema;
  final bool requiresUserInput;
  final String priority;
  final String origin;

  const CoordinatorNode({
    required this.id,
    required this.description,
    required this.prompt,
    required this.taskKind,
    required this.subagentType,
    required this.role,
    required this.model,
    required this.risk,
    required this.dependsOn,
    required this.writeScope,
    required this.readScope,
    required this.acceptanceChecks,
    required this.outputSchema,
    required this.requiresUserInput,
    required this.priority,
    required this.origin,
  });

  factory CoordinatorNode.fromJson(Map<String, dynamic> json) {
    return CoordinatorNode(
      id: json['id']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      prompt: json['prompt']?.toString() ?? '',
      taskKind: json['task_kind']?.toString() ?? 'generic',
      subagentType: json['subagent_type']?.toString() ?? 'general',
      role: json['role']?.toString() ?? 'coordinator',
      model: json['model'] is Map
          ? CoordinatorModel.fromJson(Map<String, dynamic>.from(json['model'] as Map))
          : null,
      risk: json['risk']?.toString() ?? 'medium',
      dependsOn: _stringList(json['depends_on']),
      writeScope: _stringList(json['write_scope']),
      readScope: _stringList(json['read_scope']),
      acceptanceChecks: _stringList(json['acceptance_checks']),
      outputSchema: json['output_schema']?.toString() ?? 'summary',
      requiresUserInput: json['requires_user_input'] == true,
      priority: json['priority']?.toString() ?? 'normal',
      origin: json['origin']?.toString() ?? 'coordinator',
    );
  }

  CoordinatorNode withModel(String providerId, String modelId) {
    return CoordinatorNode(
      id: id,
      description: description,
      prompt: prompt,
      taskKind: taskKind,
      subagentType: subagentType,
      role: role,
      model: CoordinatorModel(providerId: providerId, modelId: modelId),
      risk: risk,
      dependsOn: dependsOn,
      writeScope: writeScope,
      readScope: readScope,
      acceptanceChecks: acceptanceChecks,
      outputSchema: outputSchema,
      requiresUserInput: requiresUserInput,
      priority: priority,
      origin: origin,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'description': description,
      'prompt': prompt,
      'task_kind': taskKind,
      'subagent_type': subagentType,
      'role': role,
      if (model != null) 'model': model!.toJson(),
      'risk': risk,
      'depends_on': dependsOn,
      'write_scope': writeScope,
      'read_scope': readScope,
      'acceptance_checks': acceptanceChecks,
      'output_schema': outputSchema,
      'requires_user_input': requiresUserInput,
      'priority': priority,
      'origin': origin,
    };
  }
}

class CoordinatorModel {
  final String providerId;
  final String modelId;
  final String? variant;

  const CoordinatorModel({
    required this.providerId,
    required this.modelId,
    this.variant,
  });

  factory CoordinatorModel.fromJson(Map<String, dynamic> json) {
    return CoordinatorModel(
      providerId: json['providerID']?.toString() ?? '',
      modelId: json['modelID']?.toString() ?? '',
      variant: json['variant']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'providerID': providerId,
      'modelID': modelId,
      if (variant != null) 'variant': variant,
    };
  }
}

class CoordinatorRun {
  final String id;
  final String sessionId;
  final String goal;
  final CoordinatorIntent intent;
  final String mode;
  final String workflow;
  final String state;
  final CoordinatorPlan plan;
  final List<String> taskIds;
  final String? summary;

  const CoordinatorRun({
    required this.id,
    required this.sessionId,
    required this.goal,
    required this.intent,
    required this.mode,
    required this.workflow,
    required this.state,
    required this.plan,
    required this.taskIds,
    required this.summary,
  });

  factory CoordinatorRun.fromJson(Map<String, dynamic> json) {
    return CoordinatorRun(
      id: json['id']?.toString() ?? '',
      sessionId: json['sessionID']?.toString() ?? json['session_id']?.toString() ?? '',
      goal: json['goal']?.toString() ?? '',
      intent: CoordinatorIntent.fromJson(_map(json['intent'])),
      mode: json['mode']?.toString() ?? 'autonomous',
      workflow: json['workflow']?.toString() ?? 'general-operations',
      state: json['state']?.toString() ?? 'active',
      plan: CoordinatorPlan.fromJson(_map(json['plan'])),
      taskIds: _stringList(json['task_ids']),
      summary: json['summary']?.toString(),
    );
  }
}

class CoordinatorProjection {
  final CoordinatorRun run;
  final List<CoordinatorTask> tasks;
  final Map<String, int> counts;

  const CoordinatorProjection({
    required this.run,
    required this.tasks,
    required this.counts,
  });

  factory CoordinatorProjection.fromJson(Map<String, dynamic> json) {
    return CoordinatorProjection(
      run: CoordinatorRun.fromJson(_map(json['run'])),
      tasks: _mapList(json['tasks']).map(CoordinatorTask.fromJson).toList(),
      counts: _intMap(json['counts']),
    );
  }
}

class CoordinatorTask {
  final String taskId;
  final String parentSessionId;
  final String childSessionId;
  final String status;
  final String taskKind;
  final String subagentType;
  final String description;
  final List<String> dependsOn;
  final List<String> writeScope;
  final List<String> readScope;
  final List<String> acceptanceChecks;
  final String priority;
  final String origin;
  final String? resultSummary;
  final String? errorSummary;
  final Map<String, dynamic> metadata;

  const CoordinatorTask({
    required this.taskId,
    required this.parentSessionId,
    required this.childSessionId,
    required this.status,
    required this.taskKind,
    required this.subagentType,
    required this.description,
    required this.dependsOn,
    required this.writeScope,
    required this.readScope,
    required this.acceptanceChecks,
    required this.priority,
    required this.origin,
    required this.resultSummary,
    required this.errorSummary,
    required this.metadata,
  });

  factory CoordinatorTask.fromJson(Map<String, dynamic> json) {
    return CoordinatorTask(
      taskId: json['task_id']?.toString() ?? '',
      parentSessionId: json['parent_session_id']?.toString() ?? '',
      childSessionId: json['child_session_id']?.toString() ?? '',
      status: json['status']?.toString() ?? 'pending',
      taskKind: json['task_kind']?.toString() ?? 'generic',
      subagentType: json['subagent_type']?.toString() ?? 'general',
      description: json['description']?.toString() ?? '',
      dependsOn: _stringList(json['depends_on']),
      writeScope: _stringList(json['write_scope']),
      readScope: _stringList(json['read_scope']),
      acceptanceChecks: _stringList(json['acceptance_checks']),
      priority: json['priority']?.toString() ?? 'normal',
      origin: json['origin']?.toString() ?? 'coordinator',
      resultSummary: json['result_summary']?.toString(),
      errorSummary: json['error_summary']?.toString(),
      metadata: _map(json['metadata']),
    );
  }

  String get coordinatorNodeId => metadata['coordinator_node_id']?.toString() ?? '';
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return {};
}

List<Map<String, dynamic>> _mapList(Object? value) {
  if (value is! List) return [];
  return value
      .whereType<Map>()
      .map((item) => Map<String, dynamic>.from(item))
      .toList();
}

List<String> _stringList(Object? value) {
  if (value is! List) return [];
  return value.map((item) => item.toString()).toList();
}

Map<String, int> _intMap(Object? value) {
  return _map(value).map((key, value) {
    if (value is num) return MapEntry(key, value.toInt());
    return MapEntry(key, int.tryParse(value.toString()) ?? 0);
  });
}
