/**
 * The OKLCH colour maths live in `@semaphore-chat/shared` (the backend needs
 * them for `nearestAccent`); re-exported here so `derivePalette` and the tests
 * keep importing them from this path.
 */

export { contrastRatio, parseHex, toOklch, toRgb } from '@semaphore-chat/shared';
