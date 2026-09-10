# Putting it on a phone

Two ways, and the first one takes five minutes.

## 1. Install it as an app, today (no Android build at all)

This is a real install: its own icon, its own window, no browser chrome.
It is the same thing a Play Store TWA would give you, minus the store
listing.

The only requirement is **HTTPS**. Chrome will not offer to install a site
served over plain `http://`, however well it works — so a laptop on the
office WiFi is not enough on its own.

```bash
# 1. run the stack
docker compose up -d

# 2. put an HTTPS address in front of it (either one; no account needed for the first)
cloudflared tunnel --url http://localhost:8080
#   -> https://something-random.trycloudflare.com
# or
ngrok http 8080
```

Take the `https://…` address it prints, put it in `.env`, and restart so
document QR codes and password-reset links point at somewhere the phone
can actually reach:

```bash
PUBLIC_WEB_URL=https://something-random.trycloudflare.com
PUBLIC_APP_URL=https://something-random.trycloudflare.com/api
```

```bash
docker compose up -d
```

Then on the phone, in **Chrome** (not the in-app browser of WhatsApp or
Gmail — those cannot install anything):

1. open the `https://…` address
2. ⋮ menu → **Install app** (or *Add to Home screen* → *Install*)
3. it appears on the home screen with the warehouse icon and opens
   full-screen

On **iPhone** it is Safari → Share → *Add to Home Screen*. iOS installs the
same manifest but never shows an install prompt of its own; it has to be
done from the Share sheet.

A `trycloudflare.com` address changes every time the tunnel restarts, which
is fine for trying it and no good for real users. For that, point a domain
you own at the machine and terminate TLS there — see
`docs/architecture/deployment.md`.

## 2. An actual APK, and the Play Store

Only worth doing once the app is on a **stable HTTPS domain you control**.
Everything below depends on that domain, and redoing it after the address
changes is the whole job again.

### Build the APK

[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) is Google's own
tool for this. It reads the web manifest this app already ships and
produces an Android project around it.

```bash
npm install -g @bubblewrap/cli

# First run offers to download the JDK and Android SDK it needs (~1 GB).
bubblewrap init --manifest https://warehouse.yourcompany.com/manifest.webmanifest
```

It will ask a few things. The answers that matter:

| Question | Answer |
| --- | --- |
| Application ID | `com.yourcompany.warehouse` — permanent, and cannot be changed after the first Play upload |
| Host | your domain, no scheme |
| Start URL | `/` |
| Display mode | `standalone` |
| Signing key | let it create one, and **back that file up** — lose it and you cannot update the app |

```bash
bubblewrap build          # -> app-release-signed.apk and app-release-bundle.aab
```

### Sideload it, to check before uploading

```bash
adb install app-release-signed.apk
```

Or copy the `.apk` to the phone and open it (Settings → *Install unknown
apps* for whichever app you copied it with).

### Make the URL bar go away

A freshly installed TWA shows the address across the top until the site
confirms it knows about the app. That is Digital Asset Links, and this
repository serves it for you:

```bash
# the fingerprint of the key Bubblewrap made
ops/twa/fingerprint.sh android.keystore android

# put it in .env, with the application id
ANDROID_PACKAGE_NAME=com.yourcompany.warehouse
ANDROID_SHA256_FINGERPRINT=AB:CD:…:EF

docker compose up -d web
```

Check it is live before reinstalling:

```bash
curl https://warehouse.yourcompany.com/.well-known/assetlinks.json
```

Reinstall the app; the URL bar goes.

> **The mistake everyone makes here.** With Play App Signing on — it is on
> by default — Google re-signs your upload with *its* key, so the
> fingerprint users verify against is not the one you built with. Take it
> from Play Console → Setup → App integrity → *App signing key
> certificate*. Listing both fingerprints in `assetlinks.json` is fine and
> is what you want while you are also sideloading test builds; listing only
> yours means the URL bar stays for everyone who installs from the store.
>
> Nothing here writes that file unless both variables are set, on purpose:
> a file with the wrong fingerprint in it fails verification in a way that
> reads like a signing bug.

### Then the store

Upload `app-release-bundle.aab` to Play Console. It will also want:

- a **privacy policy URL** — `https://your-domain/privacy`, served by this app
- an **account deletion URL** — `https://your-domain/delete-account`, likewise
- the **Data Safety** form — the privacy page describes what is collected;
  answer it from there
- a content rating questionnaire, and store graphics

And for a personal (non-organisation) developer account, Google requires
**12 testers for 14 continuous days** in closed testing before production
access. Start that clock early; it is usually the longest pole.
