import { Platform } from 'react-native';

import { hideWebScrollbars } from '@/lib/web-style';

const documentMock = () => {
  const appended: { id?: string; textContent?: string }[] = [];
  const doc = {
    getElementById: (id: string) => appended.find((e) => e.id === id) ?? null,
    createElement: () => ({}) as { id?: string; textContent?: string },
    head: { appendChild: (el: { id?: string }) => appended.push(el) },
  };
  (globalThis as Record<string, unknown>).document = doc;
  return appended;
};

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).document;
});

describe('hideWebScrollbars', () => {
  it('appends one scrollbar-hiding style on web, once', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const appended = documentMock();

    hideWebScrollbars();
    hideWebScrollbars();

    expect(appended).toHaveLength(1);
    expect(appended[0].textContent).toContain('scrollbar-width: none');
    expect(appended[0].textContent).toContain('::-webkit-scrollbar');
  });

  it('does nothing natively', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const appended = documentMock();

    hideWebScrollbars();

    expect(appended).toHaveLength(0);
  });
});
