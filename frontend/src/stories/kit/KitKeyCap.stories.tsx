import { KeyCap } from '../../kit';
import { KitStage, Row } from '../fixtures/kitStory';

const Keys_ = () => (
  <>
    <Row label="single keys">
      <KeyCap>Esc</KeyCap>
      <KeyCap>K</KeyCap>
      <KeyCap>Enter</KeyCap>
    </Row>
    <Row label="a pair">
      <span style={{ display: 'inline-flex', gap: 8 }}>
        <KeyCap>Ctrl</KeyCap>
        <KeyCap>K</KeyCap>
      </span>
    </Row>
  </>
);

/** Single keys and a Ctrl K pair, dark mode. */
export const Keys = () => (
  <KitStage mode="dark">
    <Keys_ />
  </KitStage>
);

/** The same in light mode. */
export const KeysLight = () => (
  <KitStage mode="light">
    <Keys_ />
  </KitStage>
);
