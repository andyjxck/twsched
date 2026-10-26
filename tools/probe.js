// Live check of the published rules with throwaway probe accounts (deleted at the end).
const {GoogleAuth} = require('google-auth-library');
const crypto = require('crypto');
const KEY = 'AIzaSyDe67skrRZG6TcHFcDUI45zY6Az4Jn5Y2I';
const PRJ = 'twsched-f8b16';
const FS = `https://firestore.googleapis.com/v1/projects/${PRJ}/databases/(default)/documents`;
const H = {'x-goog-user-project': PRJ};
const STELLA = 'S8JYcjKRMRRdWkLyS9WVZVw5Tgf1';
(async () => {
  const admin = await new GoogleAuth({keyFile: '/home/sprite/.config/gcloud-tws/adc_tws.json', scopes: ['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const A = (method, url, data) => admin.request({url, method, data, headers: H, validateStatus: () => true});
  const made = [];
  async function probe(role) {
    const email = `tws-probe-${role}-${Date.now()}@example.invalid`, pw = crypto.randomBytes(18).toString('base64url');
    const r = await A('POST', `https://identitytoolkit.googleapis.com/v1/projects/${PRJ}/accounts`, {email, password: pw});
    const id = r.data.localId; made.push(id);
    await A('POST', `https://identitytoolkit.googleapis.com/v1/projects/${PRJ}/accounts:update`, {localId: id, customAttributes: JSON.stringify({role})});
    const s = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password: pw, returnSecureToken: true})}).then(x => x.json());
    return {id, tok: s.idToken};
  }
  const U = async (p, method, path, body) => {
    const r = await fetch(FS + path, {method, headers: {Authorization: 'Bearer ' + p.tok, 'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    return {status: r.status, n: Array.isArray(j) ? j.filter(x => x.document).length : undefined};
  };
  const notifQ = (uid, mgrFilter, limit) => ({structuredQuery: {from: [{collectionId: 'notifications'}], where: {compositeFilter: {op: 'AND', filters: [
    {fieldFilter: {field: {fieldPath: 'uid'}, op: 'EQUAL', value: {stringValue: uid}}},
    ...(mgrFilter ? [{fieldFilter: {field: {fieldPath: 'managerOnly'}, op: 'EQUAL', value: {booleanValue: false}}}] : [])]}},
    orderBy: [{field: {fieldPath: 'createdAt'}, direction: 'DESCENDING'}], limit}});
  const out = [];
  const log = (k, v) => { out.push(k + ': ' + JSON.stringify(v)); };
  try {
    const st = await probe('staff'), mg = await probe('manager'), ow = await probe('owner');
    // seed one manager-only and one normal notification for the staff probe
    for (const [mo, t] of [[true, 'probe enquiry'], [false, 'probe normal']]) {
      await A('POST', `${FS}/notifications`, {fields: {uid: {stringValue: st.id}, title: {stringValue: t}, body: {stringValue: ''}, link: {stringValue: mo ? '#/enquiries' : ''}, managerOnly: {booleanValue: mo}, read: {booleanValue: false}, createdAt: {timestampValue: new Date().toISOString()}}});
    }
    log('staff feed query (with managerOnly filter, as app does)', await U(st, 'POST', ':runQuery', notifQ(st.id, true, 5)));
    log('staff feed query WITHOUT filter (should be refused)', await U(st, 'POST', ':runQuery', notifQ(st.id, false, 5)));
    log('staff read Stella staff record (should be 403)', await U(st, 'GET', '/staff/' + STELLA));
    log('staff read own staff record path', await U(st, 'GET', '/staff/' + st.id));
    log('staff read directory list', await U(st, 'GET', '/directory?pageSize=5'));
    log('staff read enquiries (should be 403)', await U(st, 'GET', '/enquiries?pageSize=5'));
    log('staff read payroll settings', await U(st, 'GET', '/payroll/settings'));
    log('manager read Stella staff record', await U(mg, 'GET', '/staff/' + STELLA));
    log('manager read enquiries', await U(mg, 'GET', '/enquiries?pageSize=5'));
    log('manager feed query (no filter)', await U(mg, 'POST', ':runQuery', notifQ(mg.id, false, 5)));
    log('owner read staff list', await U(ow, 'GET', '/staff?pageSize=10'));
    log('owner read enquiries', await U(ow, 'GET', '/enquiries?pageSize=5'));
    log('owner read payroll settings', await U(ow, 'GET', '/payroll/settings'));
  } finally {
    // clean up probe notifications and accounts
    const q = await A('POST', `${FS}:runQuery`, {structuredQuery: {from: [{collectionId: 'notifications'}], where: {fieldFilter: {field: {fieldPath: 'title'}, op: 'IN', value: {arrayValue: {values: [{stringValue: 'probe enquiry'}, {stringValue: 'probe normal'}]}}}}}});
    for (const x of (q.data || [])) if (x.document) await A('DELETE', 'https://firestore.googleapis.com/v1/' + x.document.name);
    for (const id of made) { const r = await A('POST', `https://identitytoolkit.googleapis.com/v1/projects/${PRJ}/accounts:delete`, {localId: id}); out.push('deleted probe ' + r.status); }
  }
  console.log(out.join('\n'));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
