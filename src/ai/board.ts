import type { Shape } from './tetrominoes.js';

const BOARD_KEYS = new WeakMap<BitBoard, string>();

export interface BoardFeatures {
  aggregateHeight: number;
  bumpiness: number;
  coveredHoles: number;
  heightVariance: number;
  holes: number;
  maxHeight: number;
  rowTransitions: number;
  columnTransitions: number;
  deepestWell: number;
  occupiedCells: number;
}

export interface PlacementResult {
  board: BitBoard;
  lines: number;
  y: number;
}

export interface GarbageInsertionResult {
  board: BitBoard;
  toppedOut: boolean;
}

/**
 * A compact, immutable-ish 10-wide board representation. Rows are ordered from
 * bottom to top, which makes line clearing and hard-drop simulation inexpensive.
 */
export class BitBoard {
  readonly width: number;
  readonly height: number;
  readonly rows: Uint16Array;
  readonly fullRowMask: number;

  constructor(width = 10, height = 40, rows?: Uint16Array) {
    if (!Number.isInteger(width) || width < 4 || width > 16) {
      throw new Error('Board width must be an integer from 4 through 16.');
    }
    if (!Number.isInteger(height) || height < 4 || height > 64) {
      throw new Error('Board height must be an integer from 4 through 64.');
    }

    this.width = width;
    this.height = height;
    this.fullRowMask = (1 << width) - 1;
    this.rows = rows ? new Uint16Array(rows) : new Uint16Array(height);

    if (this.rows.length !== height) {
      throw new Error(`Expected ${height} board rows, received ${this.rows.length}.`);
    }
  }

  static fromRows(width: number, rows: readonly number[], height = rows.length): BitBoard {
    const normalized = new Uint16Array(height);
    const fullMask = (1 << width) - 1;
    for (let y = 0; y < height; y += 1) {
      normalized[y] = (rows[y] ?? 0) & fullMask;
    }
    return new BitBoard(width, height, normalized);
  }

  get occupiedCount(): number {
    let count = 0;
    for (const row of this.rows) {
      count += popCount(row);
    }
    return count;
  }

  isOccupied(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return true;
    }
    return (rowAt(this.rows, y) & (1 << x)) !== 0;
  }

  canPlace(shape: Shape, x: number, y: number): boolean {
    if (x < 0 || x + shape.width > this.width || y < 0 || y + shape.height > this.height) {
      return false;
    }

    for (const [cellX, cellY] of shape.cells) {
      if ((rowAt(this.rows, y + cellY) & (1 << (x + cellX))) !== 0) {
        return false;
      }
    }
    return true;
  }

  hasOccupiedAtOrAbove(row: number): boolean {
    if (row < 0 || row > this.height) {
      throw new RangeError(`Board row ${row} is outside the board.`);
    }
    for (let y = row; y < this.height; y += 1) {
      if (rowAt(this.rows, y) !== 0) {
        return true;
      }
    }
    return false;
  }

  hardDropY(shape: Shape, x: number, playHeight = this.height): number | undefined {
    if (
      playHeight < shape.height ||
      playHeight > this.height ||
      this.hasOccupiedAtOrAbove(playHeight)
    ) {
      return undefined;
    }

    let y = playHeight - shape.height;
    if (!this.canPlace(shape, x, y)) {
      return undefined;
    }

    while (y > 0 && this.canPlace(shape, x, y - 1)) {
      y -= 1;
    }
    return y;
  }

  place(shape: Shape, x: number, y: number): PlacementResult | undefined {
    if (!this.canPlace(shape, x, y)) {
      return undefined;
    }

    const withPiece = new Uint16Array(this.rows);
    for (const [cellX, cellY] of shape.cells) {
      const rowIndex = y + cellY;
      withPiece[rowIndex] = rowAt(withPiece, rowIndex) | (1 << (x + cellX));
    }

    const cleared = new Uint16Array(this.height);
    let writeRow = 0;
    let lines = 0;
    for (const row of withPiece) {
      if (row === this.fullRowMask) {
        lines += 1;
      } else {
        cleared[writeRow] = row;
        writeRow += 1;
      }
    }

    return {
      board: new BitBoard(this.width, this.height, cleared),
      lines,
      y,
    };
  }

  hardDrop(shape: Shape, x: number, playHeight = this.height): PlacementResult | undefined {
    const y = this.hardDropY(shape, x, playHeight);
    return y === undefined ? undefined : this.place(shape, x, y);
  }

  /**
   * Inserts bottom garbage rows with one hole each. This is an explicitly
   * deterministic local primitive for offline battle evaluation, not a claim
   * about TETR.IO's active-garbage timing.
   */
  insertGarbage(holeColumns: readonly number[]): GarbageInsertionResult {
    if (holeColumns.length > this.height) {
      throw new RangeError(`Cannot insert more than ${this.height} garbage rows at once.`);
    }

    for (const hole of holeColumns) {
      if (!Number.isInteger(hole) || hole < 0 || hole >= this.width) {
        throw new RangeError(`Garbage hole column ${hole} is outside the board.`);
      }
    }

    const inserted = holeColumns.length;
    let toppedOut = false;
    for (let y = this.height - inserted; y < this.height; y += 1) {
      if (rowAt(this.rows, y) !== 0) {
        toppedOut = true;
        break;
      }
    }

    const rows = new Uint16Array(this.height);
    for (let y = 0; y < inserted; y += 1) {
      const hole = valueAt(holeColumns, y);
      rows[y] = this.fullRowMask ^ (1 << hole);
    }
    for (let y = inserted; y < this.height; y += 1) {
      rows[y] = rowAt(this.rows, y - inserted);
    }

    return {
      board: new BitBoard(this.width, this.height, rows),
      toppedOut,
    };
  }

  features(): BoardFeatures {
    const heights = new Array<number>(this.width).fill(0);
    let holes = 0;
    let coveredHoles = 0;
    let columnTransitions = 0;
    let occupiedCells = 0;

    for (let x = 0; x < this.width; x += 1) {
      let seenBlock = false;
      let blocksAbove = 0;
      let lastOccupied = true;

      for (let y = this.height - 1; y >= 0; y -= 1) {
        const occupied = (rowAt(this.rows, y) & (1 << x)) !== 0;
        if (occupied) {
          if (!seenBlock) {
            heights[x] = y + 1;
          }
          seenBlock = true;
          blocksAbove += 1;
          occupiedCells += 1;
        } else if (seenBlock) {
          holes += 1;
          coveredHoles += blocksAbove;
        }

        if (occupied !== lastOccupied) {
          columnTransitions += 1;
        }
        lastOccupied = occupied;
      }
      if (!lastOccupied) {
        columnTransitions += 1;
      }
    }

    const aggregateHeight = heights.reduce((total, height) => total + height, 0);
    const maxHeight = Math.max(...heights);
    const averageHeight = aggregateHeight / this.width;
    const heightVariance = heights.reduce(
      (total, height) => total + (height - averageHeight) ** 2,
      0,
    );

    let rowTransitions = 0;
    for (let y = 0; y < maxHeight; y += 1) {
      let lastOccupied = true;
      for (let x = 0; x < this.width; x += 1) {
        const occupied = (rowAt(this.rows, y) & (1 << x)) !== 0;
        if (occupied !== lastOccupied) {
          rowTransitions += 1;
        }
        lastOccupied = occupied;
      }
      if (!lastOccupied) {
        rowTransitions += 1;
      }
    }

    let bumpiness = 0;
    for (let x = 0; x < this.width - 1; x += 1) {
      bumpiness += Math.abs(valueAt(heights, x) - valueAt(heights, x + 1));
    }

    return {
      aggregateHeight,
      bumpiness,
      coveredHoles,
      heightVariance,
      holes,
      maxHeight,
      rowTransitions,
      columnTransitions,
      deepestWell: this.deepestWell(heights),
      occupiedCells,
    };
  }

  key(): string {
    const cached = BOARD_KEYS.get(this);
    if (cached) {
      return cached;
    }
    const key = Array.from(this.rows).join(',');
    BOARD_KEYS.set(this, key);
    return key;
  }

  private deepestWell(heights: readonly number[]): number {
    let deepest = 0;
    for (let x = 0; x < this.width; x += 1) {
      const left = x === 0 ? this.height : valueAt(heights, x - 1);
      const right = x === this.width - 1 ? this.height : valueAt(heights, x + 1);
      deepest = Math.max(deepest, Math.max(0, Math.min(left, right) - valueAt(heights, x)));
    }
    return deepest;
  }
}

function popCount(value: number): number {
  let count = 0;
  let remaining = value;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}

function rowAt(rows: Uint16Array, index: number): number {
  const row = rows[index];
  if (row === undefined) {
    throw new RangeError(`Board row ${index} is outside the board.`);
  }
  return row;
}

function valueAt(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`Array index ${index} is outside the board.`);
  }
  return value;
}
