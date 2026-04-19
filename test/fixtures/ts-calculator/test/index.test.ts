import { describe, it, expect } from 'vitest';
import { add, subtract } from '../src/index';

describe('Calculator', () => {
  it('adds numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('subtracts numbers', () => {
    expect(subtract(5, 3)).toBe(2);
  });
});
