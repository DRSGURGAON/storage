#!/usr/bin/env bash
#
# Print the SHA-256 certificate fingerprint that /.well-known/assetlinks.json
# has to carry.
#
#   ops/twa/fingerprint.sh <keystore.jks> <alias>
#
# There are two of these and picking the wrong one is the usual reason a
# TWA still shows a URL bar:
#
#   * Your own upload/debug key -- what this prints. Correct for a
#     sideloaded APK you built yourself.
#   * Google's app-signing key -- if Play App Signing is on (it is, by
#     default), Google re-signs the app and *that* is the fingerprint users
#     verify against. Copy it from Play Console → Setup → App integrity →
#     App signing key certificate.
#
# When both are in play, put BOTH in assetlinks.json. Nothing breaks from
# listing two, and everything breaks from listing the wrong one.
set -euo pipefail

KEYSTORE="${1:?usage: ops/twa/fingerprint.sh <keystore> <alias>}"
ALIAS="${2:?alias required}"

keytool -list -v -keystore "${KEYSTORE}" -alias "${ALIAS}" \
  | grep -i "SHA256:" \
  | head -1 \
  | sed 's/.*SHA256: *//'
