// node --test tests/timeDraft.unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { digits, splitDraft, joinDraft, segmentError, shouldAdvance, parsePastedTime, normaliseTime } from '../src/timeDraft.js';

test('digits strips non-numbers and caps at two', () => {
  assert.equal(digits('1a9z3'), '19');
  assert.equal(digits(''), '');
  assert.equal(digits(null), '');
});

test('split and join drafts', () => {
  assert.deepEqual(splitDraft('19:30'), ['19', '30']);
  assert.deepEqual(splitDraft(''), ['', '']);
  assert.deepEqual(splitDraft('1:'), ['1', '']);
  assert.deepEqual(splitDraft(':5'), ['', '5']);
  assert.equal(joinDraft('', ''), '');
  assert.equal(joinDraft('1', ''), '1:');
});

test('range errors', () => {
  assert.equal(segmentError('hours', '23'), '');
  assert.match(segmentError('hours', '24'), /00 to 23/);
  assert.equal(segmentError('minutes', '59'), '');
  assert.match(segmentError('minutes', '60'), /00 to 59/);
  assert.equal(segmentError('hours', '9'), '');
});

test('advance only on typing the second digit of a valid box', () => {
  assert.equal(shouldAdvance('hours', '1', '19', 'insertText'), true);
  assert.equal(shouldAdvance('hours', '', '19', 'insertFromPaste'), true);
  assert.equal(shouldAdvance('hours', '', '1', 'insertText'), false);
  assert.equal(shouldAdvance('hours', '2', '25', 'insertText'), false); // invalid: stay to fix it
  assert.equal(shouldAdvance('minutes', '6', '60', 'insertText'), false);
  assert.equal(shouldAdvance('hours', '19', '18', 'insertText'), false); // swapped one digit of a full box
  assert.equal(shouldAdvance('hours', '190', '19', 'deleteContentBackward'), false);
  assert.equal(shouldAdvance('hours', '1', '19', undefined), false);
  assert.equal(shouldAdvance('minutes', '3', '30', 'insertText'), true);
});

test('pasted times', () => {
  assert.deepEqual(parsePastedTime('19:30'), ['19', '30']);
  assert.deepEqual(parsePastedTime(' 9:05 '), ['09', '05']);
  assert.deepEqual(parsePastedTime('1930'), ['19', '30']);
  assert.deepEqual(parsePastedTime('19.30'), ['19', '30']);
  assert.equal(parsePastedTime('25:00'), null);
  assert.equal(parsePastedTime('19:75'), null);
  assert.equal(parsePastedTime('7pm'), null);
  assert.equal(parsePastedTime('19'), null);
});

test('normalise for saving keeps HH:MM 24-hour storage', () => {
  assert.deepEqual(normaliseTime('19:30'), { value: '19:30' });
  assert.deepEqual(normaliseTime('9:5'), { value: '09:05' });
  assert.deepEqual(normaliseTime(''), { value: '' });
  assert.deepEqual(normaliseTime(':'), { value: '' });
  assert.deepEqual(normaliseTime('00:00'), { value: '00:00' });
  assert.ok(normaliseTime('19:').error);
  assert.ok(normaliseTime(':30').error);
  assert.ok(normaliseTime('24:00').error);
  assert.ok(normaliseTime('23:60').error);
});
