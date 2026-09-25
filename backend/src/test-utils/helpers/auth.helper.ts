/**
 * Auth Test Helpers
 *
 * Utilities for mocking authentication and authorization in tests.
 */

import { ExecutionContext } from '@nestjs/common';
import { RbacActions } from '@prisma/client';
import { UserFactory } from '../factories';

/**
 * Create a mock execution context for HTTP requests
 */
export function createMockHttpExecutionContext(
  overrides: {
    user?: any;
    params?: Record<string, any>;
    body?: Record<string, any>;
    query?: Record<string, any>;
    headers?: Record<string, any>;
  } = {},
): ExecutionContext {
  const {
    user = UserFactory.build(),
    params = {},
    body = {},
    query = {},
    headers = {},
  } = overrides;

  const request = {
    user,
    params,
    body,
    query,
    headers,
  };

  return {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
      getResponse: jest.fn().mockReturnValue({}),
    }),
    getType: jest.fn().mockReturnValue('http'),
    getClass: jest.fn(),
    getHandler: jest.fn(),
    getArgs: jest.fn(),
    getArgByIndex: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
  };
}

/**
 * Create a mock execution context for WebSocket connections
 */
export function createMockWsExecutionContext(
  overrides: {
    user?: any;
    client?: any;
    data?: any;
  } = {},
): ExecutionContext {
  const {
    user = UserFactory.build(),
    client = { id: 'socket-123', emit: jest.fn() },
    data = {},
  } = overrides;

  const wsClient = {
    ...client,
    user,
    data: { ...client.data, user },
  };

  return {
    switchToWs: jest.fn().mockReturnValue({
      getClient: jest.fn().mockReturnValue(wsClient),
      getData: jest.fn().mockReturnValue(data),
    }),
    getType: jest.fn().mockReturnValue('ws'),
    getClass: jest.fn(),
    getHandler: jest.fn(),
    getArgs: jest.fn(),
    getArgByIndex: jest.fn(),
    switchToHttp: jest.fn(),
    switchToRpc: jest.fn(),
  };
}

/**
 * Create a mock user with specific RBAC actions
 */
export function createMockUserWithActions(
  actions: RbacActions[],
  overrides = {},
) {
  return {
    ...UserFactory.build(overrides),
    rbacActions: actions,
  };
}

/**
 * Create a mock JWT payload
 */
export function createMockJwtPayload(
  overrides: {
    userId?: string;
    username?: string;
    role?: string;
  } = {},
) {
  return {
    userId: overrides.userId || 'test-user-id',
    username: overrides.username || 'testuser',
    role: overrides.role || 'USER',
  };
}

/**
 * Mock the request user for authenticated endpoints
 */
export function mockAuthenticatedRequest(user = UserFactory.build()) {
  return {
    user,
    params: {},
    body: {},
    query: {},
    headers: { authorization: 'Bearer mock-token' },
  };
}
