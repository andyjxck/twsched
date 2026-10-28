/* Two-step verification (TOTP authenticator app) for management logins.
 *
 *   Who: every login whose user type is in TWO_STEP_ROLES (owner and manager: "manager or above").
 *   The developer (maintenance) login is exempt: its user type 'developer' is NOT a role anywhere in
 *   firestore.rules, storage.rules or the callables, so it reaches no staff records, payroll, documents,
 *   rota or settings with or without a second factor. A login that is a manager or owner is never
 *   exempt, whatever its staff record says (a developer:true flag on a manager record exempts nothing).
 *
 *   How it is enforced (server side, not just hidden in the app):
 *     - custom claim mfa=true on the ID token means "this login must use two-step". It is set and
 *       cleared only by Cloud Functions / the admin script (tools/two-step/enforce.js).
 *     - firestore.rules and storage.rules treat a token with mfa=true and no second factor
 *       (firebase.sign_in_second_factor) as having no role at all, exactly like a pwChange token.
 *     - every callable that goes through gatedOnCall refuses the same token (reason two-step-required).
 *   Firebase puts firebase.sign_in_second_factor on the ID token only when the sign-in really
 *   completed a second factor, and the token is signed by Google, so the app can't fake it.
 *
 *   Switch: private/twoStep { enforced: bool }. Off (missing) = nothing changes for anyone, which is how
 *   this ships. When it is on, claimsFor() adds mfa=true for owners and managers automatically
 *   (new logins, promotions) and removes it on demotion. Turning it on or off for existing logins is a
 *   deliberate admin step (tools/two-step/enforce.js), never done by deploying.
 *
 *   Needs Firebase Authentication with Identity Platform (TOTP MFA enabled) and verified email
 *   addresses: Firebase refuses to enrol a second factor on an unverified email.
 */
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

// Payroll is NOT included: it is a separate user type, not above manager (see firestore.rules
// canPayroll). Add 'payroll' here and in the rules comment if payroll logins should need it too.
const TWO_STEP_ROLES = ['owner', 'manager'];
const EXEMPT_ROLES = ['developer'];
const CLAIM = 'mfa';
const SETTING = 'private/twoStep';
const TWO_STEP_REQUIRED = 'Set up two-step verification, then sign in again with your code.';

function secondFactor(token) {
  return (token && token.firebase && token.firebase.sign_in_second_factor) || null;
}
// True when this token belongs to a login that must use two-step but signed in without it.
function twoStepMissing(token) {
  return !!token && token[CLAIM] === true && !secondFactor(token);
}
function roleNeedsTwoStep(role) {
  return TWO_STEP_ROLES.includes(role) && !EXEMPT_ROLES.includes(role);
}
async function enforced() {
  const s = await admin.firestore().doc(SETTING).get();
  return s.exists && s.get('enforced') === true;
}
// Returns a copy of `claims` with the mfa claim set or removed for `role`.
function withTwoStepClaim(claims, role, isEnforced) {
  const c = { ...(claims || {}) };
  if (isEnforced && roleNeedsTwoStep(role)) c[CLAIM] = true;
  else delete c[CLAIM];
  return c;
}
function assertTwoStep(req) {
  if (req && req.auth && twoStepMissing(req.auth.token)) {
    throw new HttpsError('failed-precondition', TWO_STEP_REQUIRED, { reason: 'two-step-required' });
  }
}

module.exports = {
  TWO_STEP_ROLES, EXEMPT_ROLES, CLAIM, SETTING, TWO_STEP_REQUIRED,
  secondFactor, twoStepMissing, roleNeedsTwoStep, enforced, withTwoStepClaim, assertTwoStep,
};
