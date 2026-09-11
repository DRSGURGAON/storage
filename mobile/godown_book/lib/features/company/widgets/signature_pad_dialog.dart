
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'signature_pad.dart';

/// Full-screen "Draw Signature" flow: pad, Clear, and Save (which
/// pops with the exported PNG bytes, or null if the user cancels).
class SignaturePadDialog extends StatefulWidget {
  const SignaturePadDialog({super.key});

  @override
  State<SignaturePadDialog> createState() => _SignaturePadDialogState();
}

class _SignaturePadDialogState extends State<SignaturePadDialog> {
  final _padKey = GlobalKey<SignaturePadState>();
  bool _hasStroke = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();

    // Forces this ONE screen into landscape - a signature is
    // naturally wide and short, and previously this screen had no
    // orientation lock of its own, so a user physically turning the
    // phone sideways to get more width to sign on was drawing
    // strokes into a widget whose own layout hadn't actually rotated
    // to match (AndroidManifest.xml's own configChanges list keeps
    // the Activity from being torn down on rotation, but did nothing
    // to REQUEST landscape here) - the exported PNG came out sideways
    // relative to how every other document reads it, because nothing
    // this app does ever rotates a signature image after capture.
    // Locking the orientation here instead means the phone genuinely
    // rotates into landscape for this screen, SignaturePad's own
    // widget re-lays-out into a true wide/short canvas, and the
    // strokes are recorded directly in that already-correct
    // coordinate space - no rotation needed anywhere downstream, so
    // every document that embeds this signature (Money Receipt,
    // Warehouse Receipt, Bill, etc.) keeps showing it exactly as it does
    // today, just no longer sideways.
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
  }

  @override
  void dispose() {
    // Restores the app's normal portrait-only behaviour for every
    // OTHER screen - this lock must never leak past this one dialog.
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _saving = true);

    final bytes = await _padKey.currentState?.exportPng();

    if (!mounted) return;

    Navigator.pop(context, bytes);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Draw Signature'),
        actions: [
          TextButton(
            onPressed: _hasStroke && !_saving
                ? () => _padKey.currentState?.clear()
                : null,
            child: const Text('Clear'),
          ),
        ],
        // The instruction line moved here (from the body, where it
        // previously took its own row of vertical space) specifically
        // because landscape is a genuinely short screen - what read
        // as a harmless line of text in portrait's own much taller
        // viewport became real competition for space against the
        // canvas once this screen locked to landscape (see initState's
        // own doc comment on why it's landscape at all), which is
        // exactly why the drawing area itself measured visibly
        // shorter after that change. Folding the hint into the
        // AppBar's own bottom strip (a fixed, compact 22px) frees
        // that entire row for the canvas below instead.
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(22),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              'Draw your authorised signature below',
              style: TextStyle(
                color: Colors.grey.shade600,
                fontSize: 11,
              ),
            ),
          ),
        ),
      ),
      body: SafeArea(
        child: Padding(
          // Halved from 16 - the same "landscape is short" reasoning
          // as the AppBar change above: every point of padding here
          // is a point the canvas doesn't get.
          padding: const EdgeInsets.all(8),
          child: Column(
            children: [
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.grey.shade400),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: SignaturePad(
                    key: _padKey,
                    onChanged: (hasStroke) =>
                        setState(() => _hasStroke = hasStroke),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                // Shrunk from 50 - a signature pad's own Save button
                // doesn't need portrait's full-height tap target on a
                // screen this short; every pixel back here is a pixel
                // the canvas above keeps instead.
                height: 40,
                child: ElevatedButton(
                  onPressed: _hasStroke && !_saving
                      ? _save
                      : null,
                  child: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Save Signature'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
