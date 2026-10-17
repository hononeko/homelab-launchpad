import { describe, expect, test } from 'bun:test';
import { errorMessage } from './errorMessage';

describe('errorMessage', () => {
  test('uses Error messages and strings, stripping line breaks', () => {
    expect(errorMessage(new Error('boom\r\nforged log line'))).toBe('boomforged log line');
    expect(errorMessage('plain\ntext')).toBe('plaintext');
  });

  test('does not stringify arbitrary objects', () => {
    expect(errorMessage({ secret: 'value' })).toBe('unknown error');
    expect(errorMessage(undefined)).toBe('unknown error');
  });
});
