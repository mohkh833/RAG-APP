import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';
import type { ExecutionContext } from '@nestjs/common';
import type { RequestUser } from './current-user.decorator';

/**
 * Param decorators are factories wrapped in Nest metadata; the only way to
 * exercise the extraction logic is to pull the factory back out of the
 * metadata it writes onto a host class.
 */
function extractFactory() {
  class Probe {
    handler(@CurrentUser() user: RequestUser) {
      return user;
    }
  }

  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    'handler',
  ) as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => unknown }
  >;

  return Object.values(args)[0].factory;
}

function contextWithRequest(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CurrentUser', () => {
  const factory = extractFactory();

  it('returns the user that JwtStrategy attached to the request', () => {
    const user: RequestUser = { userId: 42, email: 'ada@example.com' };

    expect(factory(undefined, contextWithRequest({ user }))).toBe(user);
  });

  it('yields the userId every downstream service scopes its queries by', () => {
    const user = factory(
      undefined,
      contextWithRequest({
        user: { userId: 7, email: 'ada@example.com' },
      }),
    ) as RequestUser;

    expect(user.userId).toBe(7);
  });

  it('returns undefined on an unauthenticated request', () => {
    // Only reachable if a route forgets JwtAuthGuard. The decorator does not
    // throw, so the guard is the sole thing standing between an anonymous
    // request and a `user.userId` of undefined -- which would silently widen
    // every user-scoped query. Guard coverage lives in the controller specs.
    expect(factory(undefined, contextWithRequest({}))).toBeUndefined();
  });
});
