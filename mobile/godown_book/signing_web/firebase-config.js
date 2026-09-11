// Your Firebase web configuration.
//
// These values are NOT secrets - Firebase publishes them in every web
// app - but they are specific to your project, so replace them before
// deploying. Find them in the Firebase Console under
// Project settings -> Your apps -> Web app -> SDK setup and configuration.
//
// The page only ever reads one signature request by its token and
// writes the signature back to it; the Firestore rules in
// ../firestore.rules are what actually enforce that.
window.GODOWN_BOOK_FIREBASE_CONFIG = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};
