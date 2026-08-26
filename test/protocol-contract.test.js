import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_MESSAGE_TYPES,
  isClientMessageType,
  isServerMessageType,
  SERVER_MESSAGE_TYPES,
} from '../src/shared/protocol.js';

test('wire message catalogs are unique, immutable arrays with disjoint directions', () => {
  assert.equal(Object.isFrozen(CLIENT_MESSAGE_TYPES), true);
  assert.equal(Object.isFrozen(SERVER_MESSAGE_TYPES), true);
  assert.equal(new Set(CLIENT_MESSAGE_TYPES).size, CLIENT_MESSAGE_TYPES.length);
  assert.equal(new Set(SERVER_MESSAGE_TYPES).size, SERVER_MESSAGE_TYPES.length);
  assert.deepEqual(CLIENT_MESSAGE_TYPES.filter((type) => SERVER_MESSAGE_TYPES.includes(type)), [
    'fire', 'chat', 'botcfg', 'nade',
  ]);
  assert.equal(isClientMessageType('hola'), true);
  assert.equal(isServerMessageType('snap'), true);
  assert.equal(isClientMessageType('podiumStage'), false);
  assert.equal(isServerMessageType('podiumStage'), false);
});
