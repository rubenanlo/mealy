import { render } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';

import SignInScreen from '../sign-in';

describe('SignInScreen', () => {
  it('renders the wordmark and the email step', async () => {
    const { getByText, getByPlaceholderText } = await render(
      <ThemeProvider>
        <SignInScreen />
      </ThemeProvider>
    );
    expect(getByText('Mealy')).toBeTruthy();
    expect(getByText('The family cooking notebook')).toBeTruthy();
    expect(getByPlaceholderText('Email address')).toBeTruthy();
    expect(getByText('Send a code')).toBeTruthy();
    expect(getByText('Use a password')).toBeTruthy();
  });
});
