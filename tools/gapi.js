// Small REST helper using the tws ADC with the quota project header.
// Usage: node gapi.js METHOD URL [bodyfile]
const {GoogleAuth} = require('google-auth-library');
const fs = require('fs');
(async () => {
  const [method, url, bodyFile] = process.argv.slice(2);
  const auth = new GoogleAuth({keyFile: '/home/sprite/.config/gcloud-tws/adc_tws.json', scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase']});
  const client = await auth.getClient();
  const opts = {url, method, headers: {'x-goog-user-project': 'twsched-f8b16'}, validateStatus: () => true};
  if (bodyFile) opts.data = JSON.parse(fs.readFileSync(bodyFile, 'utf8'));
  const r = await client.request(opts);
  console.log('HTTP', r.status);
  console.log(typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 1));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
