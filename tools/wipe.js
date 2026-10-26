// One-off wipe of seeded/test data (backup taken first in ../backups).
const {GoogleAuth} = require('google-auth-library');
const P = 'projects/twsched-f8b16/databases/(default)/documents/';
const H = {'x-goog-user-project': 'twsched-f8b16'};
const docs = [
  'enquiries/NrrTklb432HElrrc9AUg', 'enquiries/TzZPgLwIBBCboPV7YjkW',
  'notifications/vY3VEUxYYaqUF1djDVT2',
  'payPeriods/2026-10-06/hours/ufzwab0MHNTpzly86Uah4GmmoHn1', 'payPeriods/2026-10-06',
  'rotaBlocks/ufzwab0MHNTpzly86Uah4GmmoHn1_2026',
  'timeOff/K9mvh9mxSheaDHSMmqAr', 'unavailability/H54juu30FSnAfK5yVnRc', 'weeks/2026-10-19',
  'staffDocs/B9NNMs4LlEZb6CdxIXzj', 'staffDocs/b66IFRDYujetMK7CUj1S',
  'rtwStatus/hDDqieIoYVYo0YxOdDOaLAVXgJB2', 'rtwStatus/ufzwab0MHNTpzly86Uah4GmmoHn1',
  'staff/hDDqieIoYVYo0YxOdDOaLAVXgJB2', 'directory/hDDqieIoYVYo0YxOdDOaLAVXgJB2',
];
const objects = ['rtw/hDDqieIoYVYo0YxOdDOaLAVXgJB2/B9NNMs4LlEZb6CdxIXzj.jpg', 'rtw/ufzwab0MHNTpzly86Uah4GmmoHn1/b66IFRDYujetMK7CUj1S.jpg'];
const users = ['hDDqieIoYVYo0YxOdDOaLAVXgJB2', 'dTcIVX5phgcaby6Iagp8hNssAD82'];
(async () => {
  const c = await new GoogleAuth({keyFile: '/home/sprite/.config/gcloud-tws/adc_tws.json', scopes: ['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const go = async (method, url, data) => { const r = await c.request({url, method, data, headers: H, validateStatus: () => true}); console.log(r.status, method, url.replace(/https:\/\/[^/]+\/v1\//, '').slice(0, 140)); };
  for (const d of docs) await go('DELETE', 'https://firestore.googleapis.com/v1/' + P + d);
  for (const o of objects) await go('DELETE', 'https://storage.googleapis.com/storage/v1/b/twsched-f8b16.firebasestorage.app/o/' + encodeURIComponent(o));
  for (const u of users) await go('POST', 'https://identitytoolkit.googleapis.com/v1/projects/twsched-f8b16/accounts:delete', {localId: u});
  // Mark the remaining welcome notification as visible to everyone.
  await go('PATCH', 'https://firestore.googleapis.com/v1/' + P + 'notifications/7m7unEuSTpISJdrSTDNk?updateMask.fieldPaths=managerOnly', {fields: {managerOnly: {booleanValue: false}}});
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
