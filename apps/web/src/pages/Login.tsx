import { useState, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { getMe } from '../lib/api';

type Step = 'email' | 'pin';

const PIN_LENGTH = 8;
const EMPTY_PIN = Array(PIN_LENGTH).fill('');

function persistStep(step: Step, email: string) {
  if (step === 'pin') {
    sessionStorage.setItem('login-step', 'pin');
    sessionStorage.setItem('login-email', email);
  } else {
    sessionStorage.removeItem('login-step');
    sessionStorage.removeItem('login-email');
  }
}

export default function Login() {
  const { session } = useAuthStore();
  const [step, setStep] = useState<Step>(() =>
    (sessionStorage.getItem('login-step') as Step) ?? 'email'
  );
  const [email, setEmail] = useState(() =>
    sessionStorage.getItem('login-email') ?? ''
  );
  const [pin, setPin] = useState<string[]>(EMPTY_PIN);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  if (session) return <Navigate to="/" replace />;

  function goToEmail() {
    setStep('email');
    setPin(EMPTY_PIN);
    setError('');
    persistStep('email', '');
  }

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: 'splitit-dev',
    });
    setLoading(false);
    if (err) setError(err.message);
  }

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    persistStep('pin', email.trim().toLowerCase());
    setStep('pin');
    setTimeout(() => pinRefs.current[0]?.focus(), 100);
  }

  async function verifyPin(e: React.FormEvent) {
    e.preventDefault();
    const token = pin.join('');
    if (token.length !== PIN_LENGTH) { setError(`Enter all ${PIN_LENGTH} digits`); return; }
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' });
    if (err) {
      setLoading(false);
      setError('Invalid or expired code — try again');
      setPin(EMPTY_PIN);
      pinRefs.current[0]?.focus();
      return;
    }
    try {
      await getMe();
    } catch {
      await supabase.auth.signOut();
      setLoading(false);
      goToEmail();
      setError('This email is not authorized to access Split It.');
      return;
    }
    persistStep('email', '');
    setLoading(false);
  }

  function handlePinChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const next = [...pin];
    next[index] = value.slice(-1);
    setPin(next);
    if (value && index < PIN_LENGTH - 1) pinRefs.current[index + 1]?.focus();
  }

  function handlePinKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
  }

  function handlePinPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (text.length === PIN_LENGTH) {
      setPin(text.split(''));
      pinRefs.current[PIN_LENGTH - 1]?.focus();
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-brand-50 to-white">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🍽️</div>
          <h1 className="text-3xl font-bold text-gray-900">Split It</h1>
          <p className="text-gray-500 mt-1 text-sm">Split bills. Pay friends.</p>
        </div>

        {import.meta.env.DEV && step !== 'pin' && (
          <div className="mb-6 p-4 rounded-xl border border-dashed border-amber-300 bg-amber-50">
            <p className="text-xs font-semibold text-amber-700 mb-2">⚡ Dev bypass (local only)</p>
              <form onSubmit={devLogin} className="space-y-2">
                <input
                  className="input text-sm"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p className="text-red-500 text-xs">{error}</p>}
                <button className="btn-primary text-sm py-2" type="submit" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in instantly'}
                </button>
              </form>
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={sendOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyPin} className="space-y-6">
            <div className="text-center">
              <p className="text-sm text-gray-500">
                We sent an {PIN_LENGTH}-digit code to <span className="font-medium text-gray-900">{email}</span>
              </p>
            </div>
            <div className="flex gap-1.5 justify-center" onPaste={handlePinPaste}>
              {pin.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { pinRefs.current[i] = el; }}
                  className="w-10 h-14 text-center text-xl font-bold border-2 border-gray-200 rounded-xl
                    focus:border-brand-500 focus:outline-none focus:ring-0 transition"
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => handlePinKeyDown(i, e)}
                />
              ))}
            </div>
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <button className="btn-primary" type="submit" disabled={loading || pin.join('').length !== PIN_LENGTH}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button type="button" className="btn-secondary" onClick={goToEmail}>
              Use different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
