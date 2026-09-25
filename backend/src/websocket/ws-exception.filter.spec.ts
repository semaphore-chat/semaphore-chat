import { WsLoggingExceptionFilter } from './ws-exception.filter';
import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ValidationFailedException } from '@/common/pipes/app-validation.pipe';

describe('WsLoggingExceptionFilter', () => {
  let filter: WsLoggingExceptionFilter;
  let mockHost: ArgumentsHost;
  let mockClient: any;

  beforeEach(() => {
    filter = new WsLoggingExceptionFilter();

    mockClient = {
      emit: jest.fn(),
    };

    mockHost = {
      switchToWs: jest.fn().mockReturnValue({
        getData: jest
          .fn()
          .mockReturnValue({ event: 'test', data: { foo: 'bar' } }),
        getClient: jest.fn().mockReturnValue(mockClient),
        getPattern: jest.fn(),
      }),
      switchToHttp: jest.fn(),
      switchToRpc: jest.fn(),
      getArgByIndex: jest.fn(),
      getArgs: jest.fn(),
      getType: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  describe('catch', () => {
    it('should log WsException with message and stack', () => {
      const exception = new WsException('Test WebSocket exception');
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(exception, mockHost);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'WebSocket WsException: Test WebSocket exception',
        ),
        expect.any(String),
      );
    });

    it('sends validation failures from the global pipe as a WsException with the class-validator errors', () => {
      const validationErrors = [
        {
          property: 'channelId',
          children: [],
          constraints: { isString: 'channelId must be a string' },
        },
      ];
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(
        new ValidationFailedException(validationErrors, [
          'channelId must be a string',
        ]),
        mockHost,
      );

      expect(mockClient.emit).toHaveBeenCalledWith(
        'exception',
        validationErrors,
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket WsException'),
        expect.any(String),
      );
    });

    it('still reports other HTTP exceptions as an internal error', () => {
      // Also silences BaseWsExceptionFilter's own (static) logger.
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      filter.catch(new BadRequestException('nope'), mockHost);
      loggerSpy.mockRestore();

      expect(mockClient.emit).toHaveBeenCalledWith(
        'exception',
        expect.objectContaining({
          status: 'error',
          message: 'Internal server error',
        }),
      );
    });

    it('should log standard Error with message and stack', () => {
      const exception = new Error('Standard error message');
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(exception, mockHost);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket Error: Standard error message'),
        exception.stack,
      );
    });

    it('should log unknown exception as JSON', () => {
      const exception = { custom: 'exception', code: 500 };
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(exception, mockHost);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket Unknown Exception'),
        undefined,
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(exception)),
        undefined,
      );
    });

    it('should include WebSocket data in log message for WsException', () => {
      const exception = new WsException('Test exception');
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(exception, mockHost);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Data: {"event":"test","data":{"foo":"bar"}}'),
        expect.any(String),
      );
    });

    it('should include WebSocket data in log message for Error', () => {
      const exception = new Error('Test error');
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(exception, mockHost);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Data: {"event":"test","data":{"foo":"bar"}}'),
        exception.stack,
      );
    });

    it('should include WebSocket data in log message for unknown exception', () => {
      const exception = 'string exception';
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(exception, mockHost);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Data: {"event":"test","data":{"foo":"bar"}}'),
        undefined,
      );
    });

    it('should handle null exception', () => {
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(null, mockHost);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket Unknown Exception: null'),
        undefined,
      );
    });

    it('should handle undefined exception', () => {
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(undefined, mockHost);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket Unknown Exception'),
        undefined,
      );
    });

    it('should handle different WebSocket data types', () => {
      const testCases = [
        { data: { array: [1, 2, 3] }, desc: 'array in data' },
        { data: null, desc: 'null data' },
        { data: undefined, desc: 'undefined data' },
        { data: 'string data', desc: 'string data' },
        { data: 123, desc: 'number data' },
      ];

      for (const testCase of testCases) {
        mockHost.switchToWs = jest.fn().mockReturnValue({
          getData: jest.fn().mockReturnValue(testCase.data),
          getClient: jest.fn().mockReturnValue(mockClient),
          getPattern: jest.fn(),
        });

        const exception = new Error(`Test with ${testCase.desc}`);
        const loggerSpy = jest
          .spyOn(filter['logger'], 'error')
          .mockImplementation();

        filter.catch(exception, mockHost);

        expect(loggerSpy).toHaveBeenCalledWith(
          expect.stringContaining('WebSocket Error'),
          expect.any(String),
        );

        jest.clearAllMocks();
      }
    });

    it('should handle complex nested exception objects', () => {
      const exception = {
        message: 'Complex error',
        nested: {
          level: 1,
          data: { level: 2, array: [1, 2, 3] },
        },
      };
      const loggerSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation();

      filter.catch(exception, mockHost);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket Unknown Exception'),
        undefined,
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(exception)),
        undefined,
      );
    });
  });
});
