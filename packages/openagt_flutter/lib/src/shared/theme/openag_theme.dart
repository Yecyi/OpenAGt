import 'package:flutter/material.dart';

class OpenAGtColors {
  // Light theme - Level 0: Base canvas
  static const Color surface = Color(0xFFF9F9F9);
  static const Color surfaceContainerLow = Color(0xFFF3F3F3);
  static const Color surfaceContainerLowest = Color(0xFFFFFFFF);
  static const Color surfaceContainerHigh = Color(0xFFE8E8E8);
  static const Color surfaceContainerHighest = Color(0xFFE2E2E2);

  // Text colors
  static const Color primary = Color(0xFF000000);
  static const Color onSurface = Color(0xFF1B1B1B);
  static const Color onSurfaceVariant = Color(0xFF474747);
  static const Color outline = Color(0xFF777777);
  static const Color outlineVariant = Color(0xFFC6C6C6);

  // Accent colors
  static const Color primaryContainer = Color(0xFF3B3B3B);
  static const Color onPrimary = Color(0xFFE2E2E2);
  static const Color onPrimaryContainer = Color(0xFFFFFFFF);

  // Error colors
  static const Color error = Color(0xFFBA1A1A);
  static const Color onError = Color(0xFFFFFFFF);
  static const Color errorContainer = Color(0xFFFFDAD6);
  static const Color onErrorContainer = Color(0xFF410002);

  // Dark theme colors
  static const Color surfaceDark = Color(0xFF1A1A1A);
  static const Color surfaceContainerLowDark = Color(0xFF222222);
  static const Color surfaceContainerLowestDark = Color(0xFF2A2A2A);
  static const Color primaryDark = Color(0xFFF0F0F0);
}

class OpenAGtTheme {
  static const String _newsreaderFamily = 'Newsreader';
  static const String _publicSansFamily = 'Public Sans';

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: const ColorScheme.light(
        surface: OpenAGtColors.surface,
        onSurface: OpenAGtColors.onSurface,
        primary: OpenAGtColors.primary,
        onPrimary: OpenAGtColors.onPrimary,
        primaryContainer: OpenAGtColors.primaryContainer,
        onPrimaryContainer: OpenAGtColors.onPrimaryContainer,
        secondary: OpenAGtColors.onSurfaceVariant,
        onSecondary: OpenAGtColors.onPrimary,
        secondaryContainer: OpenAGtColors.surfaceContainerHighest,
        onSecondaryContainer: OpenAGtColors.onSurface,
        outline: OpenAGtColors.outline,
        outlineVariant: OpenAGtColors.outlineVariant,
        error: OpenAGtColors.error,
        onError: OpenAGtColors.onError,
        errorContainer: OpenAGtColors.errorContainer,
        onErrorContainer: OpenAGtColors.onErrorContainer,
      ),
      scaffoldBackgroundColor: OpenAGtColors.surface,
      appBarTheme: const AppBarTheme(
        backgroundColor: OpenAGtColors.surface,
        foregroundColor: OpenAGtColors.primary,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: _newsreaderFamily,
          fontSize: 24,
          fontWeight: FontWeight.w700,
          fontStyle: FontStyle.italic,
          letterSpacing: -0.5,
          color: OpenAGtColors.primary,
        ),
      ),
      textTheme: _buildTextTheme(Brightness.light),
      cardTheme: const CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.zero,
        ),
        color: OpenAGtColors.surfaceContainerLowest,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: OpenAGtColors.surfaceContainerHighest,
        border: const OutlineInputBorder(
          borderRadius: BorderRadius.zero,
          borderSide: BorderSide.none,
        ),
        focusedBorder: UnderlineInputBorder(
          borderRadius: BorderRadius.zero,
          borderSide: BorderSide(color: OpenAGtColors.primary, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: OpenAGtColors.primary,
          foregroundColor: OpenAGtColors.onPrimary,
          elevation: 0,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.zero,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: OpenAGtColors.primary,
          side: const BorderSide(color: OpenAGtColors.primary),
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.zero,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: OpenAGtColors.outlineVariant,
        thickness: 1,
        space: 1,
      ),
      listTileTheme: const ListTileThemeData(
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.zero,
        ),
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: OpenAGtColors.surfaceContainerLow,
        selectedIconTheme: IconThemeData(color: OpenAGtColors.primary),
        unselectedIconTheme: IconThemeData(color: OpenAGtColors.onSurfaceVariant),
        indicatorColor: OpenAGtColors.surfaceContainerHighest,
      ),
    );
  }

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        surface: OpenAGtColors.surfaceDark,
        onSurface: Color(0xFFF0F0F0),
        primary: Color(0xFFF0F0F0),
        onPrimary: Color(0xFF1A1A1A),
        primaryContainer: Color(0xFF3A3A3A),
        onPrimaryContainer: Color(0xFFF0F0F0),
        secondary: Color(0xFFB0B0B0),
        onSecondary: Color(0xFF1A1A1A),
        secondaryContainer: Color(0xFF2A2A2A),
        onSecondaryContainer: Color(0xFFF0F0F0),
        outline: Color(0xFF808080),
        outlineVariant: Color(0xFF404040),
        error: Color(0xFFFFB4AB),
        onError: Color(0xFF690005),
        errorContainer: Color(0xFF93000A),
        onErrorContainer: Color(0xFFFFDAD6),
      ),
      scaffoldBackgroundColor: OpenAGtColors.surfaceDark,
      appBarTheme: const AppBarTheme(
        backgroundColor: OpenAGtColors.surfaceDark,
        foregroundColor: Color(0xFFF0F0F0),
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: _newsreaderFamily,
          fontSize: 24,
          fontWeight: FontWeight.w700,
          fontStyle: FontStyle.italic,
          letterSpacing: -0.5,
          color: Color(0xFFF0F0F0),
        ),
      ),
      textTheme: _buildTextTheme(Brightness.dark),
      cardTheme: const CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.zero,
        ),
        color: OpenAGtColors.surfaceContainerLowestDark,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF2A2A2A),
        border: const OutlineInputBorder(
          borderRadius: BorderRadius.zero,
          borderSide: BorderSide.none,
        ),
        focusedBorder: UnderlineInputBorder(
          borderRadius: BorderRadius.zero,
          borderSide: const BorderSide(color: Color(0xFFF0F0F0), width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFFF0F0F0),
          foregroundColor: const Color(0xFF1A1A1A),
          elevation: 0,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.zero,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: Color(0xFF404040),
        thickness: 1,
        space: 1,
      ),
    );
  }

  static TextTheme _buildTextTheme(Brightness brightness) {
    final Color textColor =
        brightness == Brightness.light ? OpenAGtColors.onSurface : const Color(0xFFF0F0F0);
    final Color textColorVariant =
        brightness == Brightness.light ? OpenAGtColors.onSurfaceVariant : const Color(0xFFB0B0B0);

    return TextTheme(
      displayLarge: TextStyle(
        fontFamily: _newsreaderFamily,
        fontSize: 56,
        fontWeight: FontWeight.w400,
        height: 1.1,
        letterSpacing: 0.02,
        color: textColor,
      ),
      displayMedium: TextStyle(
        fontFamily: _newsreaderFamily,
        fontSize: 40,
        fontWeight: FontWeight.w400,
        height: 1.15,
        letterSpacing: 0.02,
        color: textColor,
      ),
      headlineLarge: TextStyle(
        fontFamily: _newsreaderFamily,
        fontSize: 32,
        fontWeight: FontWeight.w400,
        height: 1.2,
        letterSpacing: 0.02,
        color: textColor,
      ),
      headlineMedium: TextStyle(
        fontFamily: _newsreaderFamily,
        fontSize: 28,
        fontWeight: FontWeight.w400,
        height: 1.25,
        color: textColor,
      ),
      headlineSmall: TextStyle(
        fontFamily: _newsreaderFamily,
        fontSize: 24,
        fontWeight: FontWeight.w400,
        height: 1.3,
        color: textColor,
      ),
      bodyLarge: TextStyle(
        fontFamily: _newsreaderFamily,
        fontSize: 18,
        fontWeight: FontWeight.w400,
        height: 1.6,
        color: textColor,
      ),
      bodyMedium: TextStyle(
        fontFamily: _publicSansFamily,
        fontSize: 16,
        fontWeight: FontWeight.w400,
        height: 1.5,
        color: textColor,
      ),
      bodySmall: TextStyle(
        fontFamily: _publicSansFamily,
        fontSize: 14,
        fontWeight: FontWeight.w400,
        height: 1.4,
        color: textColorVariant,
      ),
      labelLarge: TextStyle(
        fontFamily: _publicSansFamily,
        fontSize: 14,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.05,
        color: textColor,
      ),
      labelMedium: TextStyle(
        fontFamily: _publicSansFamily,
        fontSize: 12,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.1,
        color: textColorVariant,
      ),
      labelSmall: TextStyle(
        fontFamily: _publicSansFamily,
        fontSize: 10,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.15,
        color: textColorVariant,
      ),
    );
  }
}
