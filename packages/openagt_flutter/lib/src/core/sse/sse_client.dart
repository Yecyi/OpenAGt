import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

enum SSEEventType {
  sessionCreated,
  sessionUpdated,
  sessionDeleted,
  messageUpdated,
  messagePartUpdated,
  messagePartDelta,
  messagePartRemoved,
  permissionAsked,
  questionAsked,
  coordinatorCreated,
  coordinatorUpdated,
  coordinatorCompleted,
  taskUpdated,
  unknown,
}

class SSEEvent {
  final SSEEventType type;
  final String? sessionId;
  final String? messageId;
  final String? partId;
  final String? data;
  final Map<String, dynamic>? payload;

  SSEEvent({
    required this.type,
    this.sessionId,
    this.messageId,
    this.partId,
    this.data,
    this.payload,
  });

  factory SSEEvent.parse(String eventLine, String? data) {
    final typeStr = eventLine.replaceFirst('event:', '').trim();
    final type = _parseEventType(typeStr);

    Map<String, dynamic>? payload;
    if (data != null && data.isNotEmpty) {
      try {
        payload = _parsePayload(data);
      } catch (e) {
        debugPrint('Failed to parse SSE payload: $e');
      }
    }

    return SSEEvent(
      type: type,
      sessionId: payload?['session_id'] as String?,
      messageId: payload?['message_id'] as String?,
      partId: payload?['part_id'] as String?,
      data: data,
      payload: payload,
    );
  }

  static SSEEventType _parseEventType(String typeStr) {
    switch (typeStr) {
      case 'session.created':
        return SSEEventType.sessionCreated;
      case 'session.updated':
        return SSEEventType.sessionUpdated;
      case 'session.deleted':
        return SSEEventType.sessionDeleted;
      case 'message.updated':
        return SSEEventType.messageUpdated;
      case 'message.part.updated':
        return SSEEventType.messagePartUpdated;
      case 'message.part.delta':
        return SSEEventType.messagePartDelta;
      case 'message.part.removed':
        return SSEEventType.messagePartRemoved;
      case 'permission.asked':
        return SSEEventType.permissionAsked;
      case 'question.asked':
        return SSEEventType.questionAsked;
      case 'coordinator.created':
        return SSEEventType.coordinatorCreated;
      case 'coordinator.updated':
        return SSEEventType.coordinatorUpdated;
      case 'coordinator.completed':
        return SSEEventType.coordinatorCompleted;
      case 'task.updated':
        return SSEEventType.taskUpdated;
      default:
        return SSEEventType.unknown;
    }
  }

  static Map<String, dynamic> _parsePayload(String data) {
    // Handle JSON with event wrapper
    if (data.startsWith('{')) {
      return Map<String, dynamic>.from(
        data.contains('"properties"')
            ? _extractNestedPayload(data)
            : jsonDecode(data),
      );
    }
    return {};
  }

  static Map<String, dynamic> _extractNestedPayload(String data) {
    try {
      final decoded = jsonDecode(data);
      if (decoded is Map && decoded['properties'] != null) {
        return Map<String, dynamic>.from(decoded['properties']);
      }
      return decoded is Map ? decoded : {};
    } catch (e) {
      return {};
    }
  }
}

class SSEClient {
  final Dio _dio;
  final String baseUrl;
  CancelToken? _cancelToken;
  StreamController<SSEEvent>? _controller;

  SSEClient({
    required this.baseUrl,
    Dio? dio,
  }) : _dio = dio ?? Dio() {
    _dio.options.baseUrl = baseUrl;
  }

  Stream<SSEEvent> connect({String? sessionId, Map<String, String>? headers}) {
    _cancelToken = CancelToken();
    _controller = StreamController<SSEEvent>.broadcast();

    _connectSSE(sessionId: sessionId, headers: headers);

    return _controller!.stream;
  }

  Future<void> _connectSSE({String? sessionId, Map<String, String>? headers}) async {
    try {
      final url = sessionId != null ? '/event?session=$sessionId' : '/event';
      final response = await _dio.get<ResponseBody>(
        url,
        options: Options(
          responseType: ResponseType.stream,
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...?headers,
          },
        ),
        cancelToken: _cancelToken,
      );

      final stream = response.data?.stream;
      if (stream == null) {
        _controller?.addError('No stream available');
        return;
      }

      String currentEvent = '';
      String currentData = '';

      await for (final chunk in stream) {
        final lines = utf8.decode(chunk).split('\n');
        for (final line in lines) {
          if (line.startsWith('event:')) {
            currentEvent = line;
          } else if (line.startsWith('data:')) {
            currentData = line.substring(5).trim();
          } else if (line.isEmpty) {
            // Event complete
            if (currentEvent.isNotEmpty || currentData.isNotEmpty) {
              final event = SSEEvent.parse(currentEvent, currentData);
              _controller?.add(event);
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }
    } on DioException catch (e) {
      if (e.type != DioExceptionType.cancel) {
        _controller?.addError(e);
      }
    } catch (e) {
      _controller?.addError(e);
    } finally {
      if (_controller?.isClosed == false) {
        await _controller?.close();
      }
    }
  }

  void disconnect() {
    _cancelToken?.cancel('Client disconnected');
    if (_controller?.isClosed == false) {
      _controller?.close();
    }
  }

  void dispose() {
    disconnect();
  }
}

class SSEClientPool {
  final Map<String, SSEClient> _clients = {};

  SSEClient getClient(String serverUrl) {
    if (!_clients.containsKey(serverUrl)) {
      _clients[serverUrl] = SSEClient(baseUrl: serverUrl);
    }
    return _clients[serverUrl]!;
  }

  void disposeAll() {
    for (final client in _clients.values) {
      client.dispose();
    }
    _clients.clear();
  }
}
