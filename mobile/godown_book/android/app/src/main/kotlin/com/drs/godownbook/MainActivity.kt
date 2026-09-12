// The manifest declares this activity as ".MainActivity", which the
// build resolves against the module's namespace - com.drs.godownbook.
// The package here has to match that exactly, or the launcher asks for
// a class that does not exist and the app dies the moment it is opened.
package com.drs.godownbook

import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity()
