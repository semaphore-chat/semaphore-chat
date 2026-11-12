import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { AcceptInviteController } from './accept-invite.controller';
import { MembershipService } from './membership.service';
import type { AuthenticatedRequest } from '@/types';

describe('AcceptInviteController', () => {
  let controller: AcceptInviteController;
  let membershipService: Mocked<MembershipService>;

  const req = { user: { id: 'user-1' } } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      AcceptInviteController,
    ).compile();

    controller = unit;
    membershipService = unitRef.get(MembershipService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('accepts the invite for the signed-in user', async () => {
    const accepted = {
      joined: [{ id: 'community-1', name: 'One' }],
      skipped: [],
    };
    membershipService.acceptInvite.mockResolvedValue(accepted);

    const result = await controller.acceptInvite(req, 'CODE123');

    expect(result).toEqual(accepted);
    expect(membershipService.acceptInvite).toHaveBeenCalledWith(
      'CODE123',
      'user-1',
    );
  });
});
