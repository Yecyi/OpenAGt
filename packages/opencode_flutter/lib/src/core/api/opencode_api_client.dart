import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

class OpenCodeApiClient {
  final Dio _dio;
  final String baseUrl;
  String? _authToken;

  OpenCodeApiClient({
    required this.baseUrl,
    Dio? dio,
    String? authToken,
  })  : _dio = dio ?? Dio(),
        _authToken = authToken {
    _dio.options.baseUrl = baseUrl;
    _dio.options.connectTimeout = const Duration(seconds: 10);
    _dio.options.receiveTimeout = const Duration(seconds: 30);
    _dio.interceptors.add(_createInterceptor());
  }

  InterceptorsWrapper _createInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_authToken != null) {
          options.headers['Authorization'] = 'Bearer $_authToken';
        }
        options.headers['Content-Type'] = 'application/json';
        return handler.next(options);
      },
      onError: (error, handler) {
        debugPrint('API Error: ${error.message}');
        return handler.next(error);
      },
    );
  }

  void setAuthToken(String? token) {
    _authToken = token;
  }

  // Session endpoints
  Future<List<Map<String, dynamic>>> listSessions() async {
    final response = await _dio.get('/session');
    return List<Map<String, dynamic>>.from(response.data);
  }

  Future<Map<String, dynamic>> getSession(String sessionId) async {
    final response = await _dio.get('/session/$sessionId');
    return Map<String, dynamic>.from(response.data);
  }

  Future<Map<String, dynamic>> createSession({
    String? projectId,
    String? agent,
  }) async {
    final response = await _dio.post('/session', data: {
      if (projectId != null) 'project_id': projectId,
      if (agent != null) 'agent': agent,
    });
    return Map<String, dynamic>.from(response.data);
  }

  Future<void> deleteSession(String sessionId) async {
    await _dio.delete('/session/$sessionId');
  }

  Future<Map<String, dynamic>> sendMessage(
    String sessionId,
    String content, {
    String? attachFiles,
  }) async {
    final response = await _dio.post(
      '/session/$sessionId/message',
      data: {
        'content': content,
        if (attachFiles != null) 'attach_files': attachFiles,
      },
    );
    return Map<String, dynamic>.from(response.data);
  }

  Future<void> abortSession(String sessionId) async {
    await _dio.post('/session/$sessionId/abort');
  }

  Future<Map<String, dynamic>> forkSession(String sessionId) async {
    final response = await _dio.post('/session/$sessionId/fork');
    return Map<String, dynamic>.from(response.data);
  }

  // Config endpoints
  Future<Map<String, dynamic>> getConfig() async {
    final response = await _dio.get('/config');
    return Map<String, dynamic>.from(response.data);
  }

  Future<List<Map<String, dynamic>>> listProviders() async {
    final response = await _dio.get('/provider');
    return List<Map<String, dynamic>>.from(response.data);
  }

  Future<List<Map<String, dynamic>>> listAgents() async {
    final response = await _dio.get('/agent');
    return List<Map<String, dynamic>>.from(response.data);
  }

  // Permission endpoints
  Future<List<Map<String, dynamic>>> getPermissions() async {
    final response = await _dio.get('/permission');
    return List<Map<String, dynamic>>.from(response.data);
  }

  Future<void> respondToPermission(String permissionId, bool allow) async {
    await _dio.post('/permission/$permissionId/reply', data: {
      'allow': allow,
    });
  }

  // Project endpoints
  Future<Map<String, dynamic>> getProject() async {
    final response = await _dio.get('/project');
    return Map<String, dynamic>.from(response.data);
  }

  Future<Map<String, dynamic>> getVcsDiff() async {
    final response = await _dio.get('/vcs/diff');
    return Map<String, dynamic>.from(response.data);
  }
}
