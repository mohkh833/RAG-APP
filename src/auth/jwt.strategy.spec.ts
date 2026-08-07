import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  it('is resolvable by the Nest container', async () => {
    // AuthModule registers JwtStrategy as a provider, so a failure here is a
    // failure to boot the app -- not just a test-wiring problem. A class with
    // no decorator emits no design:paramtypes, leaving Nest nothing to inject.
    const moduleRef = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: new ConfigService() },
      ],
    }).compile();

    expect(moduleRef.get(JwtStrategy)).toBeInstanceOf(JwtStrategy);
  });

  describe('validate', () => {
    const strategy = new JwtStrategy(new ConfigService());

    it('maps the token subject onto userId', () => {
      // Everything downstream (retrieval, ingestion, document ownership) keys
      // off user.userId, while the JWT carries it as the standard `sub` claim.
      expect(strategy.validate({ sub: 42, email: 'ada@example.com' })).toEqual({
        userId: 42,
        email: 'ada@example.com',
      });
    });

    it('returns userId as a number, matching documents.user_id', () => {
      const user = strategy.validate({ sub: 7, email: 'a@example.com' });

      expect(typeof user.userId).toBe('number');
    });

    it('exposes no other claims from the payload', () => {
      const user = strategy.validate({
        sub: 1,
        email: 'a@example.com',
        ...{ role: 'admin' },
      });

      expect(Object.keys(user).sort()).toEqual(['email', 'userId']);
    });
  });

  describe('configuration', () => {
    it('reads the signing secret from JWT_SECRET', () => {
      const config = new ConfigService();
      const get = jest.spyOn(config, 'get');

      new JwtStrategy(config);

      expect(get).toHaveBeenCalledWith(
        'JWT_SECRET',
        expect.stringContaining('dev-secret'),
      );
    });

    it('does not ignore expiry', () => {
      // passport-jwt keeps the constructor options on the instance; an
      // expired token must be rejected rather than silently accepted.
      const strategy = new JwtStrategy(new ConfigService()) as unknown as {
        _verifOpts?: { ignoreExpiration?: boolean };
      };

      expect(strategy._verifOpts?.ignoreExpiration).toBeFalsy();
    });
  });
});
