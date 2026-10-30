// Live data fix for the hidden developer login (Andy, 30 Oct 2026).
// The 'Andy (developer)' staff record was made from Team as an ordinary owner, so it had no developer flag
// and the app showed it everywhere. This marks it developer: true and gives every other staff record
// developer: false, which managers' and payroll's staff queries now match on (firestore.rules).
// Only the developer field is written (updateMask), nothing else on any record changes. The deployed
// onStaffDirectory trigger then drops the developer from the colleague directory; this script checks.
// Usage: NODE_PATH=<dir with google-auth-library> node mark_developer.js [--apply]   (dry run without --apply)
const { GoogleAuth } = require('google-auth-library');
const DEV_EMAIL = 'andy@theandysocial.website';
const P = 'projects/twsched-f8b16/databases/(default)/documents';
const B = 'https://firestore.googleapis.com/v1/';
const APPLY = process.argv.includes('--apply');
let client;
async function req(method, url, data) {
  const r = await client.request({ url, method, data, headers: { 'x-goog-user-project': 'twsched-f8b16' }, validateStatus: () => true });
  if (r.status >= 300 && !(method === 'GET' && r.status === 404)) throw new Error(method + ' ' + url + ' ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 300));
  return r.status === 404 ? null : r.data;
}
(async () => {
  client = await new GoogleAuth({ keyFile: '/home/sprite/.config/gcloud-tws/adc_tws.json', scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const list = (await req('GET', B + P + '/staff?pageSize=300')).documents || [];
  const devs = list.filter((d) => (d.fields.email || {}).stringValue === DEV_EMAIL);
  if (devs.length !== 1) throw new Error('expected exactly one developer record, found ' + devs.length);
  const devId = devs[0].name.split('/').pop();
  let changed = 0;
  for (const d of list) {
    const id = d.name.split('/').pop();
    const want = id === devId;
    const has = d.fields.developer && d.fields.developer.booleanValue;
    const name = (d.fields.name || {}).stringValue;
    if (d.fields.developer && has === want) { console.log('ok      ', name, want); continue; }
    console.log(APPLY ? 'set     ' : 'would set', name, 'developer:', want);
    if (APPLY) await req('PATCH', B + d.name + '?updateMask.fieldPaths=developer&currentDocument.exists=true', { fields: { developer: { booleanValue: want } } });
    changed++;
  }
  console.log(changed, 'record(s)', APPLY ? 'updated' : 'to update', 'of', list.length);
  if (APPLY) {
    for (let i = 0; i < 12; i++) {
      const dir = await req('GET', B + P + '/directory/' + devId);
      if (!dir) { console.log('directory: developer entry gone'); break; }
      if (i === 11) { console.log('directory entry still there after 60s, deleting it'); await req('DELETE', B + P + '/directory/' + devId); }
      await new Promise((r) => setTimeout(r, 5000));
    }
    const again = (await req('GET', B + P + '/staff?pageSize=300')).documents || [];
    const bad = again.filter((d) => !d.fields.developer || d.fields.developer.booleanValue !== (d.name.endsWith('/' + devId)));
    console.log('check:', bad.length ? 'NOT RIGHT: ' + bad.map((d) => d.name.split('/').pop()).join(',') : 'every record has the right developer flag');
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
