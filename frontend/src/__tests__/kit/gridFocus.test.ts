import { describe, expect, it } from 'vitest';
import { isGridKey, nextGridPosition } from '../../kit/lists/gridFocus';

// Two sections: 10 cells in rows of 4 (the last row has 2), then 3 cells in rows of 4.
const counts = [10, 3];
const columns = [4, 4];
const at = (section: number, index: number) => ({ section, index });

describe('nextGridPosition', () => {
  it('steps left and right one cell, across section ends, and stops at the grid edges', () => {
    expect(nextGridPosition('ArrowRight', at(0, 2), counts, columns)).toEqual(at(0, 3));
    expect(nextGridPosition('ArrowRight', at(0, 9), counts, columns)).toEqual(at(1, 0));
    expect(nextGridPosition('ArrowLeft', at(1, 0), counts, columns)).toEqual(at(0, 9));
    expect(nextGridPosition('ArrowLeft', at(0, 0), counts, columns)).toEqual(at(0, 0));
    expect(nextGridPosition('ArrowRight', at(1, 2), counts, columns)).toEqual(at(1, 2));
  });

  it('steps up and down a row, keeping the column, into the next section', () => {
    expect(nextGridPosition('ArrowDown', at(0, 1), counts, columns)).toEqual(at(0, 5));
    expect(nextGridPosition('ArrowUp', at(0, 5), counts, columns)).toEqual(at(0, 1));
    // The last row of section 0 is cells 8-9: from 9 (column 1) down into section 1, column 1.
    expect(nextGridPosition('ArrowDown', at(0, 9), counts, columns)).toEqual(at(1, 1));
    // Up from section 1 column 2: section 0's last row has no column 2, so its last cell.
    expect(nextGridPosition('ArrowUp', at(1, 2), counts, columns)).toEqual(at(0, 9));
    expect(nextGridPosition('ArrowUp', at(1, 0), counts, columns)).toEqual(at(0, 8));
    // Nothing below the last row of the last section, nothing above the first.
    expect(nextGridPosition('ArrowDown', at(1, 1), counts, columns)).toEqual(at(1, 1));
    expect(nextGridPosition('ArrowUp', at(0, 2), counts, columns)).toEqual(at(0, 2));
  });

  it('goes down to the shorter last row of a section before leaving it', () => {
    // Cell 7 (row 2, column 3): the last row (8, 9) has no column 3, so its last cell.
    expect(nextGridPosition('ArrowDown', at(0, 7), counts, columns)).toEqual(at(0, 9));
  });

  it('keeps the column across sections with different widths', () => {
    expect(nextGridPosition('ArrowDown', at(0, 3), [4, 6], [4, 2])).toEqual(at(1, 1));
    expect(nextGridPosition('ArrowUp', at(1, 1), [4, 6], [4, 2])).toEqual(at(0, 1));
  });

  it('goes to the first and last cell with Home and End', () => {
    expect(nextGridPosition('Home', at(1, 2), counts, columns)).toEqual(at(0, 0));
    expect(nextGridPosition('End', at(0, 2), counts, columns)).toEqual(at(1, 2));
  });

  it('skips empty sections', () => {
    expect(nextGridPosition('ArrowRight', at(0, 1), [2, 0, 3], [4, 4, 4])).toEqual(at(2, 0));
    expect(nextGridPosition('ArrowDown', at(0, 1), [2, 0, 3], [4, 4, 4])).toEqual(at(2, 1));
    expect(nextGridPosition('Home', at(2, 1), [0, 0, 3], [4, 4, 4])).toEqual(at(2, 0));
  });

  it('ignores other keys', () => {
    expect(nextGridPosition('a', at(0, 1), counts, columns)).toEqual(at(0, 1));
    expect(isGridKey('ArrowUp')).toBe(true);
    expect(isGridKey('Enter')).toBe(false);
  });
});
