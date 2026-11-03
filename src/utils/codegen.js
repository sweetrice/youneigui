'use strict';

const config = require('../config');

/**
 * 生成不重复的房间码
 * @returns {string}
 */
function generateRoomCode() {
  const { customAlphabet } = require('nanoid');
  const nano = customAlphabet(config.codeChars, config.codeLength);
  return nano();
}

/**
 * 生成 room_id（内部使用）
 */
function generateRoomId() {
  const { nanoid } = require('nanoid');
  return 'room_' + nanoid(16);
}

module.exports = { generateRoomCode, generateRoomId };
