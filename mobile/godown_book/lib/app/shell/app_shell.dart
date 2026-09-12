import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/brand.dart';

/// The bar along the bottom of the three screens an operator lives on.
/// Home, Customers and Documents are tabs that keep their own place;
/// Speak is an action - it opens a new storage entry with the voice
/// sheet already up, on top of whatever tab is showing.
class AppShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const AppShell({super.key, required this.navigationShell});

  @override
  Widget build(BuildContext context) {
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
    navigationShell.goBranch(
      index,
      initialLocation: index == navigationShell.currentIndex,
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
