export const PIECES = ['i', 'j', 'l', 'o', 's', 't', 'z'] as const;

export type Piece = (typeof PIECES)[number];
export type Cell = readonly [x: number, y: number];

export interface Shape {
  readonly cells: readonly Cell[];
  readonly width: number;
  readonly height: number;
}

type RotationCells = readonly Cell[];

function shape(cells: RotationCells): Shape {
  const width = Math.max(...cells.map(([x]) => x)) + 1;
  const height = Math.max(...cells.map(([, y]) => y)) + 1;
  return { cells, width, height };
}

function rotations(...all: readonly RotationCells[]): readonly Shape[] {
  return all.map(shape);
}

/**
 * Coordinate origin is the lower-left corner. These normalized shapes are used by
 * the offline search; live moves are validated against Triangle's actual SRS engine.
 */
export const SHAPES: Record<Piece, readonly Shape[]> = {
  i: rotations(
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
  ),
  j: rotations(
    [
      [0, 1],
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [2, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
    ],
  ),
  l: rotations(
    [
      [2, 1],
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 0],
    ],
    [
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  ),
  o: rotations([
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]),
  s: rotations(
    [
      [1, 1],
      [2, 1],
      [0, 0],
      [1, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
  ),
  t: rotations(
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 1],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 0],
    ],
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  ),
  z: rotations(
    [
      [0, 1],
      [1, 1],
      [1, 0],
      [2, 0],
    ],
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 2],
    ],
  ),
};

export function isPiece(value: string): value is Piece {
  return (PIECES as readonly string[]).includes(value);
}
