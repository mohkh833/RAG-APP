import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LoginDto, RegisterDto } from './auth.dto';

function failedProperties(dto: object, payload: object): string[] {
  const instance = plainToInstance(dto as never, payload);
  return validateSync(instance as object).map((e) => e.property);
}

describe('RegisterDto', () => {
  it('accepts a valid email and an 8-character password', () => {
    expect(
      failedProperties(RegisterDto, {
        email: 'ada@example.com',
        password: '12345678',
      }),
    ).toEqual([]);
  });

  it.each([
    ['not-an-email', 'no @'],
    ['ada@', 'no domain'],
    ['', 'empty'],
  ])('rejects %s (%s)', (email) => {
    expect(
      failedProperties(RegisterDto, { email, password: '12345678' }),
    ).toContain('email');
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(
      failedProperties(RegisterDto, {
        email: 'ada@example.com',
        password: '1234567',
      }),
    ).toContain('password');
  });

  it('rejects a missing password', () => {
    expect(failedProperties(RegisterDto, { email: 'ada@example.com' })).toEqual(
      ['password'],
    );
  });

  it('rejects a non-string password rather than coercing it', () => {
    expect(
      failedProperties(RegisterDto, {
        email: 'ada@example.com',
        password: 12345678,
      }),
    ).toContain('password');
  });
});

describe('LoginDto', () => {
  it('accepts valid credentials', () => {
    expect(
      failedProperties(LoginDto, {
        email: 'ada@example.com',
        password: '12345678',
      }),
    ).toEqual([]);
  });

  it('accepts a short password', () => {
    // Login must not enforce the registration password policy. If the minimum
    // length is ever raised, existing accounts have to stay able to sign in
    // and change their password -- a MinLength here would lock them out.
    expect(
      failedProperties(LoginDto, { email: 'ada@example.com', password: 'x' }),
    ).toEqual([]);
  });

  it('still requires a well-formed email', () => {
    expect(
      failedProperties(LoginDto, { email: 'nope', password: '12345678' }),
    ).toContain('email');
  });
});
