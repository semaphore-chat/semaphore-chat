import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ForbiddenException } from '@nestjs/common';
import { InstanceRole } from '@prisma/client';
import { DebugController } from './debug.controller';
import { WebsocketService } from '@/websocket/websocket.service';

describe('DebugController', () => {
  let controller: DebugController;
  let websocketService: Mocked<WebsocketService>;

  const ownerReq = { user: { id: 'owner-1', role: InstanceRole.OWNER } } as any;
  const userReq = { user: { id: 'user-1', role: InstanceRole.USER } } as any;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      DebugController,
    ).compile();

    controller = unit;
    websocketService = unitRef.get(WebsocketService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStatus', () => {
    it('should return enabled for OWNER', () => {
      const result = controller.getStatus(ownerReq);
      expect(result).toEqual({ enabled: true });
    });

    it('should throw ForbiddenException for non-OWNER', () => {
      expect(() => controller.getStatus(userReq)).toThrow(ForbiddenException);
    });
  });

  describe('emit', () => {
    it('should throw ForbiddenException for non-OWNER', () => {
      expect(() =>
        controller.emit(userReq, {
          event: 'test',
          roomType: 'channel',
          roomId: 'ch-1',
          payload: {},
        }),
      ).toThrow(ForbiddenException);
    });

    it('should resolve channel room type as raw ID', () => {
      websocketService.sendToRoom.mockReturnValue(true);

      const result = controller.emit(ownerReq, {
        event: 'userTyping',
        roomType: 'channel',
        roomId: 'ch-1',
        payload: { userId: 'u1', isTyping: true },
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'ch-1',
        'userTyping',
        { userId: 'u1', isTyping: true },
      );
      expect(result).toEqual({ success: true, room: 'ch-1', event: 'userTyping' });
    });

    it('should resolve dmGroup room type with dm: prefix', () => {
      websocketService.sendToRoom.mockReturnValue(true);

      controller.emit(ownerReq, {
        event: 'test',
        roomType: 'dmGroup',
        roomId: 'dm-1',
        payload: {},
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-1',
        'test',
        {},
      );
    });

    it('should resolve user room type with user: prefix', () => {
      websocketService.sendToRoom.mockReturnValue(true);

      controller.emit(ownerReq, {
        event: 'test',
        roomType: 'user',
        roomId: 'u-1',
        payload: {},
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:u-1',
        'test',
        {},
      );
    });

    it('should resolve community room type with community: prefix', () => {
      websocketService.sendToRoom.mockReturnValue(true);

      controller.emit(ownerReq, {
        event: 'test',
        roomType: 'community',
        roomId: 'com-1',
        payload: {},
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:com-1',
        'test',
        {},
      );
    });

    it('should pass raw room ID for raw room type', () => {
      websocketService.sendToRoom.mockReturnValue(true);

      controller.emit(ownerReq, {
        event: 'test',
        roomType: 'raw',
        roomId: 'custom-room',
        payload: {},
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'custom-room',
        'test',
        {},
      );
    });

    it('should return success false when sendToRoom fails', () => {
      websocketService.sendToRoom.mockReturnValue(false);

      const result = controller.emit(ownerReq, {
        event: 'test',
        roomType: 'channel',
        roomId: 'ch-1',
        payload: {},
      });

      expect(result.success).toBe(false);
    });
  });
});
