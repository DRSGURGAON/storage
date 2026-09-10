#!/bin/sh
# Writes /.well-known/assetlinks.json, if this deployment claims an Android app.
#
# nginx's own image runs everything in /docker-entrypoint.d/ before it
# starts, which is where this belongs: the file depends on the signing key
# of the APK, and that is a deployment fact rather than a build one -- the
# same image serves a debug build today and a Play-signed one tomorrow.
#
# Both variables or neither. A file containing an empty fingerprint would
# make Android report a verification failure that reads like a signing
# problem, and cost somebody an afternoon.
set -e

TARGET=/etc/nginx/well-known/assetlinks.json
mkdir -p /etc/nginx/well-known

if [ -z "${ANDROID_PACKAGE_NAME:-}" ] || [ -z "${ANDROID_SHA256_FINGERPRINT:-}" ]; then
  rm -f "${TARGET}"
  echo "assetlinks: not claimed (ANDROID_PACKAGE_NAME / ANDROID_SHA256_FINGERPRINT unset)"
  exit 0
fi

cat > "${TARGET}" <<JSON
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "${ANDROID_PACKAGE_NAME}",
    "sha256_cert_fingerprints": ["${ANDROID_SHA256_FINGERPRINT}"]
  }
}]
JSON
echo "assetlinks: claiming ${ANDROID_PACKAGE_NAME}"
