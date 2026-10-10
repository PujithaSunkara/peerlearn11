import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  GraduationCap,
  UserPlus,
  MailCheck,
  AlertCircle,
  CheckCircle2,
  Send,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

export function RegisterPage() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');

  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpSentMessage, setOtpSentMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSendOtp = async () => {
    setError('');
    setOtpSentMessage('');
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address first to receive an OTP.');
      return;
    }

    setSendingOtp(true);
    try {
      const res = await api.post('/auth/send-otp', { email });
      setOtpSentMessage(
        res.data.message ||
          `A 6-digit verification OTP has been sent to ${email}. Please check your email inbox.`
      );
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Failed to send OTP email. Please check your email address.';
      setError(msg);
    } finally {
      setSendingOtp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Password and confirmation password do not match.');
      return;
    }
    if (!otp.trim()) {
      setError('Please enter the 6-digit OTP sent to your email.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post('/auth/register', {
        username,
        email,
        password,
        confirmPassword,
        otp: otp.trim(),
      });
      loginWithToken(res.data.token, res.data.user);
      // Immediately proceed to Step 2: Student Details Form
      navigate('/onboarding/details');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Registration failed. Please verify your OTP and inputs.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-6">
      <div className="max-w-lg w-full mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-xl font-bold text-blue-700 font-display">
            <GraduationCap className="w-6 h-6 text-blue-600" />
            PeerConnect AI
          </div>
          <h1 className="text-2xl font-bold text-slate-900 font-display">
            Step 1: Student Registration & Email OTP
          </h1>
          <p className="text-sm text-slate-600">
            Verify your email with the 6-digit OTP sent to your inbox to continue to the Student Details form
          </p>
        </div>

        {/* Segmented Login / Register Switcher */}
        <div className="grid grid-cols-2 p-1 bg-slate-200/80 rounded-lg">
          <Link
            to="/login"
            className="py-2 text-center text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            Login
          </Link>
          <span className="py-2 text-center text-xs font-semibold bg-white text-slate-900 rounded-md shadow-xs">
            Register
          </span>
        </div>

        <div className="bg-white p-6 sm:p-8 rounded-xl border border-slate-200 space-y-5">
          {error && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {otpSentMessage && (
            <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{otpSentMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="reg-username"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Username / Full Name
              </label>
              <input
                id="reg-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g., Pujitha Sunkara"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="reg-email"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Email Address
              </label>
              <div className="flex gap-2">
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@vignaniit.edu.in"
                  className="flex-1 px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={sendingOtp}
                  className="px-4 py-2.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5" />
                  {sendingOtp ? 'Sending OTP...' : 'Send OTP to Email'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="reg-password"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Password
                </label>
                <input
                  id="reg-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="reg-confirm"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Confirm Password
                </label>
                <input
                  id="reg-confirm"
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="reg-otp"
                className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5"
              >
                <MailCheck className="w-4 h-4 text-blue-600" />
                OTP for Email Verification (6-digit code)
              </label>
              <input
                id="reg-otp"
                type="text"
                required
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter the 6-digit OTP sent to your email"
                className="w-full px-3.5 py-2.5 text-sm font-mono tracking-widest rounded-lg border border-slate-300 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              {submitting
                ? 'Verifying OTP & Creating Account...'
                : 'Verify Email & Continue to Student Details →'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-blue-600 hover:underline">
            Login here
          </Link>
        </p>
      </div>
    </div>
  );
}
