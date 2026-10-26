// Made-up fixture records for local layout checks only. Never deployed.
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const now = new Date();
const day = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return ymd(d); };
const monday = (() => { const d = new Date(now); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d; })();
const wd = (n) => { const d = new Date(monday); d.setDate(d.getDate() + n); return ymd(d); };
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();

export const USERS = {
  owner: { uid: 'u-owner', email: 'owner@fixture.test', name: 'Fixture Owner', role: 'owner' },
  manager: { uid: 'u-mgr', email: 'manager@fixture.test', name: 'Fixture Manager', role: 'manager' },
  staff: { uid: 'u-staff', email: 'staff@fixture.test', name: 'Fixture Staff', role: 'staff' },
  empty: { uid: 'u-empty', email: 'empty@fixture.test', name: 'New Starter', role: 'staff' },
};

const staff = {
  'u-owner': { name: 'Fixture Owner', email: 'owner@fixture.test', role: 'owner', primaryOwner: true, jobTitle: 'Management', onRota: true, active: true },
  'u-mgr': { name: 'Fixture Manager', email: 'manager@fixture.test', role: 'manager', jobTitle: 'Management', onRota: true, active: true },
  'u-staff': { name: 'Fixture Staff', email: 'staff@fixture.test', role: 'staff', jobTitle: 'Bar', onRota: true, active: true },
  'u-s2': { name: 'Sample Person Two', email: 's2@fixture.test', role: 'staff', jobTitle: 'Kitchen', onRota: true, active: true },
  'u-s3': { name: 'Sample Person Three', email: 's3@fixture.test', role: 'staff', jobTitle: 'Floor', onRota: true, active: true },
  'u-empty': { name: 'New Starter', email: 'empty@fixture.test', role: 'staff', jobTitle: 'Floor', onRota: true, active: true },
};

const sh = (staffId, date, start, end, extra = {}) => ({
  staffId, staffName: staffId ? staff[staffId].name : 'Open shift', date, week: wd(0), start, end,
  breakStart: '', breakEnd: '', breakPaid: true, area: 'Bar', notes: '', eventId: '', eventTitle: '', published: true, ...extra,
});
const shifts = {};
let i = 0;
const add = (x) => { i += 1; shifts[`s${i}`] = x; };
add(sh('u-staff', day(0), '17:00', '23:00', { breakStart: '19:30', breakEnd: '20:00', breakPaid: false }));
add(sh('u-staff', day(2), '11:00', '16:00', { area: 'Floor' }));
add(sh('u-staff', day(4), '18:00', '01:00', { eventTitle: 'Karaoke' }));
add(sh('u-mgr', day(1), '09:00', '17:00', { area: 'Management' }));
add(sh('u-mgr', day(3), '12:00', '20:00', { area: 'Management' }));
add(sh('u-owner', day(1), '10:00', '15:00', { area: 'Management' }));
add(sh('u-s2', wd(0), '08:00', '14:00', { area: 'Kitchen' }));
add(sh('u-s2', wd(4), '16:00', '22:00', { area: 'Kitchen', published: false }));
add(sh('u-s3', wd(5), '17:00', '23:30', { area: 'Floor' }));
add(sh('', wd(5), '19:00', '00:00', { area: 'Bar', published: false }));

export const DATA = {
  staff,
  shifts,
  weeks: { [wd(0)]: { status: 'published' } },
  events: {
    e1: { title: 'Karaoke night', date: wd(4), repeat: 'weekly', start: '20:00', end: '23:30', room: 'Bar', onWebsite: true },
    e2: { title: 'DJ night', date: wd(5), repeat: 'weekly', start: '21:00', end: '00:30', room: 'Bar', onWebsite: true },
    e3: { title: 'Sample private party', date: day(3), start: '19:00', end: '23:00', room: 'Function room', onWebsite: false, staffNeeded: 3 },
  },
  notifications: {
    n1: { uid: 'u-staff', title: 'Rota published', body: 'Your shifts for this week are up.', read: false, createdAt: ago(40), link: '#/rota' },
    n2: { uid: 'u-staff', title: 'Holiday approved', body: 'Sample note text.', read: true, createdAt: ago(60 * 30) },
    n3: { uid: 'u-mgr', title: 'New swap request', body: 'Fixture Staff asked to swap a shift.', read: false, createdAt: ago(15), link: '#/inbox' },
    n4: { uid: 'u-owner', title: 'New enquiry', body: 'A private hire enquiry came in.', read: false, createdAt: ago(90), link: '#/enquiries' },
  },
  timeOff: {
    t1: { staffId: 'u-s2', staffName: 'Sample Person Two', from: day(10), to: day(12), reason: 'Sample reason', paid: true, status: 'pending', createdAt: ago(200) },
    t2: { staffId: 'u-staff', staffName: 'Fixture Staff', from: day(20), to: day(21), reason: '', paid: true, status: 'approved', decidedByName: 'Fixture Manager', decidedAt: ago(100), createdAt: ago(400) },
  },
  requests: {
    r1: { kind: 'swap', staffId: 'u-staff', staffName: 'Fixture Staff', shiftId: 's2', shiftLabel: 'Sample shift 11:00-16:00', shiftDate: day(2), toStaffId: '', toStaffName: '', message: 'Sample message', status: 'pending', createdAt: ago(30) },
  },
  unavailability: {
    u1: { staffId: 'u-s3', staffName: 'Sample Person Three', from: wd(0), to: day(30), weekday: 3, reason: 'Sample reason' },
  },
  enquiries: {
    q1: { name: 'Sample Enquirer', email: 'enquirer@fixture.test', phone: '', occasion: 'Birthday', space: 'Function room', date: day(40), guests: 30, message: 'Sample message.', status: 'new', createdAt: ago(120) },
  },
  payslips: {},
  settings: {},
};
