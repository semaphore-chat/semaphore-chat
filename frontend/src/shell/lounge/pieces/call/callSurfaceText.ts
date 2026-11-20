/**
 * The words of the call surface (pure, no LiveKit): a tile's label, the summary of what is offered beyond the
 * rows shown, and the one line that stands in for the whole surface while the on-screen keyboard is up.
 */
import type { CallVideoTile } from '../../../../data/callVideo';

type TileWords = Pick<CallVideoTile, 'name' | 'kind'>;

/** How many unwatched shares and cameras get a row of their own; past that, a summary row comes first. */
export const OFFERED_ROWS = 3;

export function tileLabel(tile: TileWords): string {
  return tile.kind === 'screen' ? `${tile.name}'s screen` : tile.name;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "2 screens shared · 8 cameras on": what is published, by kind (shares first). Empty for none. */
export function offeredSummary(tiles: readonly TileWords[]): string {
  const screens = tiles.filter((tile) => tile.kind === 'screen').length;
  const cameras = tiles.length - screens;
  const parts: string[] = [];
  if (screens > 0) parts.push(`${plural(screens, 'screen', 'screens')} shared`);
  if (cameras > 0) parts.push(`${plural(cameras, 'camera', 'cameras')} on`);
  return parts.join(' · ');
}

/**
 * The surface in one line, for while the keyboard is up: what you watch, what else is offered, your own share.
 * "Watching dropbear's screen · 1 camera on", "2 screens shared", "You're sharing your screen".
 */
export function surfaceSummary(tiles: readonly (TileWords & Pick<CallVideoTile, 'watched'>)[], sharingScreen: boolean): string {
  const watched = tiles.filter((tile) => tile.watched);
  const offered = tiles.filter((tile) => !tile.watched);
  const parts: string[] = [];
  if (watched.length === 1) parts.push(`Watching ${tileLabel(watched[0])}`);
  else if (watched.length > 1) parts.push(`Watching ${watched.length}`);
  const rest = offeredSummary(offered);
  if (rest !== '') parts.push(rest);
  if (sharingScreen) parts.push(parts.length === 0 ? "You're sharing your screen" : "You're sharing");
  return parts.join(' · ');
}
