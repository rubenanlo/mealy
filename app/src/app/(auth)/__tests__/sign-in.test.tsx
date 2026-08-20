import { render } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';

import SignInScreen from '../sign-in';

describe('SignInScreen', () => {
  it('renders the email step with French labels', async () => {
    const { getByText, getByPlaceholderText } = await render(
      <ThemeProvider>
        <SignInScreen />
      </ThemeProvider>
    );
    expect(getByText('Connexion')).toBeTruthy();
    expect(getByPlaceholderText('Adresse e-mail')).toBeTruthy();
    expect(getByText('Recevoir un code')).toBeTruthy();
  });
});
