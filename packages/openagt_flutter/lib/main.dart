import 'package:flutter/material.dart';

void main() {
  runApp(const OpenAGtFlutterPlaceholderApp());
}

class OpenAGtFlutterPlaceholderApp extends StatelessWidget {
  const OpenAGtFlutterPlaceholderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OpenAGt Flutter',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF3168D8)),
        useMaterial3: true,
      ),
      home: const DeferredClientScreen(),
    );
  }
}

class DeferredClientScreen extends StatelessWidget {
  const DeferredClientScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('OpenAGt Flutter')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Icon(Icons.phone_iphone, size: 56),
              SizedBox(height: 24),
              Text(
                'Flutter client deferred',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
              ),
              SizedBox(height: 12),
              Text(
                'This package is kept as a future mobile control-panel entry. '
                'Current stable work focuses on backend contracts, CLI, TUI, headless server, web UI, and SDK.',
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
