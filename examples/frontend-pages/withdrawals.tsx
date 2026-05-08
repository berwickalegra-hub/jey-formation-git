// EXAMPLE — copy this into your project's app router and customize the UI freely.
// This file is NOT part of the starter — the template ships zero design.
// Delete this file or replace it with your own implementation.
//
// Demonstrates the full withdrawal flow including the PIN gate that the
// server (`WITHDRAWAL_REQUIRE_PIN=1`) optionally enforces:
//
//   1. On mount, GET /api/auth/withdrawal-pin → { hasPin: boolean }.
//      If true: prompt the user for their 4-12 digit PIN before submit.
//      If false but WITHDRAWAL_REQUIRE_PIN is on: surface PIN_NOT_SET
//      and link to /settings/withdrawal-pin to set one.
//   2. POST /api/withdrawals with { amount, currency, destination, pin? }.
//      Branch on err.code (typed) — DO NOT match err.message.
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useUser } from '@/contexts/AuthContext';

const METHODS = [
  { id: 'WAVE', label: 'Wave' },
  { id: 'ORANGE_MONEY', label: 'Orange Money' },
  { id: 'FREE_MONEY', label: 'Free Money' },
] as const;

type Method = (typeof METHODS)[number]['id'];

interface PinStatus {
  hasPin: boolean;
}

interface CreateWithdrawalResponse {
  withdrawalId: string;
  status: string;
}

export default function WithdrawalsPage() {
  // Redirects to /login if logged out — body below sees a non-null user.
  const user = useUser();

  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('WAVE');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreateWithdrawalResponse | null>(null);

  useEffect(() => {
    if (!user) return;
    void api<PinStatus>('/api/auth/withdrawal-pin').then((r) => setHasPin(r.hasPin));
  }, [user]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const body: Record<string, unknown> = {
      amount: Number(amount),
      currency: 'XOF',
      destination: { method, phone },
    };
    if (pin) body.pin = pin;

    try {
      const res = await api<CreateWithdrawalResponse>('/api/withdrawals', {
        method: 'POST',
        body,
      });
      setSuccess(res);
      setAmount('');
      setPin('');
    } catch (err) {
      if (err instanceof ApiError) {
        // Branch on the stable code, not the translated message.
        switch (err.code) {
          case 'PIN_NOT_SET':
            setError('You need to set up a withdrawal PIN before requesting a withdrawal.');
            break;
          case 'PIN_REQUIRED':
            setError('Enter your withdrawal PIN.');
            break;
          case 'PIN_INVALID':
            setError('That PIN is incorrect. Try again.');
            break;
          case 'INSUFFICIENT_BALANCE':
            setError('Insufficient balance for this withdrawal.');
            break;
          case 'AMOUNT_BELOW_MIN':
          case 'AMOUNT_ABOVE_MAX':
            setError(err.message);
            break;
          case 'DAILY_LIMIT_EXCEEDED':
            setError('You hit the daily withdrawal limit. Try again tomorrow.');
            break;
          case 'COOLDOWN_ACTIVE':
            setError('You withdrew recently. Please wait before another request.');
            break;
          default:
            setError(err.message);
        }
      } else {
        setError('Unknown error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null; // useUser is redirecting

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-bold">Request a withdrawal</h1>

      {success && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
          Withdrawal {success.withdrawalId} is now {success.status}.
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Amount (XOF)
          <input
            type="number"
            required
            min={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <fieldset className="flex flex-col gap-1 text-sm">
          <legend>Method</legend>
          <div className="flex gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                  method === m.id ? 'border-black bg-black text-white' : 'border-gray-300 bg-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm">
          Phone (with country code)
          <input
            type="tel"
            required
            placeholder="+221770000000"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        {hasPin && (
          <label className="flex flex-col gap-1 text-sm">
            Withdrawal PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              minLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="rounded-md border border-gray-300 px-3 py-2 font-mono tracking-widest"
            />
            <span className="text-xs text-gray-500">4-12 digits.</span>
          </label>
        )}

        {hasPin === false && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            You haven&apos;t set a withdrawal PIN.{' '}
            <Link href="/settings/withdrawal-pin" className="underline">
              Set one now
            </Link>{' '}
            for added safety.
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Requesting…' : 'Request withdrawal'}
        </button>
      </form>
    </main>
  );
}
