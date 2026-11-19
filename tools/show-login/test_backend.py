#!/usr/bin/env python3
"""Backend tests for Show on screen + site-wide email change, against the local emulators
(project demo-twsched, made-up accounts only)."""
import json, urllib.request, urllib.error, time, subprocess

AUTH = 'http://127.0.0.1:29099'
FS = 'http://127.0.0.1:28085/v1/projects/demo-twsched/databases/(default)/documents'
FN = 'http://127.0.0.1:25001/demo-twsched/europe-west2'
KEY = 'fake-api-key'
seed = json.load(open('/home/sprite/tws-showpw-preview/seed-ids.json'))
PW, IDS = seed['password'], seed['ids']
results = []

def req(url, body=None, headers=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method or ('POST' if data else 'GET'),
                               headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def sign_in(email, pw):
    s, j = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={KEY}',
               {'email': email, 'password': pw, 'returnSecureToken': True})
    return s, j

def token(email, pw=PW):
    s, j = sign_in(email, pw)
    assert s == 200, (email, j)
    return j['idToken']

def call(name, data, tok):
    return req(f'{FN}/{name}', {'data': data}, {'Authorization': f'Bearer {tok}'})

def doc(path):
    s, j = req(f'{FS}/{path}', headers={'Authorization': 'Bearer owner'})
    return j

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail and not ok else ''))

def auth_user(uid):
    s, j = req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-twsched/accounts:lookup',
               {'localId': [uid]}, {'Authorization': 'Bearer owner'})
    return j['users'][0]

owner = token('owner@preview.test')
manager = token('manager@preview.test')
staff = token('staff@preview.test')
ivy = IDS['Ivy Icloud']; kit = IDS['Kit Kitchen']; sam = IDS['Sam Staff']

# ---------- Show on screen ----------
s, j = call('showStaffLogin', {'uid': ivy}, staff)
check('staff cannot call showStaffLogin', s != 200 and 'tempPassword' not in json.dumps(j), j)
s, j = call('showStaffLogin', {'uid': ivy}, manager)
check('manager cannot call showStaffLogin (owners only, as Resend login)', s != 200 and 'tempPassword' not in json.dumps(j), j)
s, j = call('showStaffLogin', {'uid': ivy}, '')
check('signed-out caller refused', s != 200, j)
s, j = call('showStaffLogin', {'uid': IDS['Olly Owner']}, owner)
check('owner cannot show their own password', s != 200, j)

s, j = call('showStaffLogin', {'uid': ivy}, owner)
res = j.get('result', {})
temp = res.get('tempPassword', '')
check('owner gets a temporary password once', s == 200 and len(temp) >= 10 and res.get('emailSent') is False, j)
d = doc(f'staff/{ivy}')
fields = json.dumps(d)
le = d['fields'].get('loginEmail', {}).get('mapValue', {}).get('fields', {})
check('staff record notes shown on screen, by whom, kind', le.get('status', {}).get('stringValue') == 'shown' and le.get('by', {}).get('stringValue') == IDS['Olly Owner'] and 'kind' in le and 'at' in le, le)
check('password not in the staff record', temp not in fields)
# scan every Firestore document for the password
def walk(path):
    out = []
    s, j = req(f'{FS}{path}:listCollectionIds', {}, {'Authorization': 'Bearer owner'})
    for c in j.get('collectionIds', []):
        s2, k = req(f'{FS}{path}/{c}?pageSize=500', headers={'Authorization': 'Bearer owner'})
        for dd in k.get('documents', []):
            out.append(json.dumps(dd))
            sub = dd['name'].split('/documents', 1)[1]
            out += walk(sub)
    return out
alldocs = walk('')
check(f'password not stored anywhere in Firestore ({len(alldocs)} docs scanned)', all(temp not in x for x in alldocs))
log = open('/home/sprite/tws-showpw-preview/emulators.log').read()
check('password not in the function logs', temp not in log)

s, j = sign_in('ivy@preview.test', PW)
check('old password stops working', s != 200, j)
s, j = sign_in('ivy@preview.test', temp)
check('temporary password signs in', s == 200, j)
ivy_tok = j.get('idToken', '')
s, j = call('othersOnShift', {}, ivy_tok)
check('account is gated until they choose a password', s != 200, j)
s, j = req(f'{FS}/rota?pageSize=1', headers={'Authorization': f'Bearer {ivy_tok}'})
check('gated account cannot read Firestore data', s in (401, 403), (s, j))
newpw = 'Ivy-chooses-2026!x'
s, j = call('completePasswordChange', {'currentPassword': temp, 'newPassword': newpw}, ivy_tok)
check('first sign-in forces a password change and accepts it', s == 200, j)
s, j = sign_in('ivy@preview.test', newpw)
check('new own password works', s == 200, j)
s, j = sign_in('ivy@preview.test', temp)
check('temporary password no longer works', s != 200, j)

# rate limit: the same target, repeatedly
codes = []
for i in range(8):
    s, j = call('showStaffLogin', {'uid': kit}, owner)
    codes.append(s)
    if s != 200:
        msg = j.get('error', {}).get('message', '')
        break
check(f'rate limit holds (calls before refusal: {codes.count(200)})', any(c != 200 for c in codes) and codes.count(200) <= 5, codes)
print('   limit message:', msg)

# existing Resend login still works (another target)
s, j = call('resendStaffLogin', {'uid': sam}, owner)
check('existing Resend login / New password still works', s == 200 and 'emailSent' in j.get('result', {}), j)

# ---------- Email change ----------
pat = IDS['Pat Payroll']
# simulate the real case: login email has a typo, staff record is right
req(f'{AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-twsched/accounts:update', {'localId': pat, 'email': 'pat@ocloud.test'}, {'Authorization': 'Bearer owner'})
pat_tok_before = token('pat@ocloud.test')
cur = doc(f'staff/{pat}')['fields']
base = {'uid': pat, 'name': cur['name']['stringValue'], 'jobTitle': cur.get('jobTitle', {}).get('stringValue', ''), 'phone': cur.get('phone', {}).get('stringValue', '')}
docmail = cur['email']['stringValue']

s, j = call('updateStaff', {**base, 'email': 'new@preview.test'}, manager)
check('manager cannot change a login email', s != 200 or auth_user(pat)['email'] == 'pat@ocloud.test', j)
s, j = call('updateStaff', {**base, 'email': 'not-an-email'}, owner)
check('invalid address refused', s != 200 and 'valid email' in json.dumps(j), j)
s, j = call('updateStaff', {**base, 'email': 'staff@preview.test'}, owner)
check('address used by another login refused with a clear message', s != 200 and 'Another login already uses' in json.dumps(j), j)

# Saving with the record's (correct) address fixes the typo'd login
s, j = call('updateStaff', {**base, 'email': docmail}, owner)
r = j.get('result', {})
u = auth_user(pat)
check('saving the correct address fixes a mismatched login email', s == 200 and r.get('emailChanged') and u['email'] == docmail and u.get('emailVerified') is True, (j, u.get('email')))

new = 'pat.new@preview.test'
s, j = call('updateStaff', {**base, 'email': new.upper()}, owner)
u = auth_user(pat); d = doc(f'staff/{pat}')['fields']
check('owner change updates the login and the staff record together (lower-cased)', s == 200 and u['email'] == new and d['email']['stringValue'] == new and u.get('emailVerified') is True, (j, u.get('email')))
check('change logged on the record: who and when', d.get('emailChangedBy', {}).get('stringValue') == IDS['Olly Owner'] and 'emailChangedAt' in d)
check('uid unchanged, role unchanged', u['localId'] == pat and d['role']['stringValue'] == 'payroll')
s, j = sign_in(new, PW)
check('they sign in with the new address and the same password', s == 200, j)
s, j = sign_in('pat@ocloud.test', PW)
check('old address no longer signs in', s != 200)
# refresh tokens revoked
valid_since = int(u.get('validSince', '0'))
check('their sessions were signed out (refresh tokens revoked)', valid_since >= int(time.time()) - 120, valid_since)
newlog = open('/home/sprite/tws-showpw-preview/emulators.log').read()
check('no addresses in the change log line', 'staff login email changed by owner' in newlog and new not in newlog.split('staff login email changed by owner')[-1][:400])

# Resend login goes to the new address
s, j = call('resendStaffLogin', {'uid': pat}, owner)
check('Resend login after the change uses the new address', s == 200 and j.get('result', {}).get('emailSent') is not None, j)
s, j = call('showStaffLogin', {'uid': pat}, owner)
check('Show on screen after the change returns the new address', s == 200 and j.get('result', {}).get('email') == new, j)

# same email = no change, no revoke
kd = doc(f'staff/{kit}')['fields']
kbase = {'uid': kit, 'name': kd['name']['stringValue'], 'jobTitle': kd.get('jobTitle', {}).get('stringValue', ''), 'phone': kd.get('phone', {}).get('stringValue', '')}
before = auth_user(kit).get('validSince')
s, j = call('updateStaff', {**kbase, 'email': kd['email']['stringValue'], 'phone': '07700 900123'}, owner)
check('saving without changing the email changes nothing else (no sign-out)', s == 200 and not j.get('result', {}).get('emailChanged') and auth_user(kit).get('validSince') == before, j)
# developer login's email is not editable
s, j = call('updateStaff', {'uid': IDS['Dev Login'], 'name': 'Dev Login', 'jobTitle': '', 'phone': '', 'email': 'x@preview.test'}, owner)
check('developer login email cannot be changed here', auth_user(IDS['Dev Login'])['email'] == 'developer@preview.test', j)
# enquiry recipients follow the change
req(f'{FS}/private/mail?updateMask.fieldPaths=enquiryTo', {'fields': {'enquiryTo': {'stringValue': f'owner@preview.test, {new}'}}}, {'Authorization': 'Bearer owner'}, 'PATCH')
new2 = 'pat.final@preview.test'
s, j = call('updateStaff', {**base, 'email': new2}, owner)
m = doc('private/mail')['fields']['enquiryTo']['stringValue']
check('enquiry recipient list follows the change', s == 200 and m == f'owner@preview.test, {new2}', m)

print()
print(f"{sum(1 for _, o in results if o)} of {len(results)} passed")
