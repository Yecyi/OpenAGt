import 'package:flutter_test/flutter_test.dart';
import 'package:opencode_flutter/main.dart';

void main() {
  testWidgets('shows deferred Flutter client placeholder', (tester) async {
    await tester.pumpWidget(const OpenAGtFlutterPlaceholderApp());

    expect(find.text('Flutter client deferred'), findsOneWidget);
    expect(find.textContaining('future mobile control-panel entry'), findsOneWidget);
  });
}
