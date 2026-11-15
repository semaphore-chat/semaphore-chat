import { Toast, type ToastTone } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const TONES: ToastTone[] = ['neutral', 'positive', 'danger'];
const noop = () => undefined;
const stack = { display: 'flex', flexDirection: 'column', gap: tokens.space.md, alignItems: 'flex-start' } as const;

const Grid = () => (
  <>
    <Row label="Message only">
      <div style={stack}>
        {TONES.map((tone) => (
          <Toast key={tone} tone={tone} message={`A ${tone} notice`} />
        ))}
      </div>
    </Row>
    <Row label="Action and close">
      <div style={stack}>
        {TONES.map((tone) => (
          <Toast
            key={tone}
            tone={tone}
            message={`A ${tone} notice`}
            action={{ label: 'Undo', onClick: noop }}
            onClose={noop}
          />
        ))}
      </div>
    </Row>
  </>
);

export const Tones = () => (
  <KitStage mode="dark">
    <Grid />
  </KitStage>
);

export const TonesLight = () => (
  <KitStage mode="light">
    <Grid />
  </KitStage>
);

export const TonesTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <Grid />
  </KitStage>
);

/** A long message and an unbroken token in a 320 px box: wraps, the action and close stay in view. */
export const LongMessage = () => (
  <KitStage mode="dark">
    <div style={{ width: 320 }}>
      <Toast
        tone="danger"
        message="Could not send your message to the channel because the connection dropped: https://example.com/a/very/long/path/that/never/ends"
        action={{ label: 'Retry', onClick: noop }}
        onClose={noop}
      />
    </div>
  </KitStage>
);
