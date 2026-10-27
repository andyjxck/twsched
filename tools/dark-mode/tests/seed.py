"""Seed the local emulators (project demo-twsdark) with fake people only."""
import json, datetime, urllib.request

P = 'demo-twsdark'
AUTH = 'http://127.0.0.1:9771'
FS = 'http://127.0.0.1:8771/v1/projects/%s/databases/(default)/documents' % P
H = {'Authorization': 'Bearer owner', 'Content-Type': 'application/json'}
PW = 'Test-pass-12345'


def req(method, url, body=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=H, method=method)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read() or b'{}')


def val(v):
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, datetime.datetime): return {'timestampValue': v.strftime('%Y-%m-%dT%H:%M:%S.000Z')}
    if v is None: return {'nullValue': None}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: val(x) for k, x in v.items()}}}
    if isinstance(v, list): return {'arrayValue': {'values': [val(x) for x in v]}}
    return {'stringValue': str(v)}


def put(path, data):
    req('PATCH', '%s/%s' % (FS, path), {'fields': {k: val(x) for k, x in data.items()}})


n = 0
def add(coll, data):
    global n
    n += 1
    put('%s/seed%03d' % (coll, n), data)


now = datetime.datetime.utcnow()
ago = lambda m: now - datetime.timedelta(minutes=m)
today = datetime.date(2026, 10, 27)
mon = today - datetime.timedelta(days=today.weekday())
D = lambda i: (mon + datetime.timedelta(days=i)).isoformat()
ids = {}


def mk(name, email, role):
    u = req('POST', '%s/identitytoolkit.googleapis.com/v1/projects/%s/accounts' % (AUTH, P),
            {'email': email, 'password': PW, 'displayName': name})
    uid = u['localId']
    req('POST', '%s/identitytoolkit.googleapis.com/v1/projects/%s/accounts:update' % (AUTH, P),
        {'localId': uid, 'customAttributes': json.dumps({'role': role})})
    put('staff/' + uid, {'name': name, 'email': email, 'role': role, 'active': True, 'onRota': role != 'payroll',
                         'jobTitle': 'Bar' if role == 'staff' else role.title()})
    put('directory/' + uid, {'name': name, 'role': role, 'active': True})
    ids[name] = uid


mk('Olly Owner', 'olly@example.test', 'owner')
mk('Mia Manager', 'mia@example.test', 'manager')
mk('Sam Staff', 'sam@example.test', 'staff')
mk('Pat Payroll', 'pat@example.test', 'payroll')
mk('Kit Kitchen', 'kit@example.test', 'staff')

for i, (who, s, e, area) in enumerate([
        ('Sam Staff', '17:00', '23:00', 'Bar'), ('Kit Kitchen', '10:00', '16:00', 'Kitchen'),
        ('Mia Manager', '12:00', '22:00', 'Floor'), ('Sam Staff', '11:00', '17:00', 'Bar'),
        ('Olly Owner', '09:00', '15:00', 'Office'), ('Kit Kitchen', '16:00', '22:30', 'Kitchen')]):
    for day in (i % 7, (i + 2) % 7):
        add('shifts', {'staffId': ids[who], 'staffName': who, 'date': D(day), 'week': D(0), 'start': s, 'end': e,
                       'published': day != 6, 'area': area, 'leader': who == 'Mia Manager', 'notes': '',
                       'breakStart': '', 'breakEnd': '', 'breakPaid': True, 'updatedAt': ago(60), 'updatedBy': ids['Olly Owner']})
add('shifts', {'staffId': '', 'staffName': 'Open shift', 'date': D(5), 'week': D(0), 'start': '18:00', 'end': '23:00',
               'published': True, 'area': 'Bar', 'leader': False, 'notes': 'Quiz night', 'breakStart': '', 'breakEnd': '',
               'breakPaid': True, 'updatedAt': ago(60), 'updatedBy': ids['Olly Owner']})

for uid in ids.values():
    add('notifications', {'uid': uid, 'title': 'Rota published for next week', 'body': 'Check your shifts.', 'link': '#/',
                          'managerOnly': False, 'read': False, 'createdAt': ago(5)})
    add('notifications', {'uid': uid, 'title': 'Holiday approved', 'body': 'Mon 2 Nov', 'link': '#/', 'managerOnly': False,
                          'read': True, 'createdAt': ago(300)})
S = ids['Sam Staff']
add('timeOff', {'staffId': S, 'staffName': 'Sam Staff', 'from': '2026-11-20', 'to': '2026-11-21', 'status': 'pending',
                'paid': True, 'type': 'holiday', 'days': 2, 'reason': 'Wedding', 'createdAt': ago(30)})
add('timeOff', {'staffId': S, 'staffName': 'Sam Staff', 'from': '2026-11-02', 'to': '2026-11-02', 'status': 'approved',
                'paid': True, 'type': 'holiday', 'days': 1, 'reason': 'Dentist', 'decidedByName': 'Olly Owner',
                'decidedAt': ago(100), 'createdAt': ago(300)})
add('requests', {'staffId': S, 'staffName': 'Sam Staff', 'kind': 'problem', 'shiftLabel': 'Sat 31 Oct 17:00-23:00',
                 'message': 'Bus strike', 'status': 'pending', 'createdAt': ago(10)})
add('enquiries', {'name': 'Jane Partyhost', 'email': 'jane@example.test', 'phone': '07700 900123', 'occasion': 'Birthday',
                  'space': 'Garden room', 'date': '2026-12-12', 'guests': 40, 'message': 'We would love to book the garden room.',
                  'status': 'new', 'createdAt': ago(3)})
add('enquiries', {'name': 'Bob Replied', 'email': 'bob@example.test', 'occasion': 'Wake', 'date': '2026-11-15', 'guests': 25,
                  'message': 'Short note', 'status': 'replied', 'createdAt': ago(60)})
for name in ('Sam Staff', 'Kit Kitchen', 'Mia Manager'):
    put('contracts/' + ids[name], {'staffId': ids[name], 'contractHours': 20})
print(json.dumps(ids))
