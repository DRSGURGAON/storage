import 'package:flutter/material.dart';

/// The branded Flutter-side splash sequence, shown for one brief
/// moment right after the native OS splash (Android 12+ SplashScreen
/// API, or the legacy launch_background.xml on older versions) hands
/// off to Flutter's first frame.
///
/// WHY THIS EXISTS ALONGSIDE THE NATIVE SPLASH, NOT INSTEAD OF IT:
/// the native splash covers the *real* initialization gap (Firebase
/// init, auth/tenant load - all awaited in main() before runApp() is
/// even called), and its own duration genuinely varies with device
/// speed and network conditions - there is no way to choreograph a
/// multi-step "logo fades in, then text, then tagline" sequence
/// against an unpredictable duration without either cutting it short
/// or padding it artificially. Android's own native splash APIs are
/// also too limited for a multi-element staged animation (confirmed
/// via official Android docs - the SplashScreen API supports a single
/// centered icon and a background color, not staged text reveals).
///
/// So the sequence is split in two: the native splash owns the
/// *unpredictable* wait (real app initialization), and this widget
/// owns the *fixed, brief* branded moment (~1.5s) once Flutter is
/// already running and that initialization has already finished. By
/// the time this widget's own frame is drawn, every await in main()
/// has already completed - so nothing here is an artificial delay on
/// top of startup; app.dart already lets the login/dashboard route
/// resolve on the same frame this widget appears, and this simply
/// occupies the screen for its own animation before revealing it.
class BrandedSplashScreen extends StatefulWidget {
  final Widget child;

  const BrandedSplashScreen({super.key, required this.child});

  @override
  State<BrandedSplashScreen> createState() => _BrandedSplashScreenState();
}

class _BrandedSplashScreenState extends State<BrandedSplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  // Four staged intervals within one controller, matching the task's
  // own explicit 4-step sequence (logo fade+scale -> brand name
  // fade/slide -> tagline fade -> reveal). Deliberately simple,
  // professional easing (no bounce/elastic/particle effects, per the
  // task's own explicit exclusions).
  late final Animation<double> _logoOpacity;
  late final Animation<double> _logoScale;
  late final Animation<double> _nameOpacity;
  late final Animation<Offset> _nameSlide;
  late final Animation<double> _taglineOpacity;

  bool _showApp = false;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 850),
    );

    _logoOpacity = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.0, 0.40, curve: Curves.easeOut),
    );
    _logoScale = Tween<double>(begin: 0.92, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.40, curve: Curves.easeOut),
      ),
    );

    _nameOpacity = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.25, 0.65, curve: Curves.easeOut),
    );
    _nameSlide = Tween<Offset>(
      begin: const Offset(0, 0.15),
      end: Offset.zero,
    ).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.25, 0.65, curve: Curves.easeOut),
      ),
    );

    _taglineOpacity = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.50, 0.90, curve: Curves.easeOut),
    );

    _controller.forward();

    // Holds briefly on the completed brand mark (interval 0.80-1.0 is
    // genuinely idle time, not another animation) before revealing
    // the real app - a beat of stillness reads as more deliberate
    // than cutting straight from "tagline fades in" to "gone".
    _controller.addStatusListener((status) {
      if (status == AnimationStatus.completed && mounted) {
        setState(() => _showApp = true);
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_showApp) {
      // A short cross-fade into the real app (login/dashboard,
      // whichever the router already resolved) rather than a hard
      // cut - task's own "Step 5: Transition smoothly into the
      // existing login screen."
      return AnimatedSwitcher(
        duration: const Duration(milliseconds: 220),
        child: widget.child,
      );
    }

    return Scaffold(
      // Same light-teal brand tint as the native splash
      // (#EBF8F8, matches android/app/src/main/res/values/colors.xml)
      // so there is genuinely no color jump at the native-to-Flutter
      // handoff.
      backgroundColor: const Color(0xFFEBF8F8),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            FadeTransition(
              opacity: _logoOpacity,
              child: ScaleTransition(
                scale: _logoScale,
                child: Image.asset(
                  'assets/images/godown_book_logo.png',
                  width: 160,
                  fit: BoxFit.contain,
                ),
              ),
            ),
            const SizedBox(height: 20),
            FadeTransition(
              opacity: _nameOpacity,
              child: SlideTransition(
                position: _nameSlide,
                child: const Text(
                  'Godown Book',
                  style: TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF0A2540),
                    letterSpacing: 0.3,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            FadeTransition(
              opacity: _taglineOpacity,
              child: const Text(
                'Storage Receipts, Gate Passes & Rent Bills for Godowns',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  color: Color(0xFF0095A8),
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
