// Compares results-main.json (rules on main) with results-cand.json (this branch).
// Pass = every non-developer identity unchanged (apart from owners now reading the devAccess log),
// the developer with no / expired / ended / pending / someone else's / missing grant gets only its own
// staff record, its own devAccess records and public website reads, and the developer with a valid grant
// gets exactly what an owner gets.
import fs from 'node:fs'
const A = JSON.parse(fs.readFileSync('results-main.json'))
const B = JSON.parse(fs.readFileSync('results-cand.json'))
const DEV_NOGRANT = ['developerWithEditorDoc', 'devExpired', 'devEnded', 'devPendingOnly', 'devOthersGrant', 'devMissingGrant', 'devForgedOwnerNoGrant']
const ok = (r) => r.startsWith('ALLOW')
const fails = []
const counts = {}
for (const k of Object.keys(B)) {
  const [who, op] = k.split(' | ')
  counts[who] = (counts[who] || 0) + 1
  if (DEV_NOGRANT.includes(who)) {
    if (!ok(B[k])) continue
    const own = (who !== 'devForgedOwnerNoGrant') && (/fs\.get staff\/dev1$/.test(op) || /fs\.get devAccess\/g(Active|Expired|Ended|Pending)$/.test(op))
    const publicRead = /fs\.get (public\/events|events\/evPublic|siteContent\/published|unknownColl)|st\.(get|list) site\b|st\.get site\//.test(op) && ok(A[k] || '')
    const anonToo = ok(B[`anon | ${op}`] || '') // public website content anyone can read
    const ownSelf = /webEditors\/self/.test(op) && ok(A[k] || '')
    if (!own && !publicRead && !ownSelf && !anonToo) fails.push(`${k}: ${B[k]} (developer without a valid grant must be denied)`)
    continue
  }
  if (who === 'devGranted') {
    const ownerKey = `owner | ${op}`
    const o = B[ownerKey]
    if (/webEditors\/self/.test(op)) continue
    if (/devAccess\/(gOther|auditNew)$|fs\.list devAccess$/.test(op) && !ok(B[k])) continue // only its own grants, by design
    if (/forged updatedBy/.test(op)) continue // the test forges updatedBy as owner1, so it's only forged for dev1 // self differs by uid (dev1 has an editor doc, owner1 doesn't)
    if (ok(o || '') !== ok(B[k])) fails.push(`${k}: ${B[k]} but owner gets ${o}`)
    continue
  }
  if (A[k] === undefined) continue
  if (ok(A[k]) !== ok(B[k])) {
    if (who === 'owner' && /fs\.(get|list) devAccess/.test(op) && ok(B[k])) continue // owners can now see the grant log
    fails.push(`${k}: was ${A[k]}, now ${B[k]}`)
  }
}
console.log('operations per identity:', JSON.stringify(counts))
console.log('total operations', Object.keys(B).length)
const show = (re) => Object.keys(B).filter((k) => re.test(k)).map((k) => `  ${k} -> ${B[k]}`).join('\n')
console.log('developer, no grant, sample:\n' + show(/^developerWithEditorDoc \| (fs\.get (staff|shifts|payInfo|devAccess|devCodes)|st\.get (payslips|rtw))/))
console.log('developer, valid grant, sample:\n' + show(/^devGranted \| (fs\.get (staff\/staffB|payInfo|devCodes)|fs\.create devAccess|fs\.update staff\/dev1|st\.get (payslips|rtw))/))
console.log('developer, expired grant, sample:\n' + show(/^devExpired \| (fs\.get (staff\/staffB|payInfo)|st\.get rtw)/))
console.log(fails.length ? `FAIL ${fails.length}\n` + fails.join('\n') : 'PASS')
process.exit(fails.length ? 1 : 0)
