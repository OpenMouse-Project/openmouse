/*global navigator*/
'use strict';

const {
  REGEX_BACKSLASH,
  REGEX_SPECIAL_CHARS,
  REGEX_SPECIAL_CHARS_GLOBAL
} = require('./constants');

exports.isObject = val => val !== null && typeof val === 'object' && !Array.isArray(val);
exports.hasRegexChars = str => REGEX_SPECIAL_CHARS.test(str);
exports.isRegexChar = str => str.length === 1 && exports.hasRegexChars(str);
exports.escapeRegex = str => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
exports.toPosixSlashes = str => str.replace(REGEX_BACKSLASH, '/');

exports.isWindows = () => {
  if (typeof navigator !== 'undefined' && navigator.platform) {
    const platform = navigator.platform.toLowerCase();
    return platform === 'win32' || platform === 'windows';
  }

  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }

  return false;
};

exports.removeBackslashes = str => {
  // Find eligible closing brackets once, rather than repeatedly rescanning
  // an unterminated bracket prefix with a backtracking regular expression.
  const lineBreak = code => code === 10 || code === 13 || code === 8232 || code === 8233;
  const closes = new Int32Array(str.length + 1).fill(-1);
  for (let i = str.length - 1; i >= 0; i--) {
    if (lineBreak(str.charCodeAt(i))) {
      closes[i] = str[i + 1] === ']' ? i + 1 : -1;
    } else if (str[i] === ']' && str[i - 1] !== '\\') {
      closes[i] = i;
    } else {
      closes[i] = closes[i + 1];
    }
  }
  const output = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '[') {
      let end = closes[i + 1];
      // The original bracket group requires at least one character inside.
      if (end === i + 1) end = closes[i + 2];
      if (end >= i + 2) {
        output.push(str.slice(i, end + 1));
        i = end;
        continue;
      }
    }
    if (str[i] === '\\' && i + 1 < str.length && !lineBreak(str.charCodeAt(i + 1))) continue;
    output.push(str[i]);
  }
  return output.join('');
};

exports.escapeLast = (input, char, lastIdx) => {
  const idx = input.lastIndexOf(char, lastIdx);
  if (idx === -1) return input;
  if (input[idx - 1] === '\\') return exports.escapeLast(input, char, idx - 1);
  return `${input.slice(0, idx)}\\${input.slice(idx)}`;
};

exports.removePrefix = (input, state = {}) => {
  let output = input;
  if (output.startsWith('./')) {
    output = output.slice(2);
    state.prefix = './';
  }
  return output;
};

exports.wrapOutput = (input, state = {}, options = {}) => {
  const prepend = options.contains ? '' : '^';
  const append = options.contains ? '' : '$';

  let output = `${prepend}(?:${input})${append}`;
  if (state.negated === true) {
    output = `(?:^(?!${output}).*$)`;
  }
  return output;
};

exports.basename = (path, { windows } = {}) => {
  const segs = path.split(windows ? /[\\/]/ : '/');
  const last = segs[segs.length - 1];

  if (last === '') {
    return segs[segs.length - 2];
  }

  return last;
};
