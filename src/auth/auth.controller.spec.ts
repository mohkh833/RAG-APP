import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  const authResult = {
    accessToken: 'signed.jwt.token',
    user: { id: 1, email: 'ada@example.com' },
  };

  let controller: AuthController;
  let auth: { register: jest.Mock; login: jest.Mock };

  beforeEach(async () => {
    auth = {
      register: jest.fn().mockResolvedValue(authResult),
      login: jest.fn().mockResolvedValue(authResult),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  it('passes the registration payload straight through', async () => {
    const dto = { email: 'ada@example.com', password: 'correct-horse' };

    await expect(controller.register(dto)).resolves.toBe(authResult);
    expect(auth.register).toHaveBeenCalledWith(dto);
  });

  it('passes the login payload straight through', async () => {
    const dto = { email: 'ada@example.com', password: 'correct-horse' };

    await expect(controller.login(dto)).resolves.toBe(authResult);
    expect(auth.login).toHaveBeenCalledWith(dto);
  });

  it('lets a ConflictException from register propagate', async () => {
    auth.register.mockRejectedValue(new ConflictException());

    await expect(
      controller.register({ email: 'ada@example.com', password: 'whatever1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets an UnauthorizedException from login propagate', async () => {
    auth.login.mockRejectedValue(new UnauthorizedException());

    await expect(
      controller.login({ email: 'ada@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('validates login against LoginDto, not RegisterDto', () => {
    // The global ValidationPipe validates against the declared parameter type,
    // so declaring RegisterDto here would apply the registration password
    // policy (MinLength 8) to sign-in and lock out any account whose password
    // predates the current policy.
    const paramTypes = (method: string): { name: string }[] =>
      Reflect.getMetadata(
        'design:paramtypes',
        AuthController.prototype,
        method,
      ) as { name: string }[];

    expect(paramTypes('login')[0].name).toBe('LoginDto');
    expect(paramTypes('register')[0].name).toBe('RegisterDto');
  });

  it('leaves both routes unguarded', () => {
    // The whole point of /auth/register and /auth/login is to be reachable
    // without a token. A JwtAuthGuard applied here -- at the class level, say,
    // copied from RagController -- would lock everyone out permanently.
    const routeGuards = (method: 'register' | 'login'): unknown =>
      Reflect.getMetadata(
        '__guards__',
        // eslint-disable-next-line @typescript-eslint/unbound-method
        AuthController.prototype[method],
      );

    expect(Reflect.getMetadata('__guards__', AuthController)).toBeUndefined();
    expect(routeGuards('register')).toBeUndefined();
    expect(routeGuards('login')).toBeUndefined();
  });
});
