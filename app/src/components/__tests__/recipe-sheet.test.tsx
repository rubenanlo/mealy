import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { State } from 'react-native-gesture-handler';
import {
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';

import { useReducedMotion } from '@/lib/motion';
import { ThemeProvider } from '@/lib/theme';

import { DraggableSheet } from '../recipe-sheet';

jest.mock('@/lib/motion', () => ({ useReducedMotion: jest.fn(() => false) }));
const mockReducedMotion = useReducedMotion as jest.Mock;

afterEach(() => mockReducedMotion.mockReturnValue(false));

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('DraggableSheet', () => {
  it('renders its children and a visible drag handle', () => {
    const { getByText, getByTestId } = wrap(
      <DraggableSheet onDismiss={() => {}}>
        <Text>Recipe body</Text>
      </DraggableSheet>
    );
    expect(getByText('Recipe body')).toBeTruthy();
    expect(getByTestId('recipe-sheet-drag-handle')).toBeTruthy();
  });

  it('dismisses when the backdrop is tapped', () => {
    const onDismiss = jest.fn();
    const { getByLabelText } = wrap(
      <DraggableSheet onDismiss={onDismiss}>
        <Text>Recipe body</Text>
      </DraggableSheet>
    );
    fireEvent.press(getByLabelText('Close the recipe'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses after a long downward drag on the handle', () => {
    const onDismiss = jest.fn();
    wrap(
      <DraggableSheet onDismiss={onDismiss}>
        <Text>Recipe body</Text>
      </DraggableSheet>
    );
    fireGestureHandler(getByGestureTestId('recipe-sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 80 },
      { translationY: 200 },
      { state: State.END, translationY: 200, velocityY: 0 },
    ]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses after a fast downward flick even over a short distance', () => {
    const onDismiss = jest.fn();
    wrap(
      <DraggableSheet onDismiss={onDismiss}>
        <Text>Recipe body</Text>
      </DraggableSheet>
    );
    fireGestureHandler(getByGestureTestId('recipe-sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 30 },
      { state: State.END, translationY: 40, velocityY: 1200 },
    ]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('still dismisses on a long drag under reduced motion, and short drags spring back', () => {
    mockReducedMotion.mockReturnValue(true);
    const onDismiss = jest.fn();
    const { getByText } = wrap(
      <DraggableSheet onDismiss={onDismiss}>
        <Text>Recipe body</Text>
      </DraggableSheet>
    );
    fireGestureHandler(getByGestureTestId('recipe-sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 40 },
      { state: State.END, translationY: 40, velocityY: 0 },
    ]);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(getByText('Recipe body')).toBeTruthy();
    fireGestureHandler(getByGestureTestId('recipe-sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 150 },
      { state: State.END, translationY: 200, velocityY: 0 },
    ]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('springs back without dismissing after a short slow drag', () => {
    const onDismiss = jest.fn();
    const { getByText } = wrap(
      <DraggableSheet onDismiss={onDismiss}>
        <Text>Recipe body</Text>
      </DraggableSheet>
    );
    fireGestureHandler(getByGestureTestId('recipe-sheet-pan'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 40 },
      { state: State.END, translationY: 40, velocityY: 0 },
    ]);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(getByText('Recipe body')).toBeTruthy();
  });
});
