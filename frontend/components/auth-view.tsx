'use client';

import { useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth-state';
import { Alert, Button, Card, Field, MessageList, Spinner, inputClass } from '@/components/ui';
import { ApiError, NetworkError } from '@/lib/api';

type Mode = 'login' | 'register';

// Mirrors RegisterDto's @MinLength(8) so the common case is caught without a
// round trip. The backend stays the authority -- its messages are rendered
// verbatim when it disagrees.
const MIN_PASSWORD_LENGTH = 8;

const COPY: Record<Mode, { title: string; submit: string; alternate: string }> =
  {
    login: {
      title: 'Sign in',
      submit: 'Sign in',
      alternate: 'Need an account? Create one',
    },
    register: {
      title: 'Create an account',
      submit: 'Create account',
      alternate: 'Already have an account? Sign in',
    },
  };

export function AuthView() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = COPY[mode];

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setErrors(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (mode === 'register' && password.length < MIN_PASSWORD_LENGTH) {
      setErrors([
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      ]);
      return;
    }

    setBusy(true);
    setErrors(null);
    try {
      const submit = mode === 'login' ? signIn : signUp;
      await submit({ email: email.trim(), password });
      // On success this component unmounts -- AuthGate swaps it for the app --
      // so there is deliberately no success state to reset here.
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.messages);
      } else if (err instanceof NetworkError) {
        setErrors([err.message]);
      } else {
        setErrors(['Something went wrong. Please try again.']);
      }
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
      <Card className="p-6">
        <h1 className="font-display text-xl font-medium tracking-tight text-ink">
          {copy.title}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Your documents and answers are private to your account.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <Field label="Email" htmlFor="auth-email">
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="Password"
            htmlFor="auth-password"
            hint={
              mode === 'register'
                ? `At least ${MIN_PASSWORD_LENGTH} characters.`
                : undefined
            }
          >
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </Field>

          {errors && (
            <Alert tone="error">
              <MessageList messages={errors} />
            </Alert>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Spinner />}
            {copy.submit}
          </Button>
        </form>

        <button
          type="button"
          onClick={switchMode}
          className="mt-4 w-full text-center text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {copy.alternate}
        </button>
      </Card>
    </div>
  );
}
