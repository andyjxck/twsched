// Dump every Firestore document (recursively, incl. subcollections) to a JSON file.
// Usage: node fsdump.js out.json
const {GoogleAuth} = require('google-auth-library');
const fs = require('fs');
const P = 'projects/twsched-f8b16/databases/(default)/documents';
const B = 'https://firestore.googleapis.com/v1/';
let client;
async function req(method, url, data) {
  const r = await client.request({url, method, data, headers: {'x-goog-user-project': 'twsched-f8b16'}, validateStatus: () => true});
  if (r.status >= 300) throw new Error(method + ' ' + url + ' ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 300));
  return r.data;
}
async function collIds(parent) {
  let ids = [], tok;
  do {
    const d = await req('POST', B + parent + ':listCollectionIds', {pageSize: 300, pageToken: tok});
    ids = ids.concat(d.collectionIds || []); tok = d.nextPageToken;
  } while (tok);
  return ids;
}
async function docs(parent, coll) {
  let out = [], tok;
  do {
    const d = await req('GET', B + parent + '/' + coll + '?pageSize=300&showMissing=true' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
    out = out.concat(d.documents || []); tok = d.nextPageToken;
  } while (tok);
  return out;
}
async function walk(parent, acc) {
  for (const c of await collIds(parent)) {
    for (const d of await docs(parent, c)) {
      acc.push(d);
      await walk(d.name, acc);
    }
  }
}
(async () => {
  const auth = new GoogleAuth({keyFile: '/home/sprite/.config/gcloud-tws/adc_tws.json', scopes: ['https://www.googleapis.com/auth/cloud-platform']});
  client = await auth.getClient();
  const acc = [];
  await walk(P, acc);
  fs.writeFileSync(process.argv[2], JSON.stringify(acc));
  const counts = {};
  for (const d of acc) { const rel = d.name.slice(P.length + 1).split('/'); const key = rel.filter((_, i) => i % 2 === 0).join('/'); counts[key] = (counts[key] || 0) + 1; }
  console.log(JSON.stringify(counts, null, 1));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
