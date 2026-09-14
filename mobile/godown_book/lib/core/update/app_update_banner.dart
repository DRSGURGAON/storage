import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme/brand.dart';
import 'app_update_service.dart';

/// "A newer build is ready" on the dashboard, with the one tap that
/// fetches it. The APK downloads in the browser and installs over the
/// running app as an update - same signature, higher build number, so
/// nothing is uninstalled and no data is lost. Zero height when there
/// is nothing newer.
class AppUpdateBanner extends StatefulWidget {
  const AppUpdateBanner({super.key});

  @override
  State<AppUpdateBanner> createState() => _AppUpdateBannerState();
}

class _AppUpdateBannerState extends State<AppUpdateBanner> {
  AppUpdateInfo? _update;
  bool _dismissed = false;

  @override
  void initState() {
    super.initState();
    AppUpdateService.instance.check().then((info) {
      if (mounted && info != null) setState(() => _update = info);
    });
  }

  @override
  Widget build(BuildContext context) {
    final update = _update;
    if (update == null || _dismissed) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Material(
        color: Brand.skySoft,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
          child: Row(
            children: [
              const Icon(Icons.system_update_outlined, color: Brand.skyInk),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Build ${update.buildNumber} is ready',
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, color: Brand.skyInk),
                    ),
                    const Text(
                      'Download and open it - it installs over this one, '
                      'your data stays.',
                      style: TextStyle(fontSize: 12, color: Brand.skyInk),
                    ),
                  ],
                ),
              ),
              TextButton(
                onPressed: () => launchUrl(
                  Uri.parse(update.apkUrl),
                  mode: LaunchMode.externalApplication,
                ),
                child: const Text('Update'),
              ),
              IconButton(
                icon: const Icon(Icons.close, size: 18),
                tooltip: 'Later',
                onPressed: () => setState(() => _dismissed = true),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
