// Unit tests for the enquiry validator / mail builder. Run: node --test tests/enquiry.unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../functions/enquiry.js');

const TODAY = '2026-10-20';
const good = { name: 'Jo Bloggs', email: 'Jo@Example.com', phone: '07700 900123', occasion: 'Birthday', date: '2027-01-09', guests: '40', message: 'Hello\r\nCan we hire the room?', website: '' };
const rejects = (raw) => assert.throws(() => E.validateEnquiry(raw, TODAY), (e) => e instanceof E.EnquiryError && e.code === 'invalid-argument');

test('a normal enquiry is accepted and normalised', () => {
  const e = E.validateEnquiry(good, TODAY);
  assert.deepEqual(e, { name: 'Jo Bloggs', email: 'jo@example.com', phone: '07700 900123', occasion: 'Birthday', date: '2027-01-09', guests: 40, message: 'Hello\nCan we hire the room?' });
});

test('header injection in single-line fields is rejected', () => {
  rejects({ ...good, email: 'victim@example.com\r\nBcc: spam@example.org' });
  rejects({ ...good, email: 'victim@example.com\nBcc: spam@example.org' });
  rejects({ ...good, name: 'Jo\r\nBcc: spam@example.org' });
  rejects({ ...good, name: 'Jo\u2028Bcc: x' });
  rejects({ ...good, phone: '0123\r\nX: y' });
  rejects({ ...good, occasion: 'Birthday\nBcc: x@y.z' });
});

test('only one plain address is accepted as the email', () => {
  for (const email of ['a@b.com,c@d.com', 'a@b.com;c@d.com', 'Jo <a@b.com>', '"x"@b.com', 'a@b', 'nope', 'a b@c.com', `${'a'.repeat(65)}@b.com`, 'a@-b.com']) {
    rejects({ ...good, email });
  }
});

test('types, sizes, dates and guests are bounded', () => {
  rejects(null); rejects([]); rejects('x');
  rejects({ ...good, name: 'J' });
  rejects({ ...good, name: 'x'.repeat(101) });
  rejects({ ...good, name: { toString: () => 'x' } });
  rejects({ ...good, message: '' });
  rejects({ ...good, message: 'x'.repeat(3001) });
  rejects({ ...good, message: 'see http://a.com http://b.com http://c.com www.d.com' });
  rejects({ ...good, date: '2026-02-30' });
  rejects({ ...good, date: '2031-01-01' });
  rejects({ ...good, date: '2020-01-01' });
  rejects({ ...good, guests: 1001 });
  rejects({ ...good, guests: -1 });
  rejects({ ...good, guests: 2.5 });
  rejects({ ...good, phone: 'call me maybe' });
  rejects({ ...good, extra: 'x'.repeat(9000) });
});

test('unknown occasion becomes Other; control characters removed from the message', () => {
  const e = E.validateEnquiry({ ...good, occasion: 'Rave', message: 'hi\u0000\u0007 there\tok' }, TODAY);
  assert.equal(e.occasion, 'Other');
  assert.equal(e.message, 'hi there\tok');
});

test('honeypot submissions are flagged and not returned as an enquiry', () => {
  assert.deepEqual(E.validateEnquiry({ ...good, website: 'http://spam' }, TODAY), { honeypot: true });
});

test('client-supplied recipient/flags are ignored: output never contains them', () => {
  const e = E.validateEnquiry({ ...good, to: 'x@evil.com', enquiryTo: 'x@evil.com', ackCustomer: true, bcc: 'x@evil.com', status: 'booked', via: 'x' }, TODAY);
  assert.deepEqual(Object.keys(e).sort(), ['date', 'email', 'guests', 'message', 'name', 'occasion', 'phone']);
});

test('owner message goes only to the configured recipient, never to the visitor', () => {
  const e = E.validateEnquiry(good, TODAY);
  const msg = E.ownerMessage(e, { to: 'andyblewett9@gmail.com', appUrl: 'https://app/', prettyDate: (d) => d, esc: (s) => String(s), summary: 'Jo\r\nBcc: x@y.z - Birthday' });
  assert.deepEqual(msg.to, ['andyblewett9@gmail.com']);
  assert.equal(msg.cc, undefined);
  assert.equal(msg.bcc, undefined);
  assert.ok(!/[\r\n]/.test(msg.subject));
  assert.deepEqual(msg.replyTo, { name: 'Jo Bloggs', address: 'jo@example.com' });
  assert.throws(() => E.ownerMessage(e, { to: 'a@b.com\r\nBcc: c@d.com', appUrl: '', prettyDate: String, esc: String, summary: '' }));
});

test('owner recipient setting accepts up to three valid addresses only', () => {
  assert.equal(E.parseRecipients(''), '');
  assert.equal(E.parseRecipients('A@b.com, c@d.com'), 'a@b.com, c@d.com');
  for (const v of ['a@b.com,c@d.com,e@f.com,g@h.com', 'nope', 'a@b.com\r\nBcc: x@y.z', 'Jo <a@b.com>']) {
    assert.throws(() => E.parseRecipients(v));
  }
});

test('rate-limit key uses the last X-Forwarded-For entry (Google-appended), not caller-supplied ones', () => {
  assert.equal(E.callerIp({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' } }), '203.0.113.9');
  assert.equal(E.callerIp({ headers: { 'x-forwarded-for': '9.9.9.9,203.0.113.9' } }), '203.0.113.9');
  assert.equal(E.callerIp({ headers: {}, ip: '127.0.0.1' }), '127.0.0.1');
  assert.equal(E.callerIp({ headers: { 'x-forwarded-for': '2001:db8:1:2:3:4:5:6' } }), '2001:db8:1:2::/64');
  assert.notEqual(E.keyHash('ip', '1.2.3.4', 's1'), E.keyHash('ip', '1.2.3.4', 's2'));
});
