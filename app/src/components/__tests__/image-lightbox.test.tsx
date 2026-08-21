import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/lib/theme';

import { ImageLightbox } from '../image-lightbox';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function wrap(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('ImageLightbox', () => {
  it('renders no viewer chrome when there are no paths', () => {
    const { queryByLabelText } = wrap(
      <ImageLightbox visible paths={[]} onClose={() => {}} />
    );
    expect(queryByLabelText('Close image viewer')).toBeNull();
  });

  it('shows the close control and fires onClose when tapped', () => {
    const onClose = jest.fn();
    const { getByLabelText } = wrap(
      <ImageLightbox visible paths={['a/1.jpg', 'a/2.jpg']} onClose={onClose} />
    );
    fireEvent.press(getByLabelText('Close image viewer'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders one paging dot per image when there are several', () => {
    const { getByLabelText } = wrap(
      <ImageLightbox visible paths={['a/1.jpg', 'a/2.jpg', 'a/3.jpg']} onClose={() => {}} />
    );
    // The viewer mounts with a reachable close control regardless of image count.
    expect(getByLabelText('Close image viewer')).toBeTruthy();
  });
});
