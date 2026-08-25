import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';

import SignUpScreen from '../sign-up';

const mockRpc = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    },
  },
}));

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));

const renderScreen = () =>
  render(
    <ThemeProvider>
      <SignUpScreen />
    </ThemeProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInWithOtp.mockResolvedValue({ error: null });
  mockVerifyOtp.mockResolvedValue({ error: null });
});

describe('SignUpScreen', () => {
  it('starts on the code step', () => {
    const { getByPlaceholderText, getByText } = renderScreen();
    expect(getByPlaceholderText('Signup code')).toBeTruthy();
    expect(getByText('Continue')).toBeTruthy();
  });

  it('advances to the email step when the code is valid', async () => {
    mockRpc.mockResolvedValue({ data: 'valid', error: null });
    const { getByPlaceholderText, getByText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Signup code'), 'MEALY-1A2B-3C4D');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => expect(getByPlaceholderText('Email address')).toBeTruthy());
    expect(mockRpc).toHaveBeenCalledWith('validate_signup_code', { p_code: 'MEALY-1A2B-3C4D' });
  });

  it('shows an error and stays on the code step when the code is invalid', async () => {
    mockRpc.mockResolvedValue({ data: 'invalid', error: null });
    const { getByPlaceholderText, getByText, queryByPlaceholderText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Signup code'), 'NOPE');
    fireEvent.press(getByText('Continue'));

    await waitFor(() => expect(getByText('That code is invalid or expired.')).toBeTruthy());
    expect(queryByPlaceholderText('Email address')).toBeNull();
  });

  it('passes the code as metadata when requesting the OTP', async () => {
    mockRpc.mockResolvedValue({ data: 'valid', error: null });
    const { getByPlaceholderText, getByText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Signup code'), 'MEALY-1A2B-3C4D');
    fireEvent.press(getByText('Continue'));
    await waitFor(() => getByPlaceholderText('Email address'));

    fireEvent.changeText(getByPlaceholderText('Email address'), 'new@family.com');
    fireEvent.press(getByText('Send a code'));

    await waitFor(() =>
      expect(mockSignInWithOtp).toHaveBeenCalledWith({
        email: 'new@family.com',
        options: { data: { signup_code: 'MEALY-1A2B-3C4D' } },
      })
    );
  });
});
