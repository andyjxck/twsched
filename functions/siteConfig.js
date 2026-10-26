'use strict';
/**
 * Where the staff app lives. One place for every server-side link to the app and for the sites
 * allowed to call the public callables (CORS). Change it here and redeploy the functions that use it.
 *
 * www.tws-rota.co.uk redirects to the bare domain, so it never calls a function itself.
 * The old GitHub Pages address (andyjxck.github.io/twsched) is gone (404) and is no longer allowed.
 */
const APP_URL = 'https://tws-rota.co.uk/';
const APP_ORIGINS = [
  'https://tws-rota.co.uk',
  'https://twsched-f8b16.web.app',
  'https://twsched-f8b16.firebaseapp.com',
];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

module.exports = { APP_URL, APP_ORIGINS, LOCAL_ORIGIN };
