import { Logger } from '@nestjs/common';
import { UserFactory } from '@/test-utils';
import type { AuthenticatedRequest } from '@/types';
import { VoiceDiagnosticsController } from './voice-diagnostics.controller';
import { ReportJoinFailureDto } from './dto/report-join-failure.dto';

describe('VoiceDiagnosticsController', () => {
  let controller: VoiceDiagnosticsController;
  let warn: jest.SpyInstance;
  const user = UserFactory.build();
  const req = { user } as unknown as AuthenticatedRequest;

  const dto: ReportJoinFailureDto = {
    errorClass: 'media_unreachable',
    message: 'could not establish pc connection',
    durationMs: 15000,
    candidateTypes: ['host', 'srflx'],
    platform: 'electron',
    os: 'Linux x86_64',
    appVersion: '0.6.0',
    channelId: 'chan-1',
    isDm: false,
  };

  beforeEach(() => {
    controller = new VoiceDiagnosticsController();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  it('logs the failure at warn level with the user id and the report', () => {
    controller.reportJoinFailure(req, dto);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain(`user ${user.id}`);
    expect(line).toContain('"errorClass":"media_unreachable"');
    expect(line).toContain('"candidateTypes":["host","srflx"]');
    expect(line).toContain('"channelId":"chan-1"');
    expect(line).toContain('"platform":"electron"');
  });

  it('never logs a channel id for a DM call', () => {
    controller.reportJoinFailure(req, {
      ...dto,
      isDm: true,
      channelId: 'dm-group-1',
    });

    const line = warn.mock.calls[0][0] as string;
    expect(line).not.toContain('dm-group-1');
    expect(line).toContain('"isDm":true');
  });

  it('returns nothing (204)', () => {
    expect(controller.reportJoinFailure(req, dto)).toBeUndefined();
  });
});
