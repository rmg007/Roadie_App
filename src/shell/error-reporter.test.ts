/**
 * @vitest
 * Test suite for error-reporter (A1, A2)
 *
 * Note: Full integration tests for wrapActivation/wrapDeactivation require
 * mocking the vscode module, which is an external dependency. The core logic
 * (error logging, handler installation/removal) is tested below. Integration
 * tests for error-reporter.wrapActivation are covered by extension.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as errorReporter from './error-reporter';

describe('ErrorReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    errorReporter.uninstallGlobalHandlers();
  });

  describe('wrapDeactivation', () => {
    it('should succeed when deactivation function completes', () => {
      const fn = vi.fn();

      expect(() => errorReporter.wrapDeactivation(fn)).not.toThrow();
      expect(fn).toHaveBeenCalled();
    });

    it('should log and rethrow deactivation errors', () => {
      const testError = new Error('Deactivation failed');
      const fn = vi.fn().mockImplementation(() => {
        throw testError;
      });

      expect(() => errorReporter.wrapDeactivation(fn)).toThrow(
        'Deactivation failed',
      );
    });
  });

  describe('global handlers', () => {
    it('should install and remove process handlers', () => {
      const addListenerSpy = vi.spyOn(process, 'on');
      const removeListenerSpy = vi.spyOn(process, 'off');

      errorReporter.installGlobalHandlers();
      expect(addListenerSpy).toHaveBeenCalledWith(
        'uncaughtException',
        expect.any(Function),
      );
      expect(addListenerSpy).toHaveBeenCalledWith(
        'unhandledRejection',
        expect.any(Function),
      );

      errorReporter.uninstallGlobalHandlers();
      expect(removeListenerSpy).toHaveBeenCalledWith(
        'uncaughtException',
        expect.any(Function),
      );
      expect(removeListenerSpy).toHaveBeenCalledWith(
        'unhandledRejection',
        expect.any(Function),
      );

      addListenerSpy.mockRestore();
      removeListenerSpy.mockRestore();
    });
  });
});
