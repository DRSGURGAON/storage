import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme/brand.dart';

/// The bar along the bottom of the three screens an operator lives on.
/// Home, Customers and Documents are tabs that keep their own place;
/// Speak is an action - it opens a new storage entry with the voice
/// sheet already up, on top of whatever tab is showing.
///
/// It also owns what the phone's Back button does once every pushed
/// screen has been popped: from Customers or Documents it returns to
/// Home, and only a second press on Home - within two seconds, and only
/// after a message saying so - actually closes the app. Before this, one
/// stray back press shut the app outright, halfway through a day's
/// entries.
class AppShell extends StatefulWidget {
  final StatefulNavigationShell navigationShell;

  const AppShell({super.key, required this.navigationShell});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  static const Duration _exitWindow = Duration(seconds: 2);

  /// The "press back again" message while it is on screen. Its own
  /// lifetime IS the window: the app closes on a second press only
  /// while the operator can still see what that press will do.
  ScaffoldFeatureController<SnackBar, SnackBarClosedReason>? _exitPrompt;

  void _handleBack() {
    // On another tab, Back means "back to Home", not "quit".
    if (widget.navigationShell.currentIndex != 0) {
      _goBranch(0);
      return;
    }

    if (_exitPrompt != null) {
      SystemNavigator.pop();
      return;
    }

    final prompt = ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Press back again to exit'),
        duration: _exitWindow,
      ),
    );
    _exitPrompt = prompt;
    prompt.closed.then((_) {
      if (identical(_exitPrompt, prompt)) _exitPrompt = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        _handleBack();
      },
      child: _scaffold(),
    );
  }

  Widget _scaffold() {
    final navigationShell = widget.navigationShell;

    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: Brand.card,
          border: Border(top: BorderSide(color: Brand.line)),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 66,
            child: Row(
              children: [
                _Item(
                  icon: Icons.home_rounded,
                  label: 'Home',
                  selected: navigationShell.currentIndex == 0,
                  onTap: () => _goBranch(0),
                ),
                _Item(
                  icon: Icons.people_outline,
                  label: 'Customers',
                  selected: navigationShell.currentIndex == 1,
                  onTap: () => _goBranch(1),
                ),
                _Item(
                  icon: Icons.folder_open_outlined,
                  label: 'Documents',
                  selected: navigationShell.currentIndex == 2,
                  onTap: () => _goBranch(2),
                ),
                _Item(
                  icon: Icons.mic_none,
                  label: 'Speak',
                  selected: false,
                  onTap: () => context.push('/storage-create', extra: 'voice'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _goBranch(int index) {
    // Tapping the tab you are on takes you back to its first screen.
    widget.navigationShell.goBranch(
      index,
      initialLocation: index == widget.navigationShell.currentIndex,
    );
  }
}

class _Item extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Item({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              height: 30,
              padding: EdgeInsets.symmetric(horizontal: selected ? 16 : 0),
              decoration: BoxDecoration(
                color: selected ? Brand.navy : Colors.transparent,
                borderRadius: BorderRadius.circular(15),
              ),
              child: Icon(icon, size: 21, color: selected ? Brand.green : Brand.inkMuted),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w700,
                color: selected ? Brand.navy : Brand.inkMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
