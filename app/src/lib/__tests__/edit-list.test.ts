import { moveItem, removeItem, updateItem } from '../edit-list';

describe('edit-list', () => {
  it('updateItem replaces one element', () => {
    expect(updateItem(['a', 'b'], 1, 'c')).toEqual(['a', 'c']);
  });
  it('removeItem drops the index', () => {
    expect(removeItem(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
  it('moveItem shifts and clamps', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
  it('never mutates the input', () => {
    const input = ['a', 'b'];
    moveItem(input, 0, 1);
    removeItem(input, 0);
    updateItem(input, 0, 'z');
    expect(input).toEqual(['a', 'b']);
  });
});
