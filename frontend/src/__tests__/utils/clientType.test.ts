import { describe, it, expect } from 'vitest';
import { clientTypeHeaders } from '../../utils/clientType';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { createFakeElectronAPI } from '../test-utils';

describe('clientTypeHeaders', () => {
  it('declares nothing in a web browser', () => {
    setElectronAPIOverride(null);
    expect(clientTypeHeaders()).toEqual({});
  });

  it('declares electron in the desktop app', () => {
    setElectronAPIOverride(createFakeElectronAPI());
    expect(clientTypeHeaders()).toEqual({ 'X-Client-Type': 'electron' });
  });
});
