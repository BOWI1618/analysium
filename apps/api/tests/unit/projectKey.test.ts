import { describe, expect, it } from 'vitest';
import { keyFromName, uniqueProjectKey } from '../../src/modules/projects/key';

describe('ключ проекта из названия', () => {
  it('русское название даёт латинский ключ', () => {
    expect(keyFromName('Алабуга Старт')).toBe('AS');
    expect(keyFromName('Маркетинг')).toBe('MARK');
    expect(keyFromName('Mobile App')).toBe('MA');
  });

  it('ключ всегда начинается с буквы и не короче двух символов', () => {
    expect(keyFromName('2026 План')).toMatch(/^[A-Z][A-Z0-9]{1,5}$/);
    expect(keyFromName('!!!')).toBe('PRJ');
    expect(keyFromName('Я')).toBe('YA');
  });

  it('занятый ключ получает номер', () => {
    expect(uniqueProjectKey('Алабуга Старт', new Set(['AS']))).toBe('AS2');
    expect(uniqueProjectKey('Алабуга Старт', new Set(['AS', 'AS2']))).toBe('AS3');
    expect(uniqueProjectKey('Маркетинг', new Set(['MARK']))).toBe('MARK2');
  });
});
