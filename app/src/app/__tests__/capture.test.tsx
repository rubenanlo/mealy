import { render } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';

import CaptureScreen from '../capture';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ householdId: 'hh-1' }) }));

describe('CaptureScreen', () => {
  it('offers both a manual and an automatic section', () => {
    const { getByText } = render(
      <ThemeProvider>
        <CaptureScreen />
      </ThemeProvider>
    );
    expect(getByText('Add a recipe')).toBeTruthy();
    // Manual section
    expect(getByText('Create it yourself')).toBeTruthy();
    // Automatic section
    expect(getByText('Capture')).toBeTruthy();
  });
});
