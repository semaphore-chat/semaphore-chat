import { Alert, type AlertSeverity } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const SEVERITIES: AlertSeverity[] = ['info', 'success', 'warning', 'danger'];
const noop = () => undefined;
const stack = { display: 'flex', flexDirection: 'column', gap: tokens.space.md, width: '100%' } as const;

const SeveritiesGrid = () => (
  <>
    <Row label="Title and body">
      <div style={stack}>
        {SEVERITIES.map((severity) => (
          <Alert key={severity} severity={severity} title={`A ${severity} title`}>
            Something worth knowing happened in this community.
          </Alert>
        ))}
      </div>
    </Row>
    <Row label="Body only">
      <div style={stack}>
        {SEVERITIES.map((severity) => (
          <Alert key={severity} severity={severity}>
            Something worth knowing happened in this community.
          </Alert>
        ))}
      </div>
    </Row>
  </>
);

export const Severities = () => (
  <KitStage mode="dark">
    <SeveritiesGrid />
  </KitStage>
);

export const SeveritiesLight = () => (
  <KitStage mode="light">
    <SeveritiesGrid />
  </KitStage>
);

export const SeveritiesTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <SeveritiesGrid />
  </KitStage>
);

/** An action, a close button, and both. */
export const WithActions = () => (
  <KitStage mode="dark">
    <div style={stack}>
      <Alert severity="warning" title="Connection lost" action={{ label: 'Reconnect', onClick: noop }}>
        We could not reach the voice server.
      </Alert>
      <Alert severity="info" onClose={noop}>
        A new version is available.
      </Alert>
      <Alert
        severity="danger"
        title="Upload failed"
        action={{ label: 'Try again', onClick: noop }}
        onClose={noop}
      >
        The file is larger than the community allows.
      </Alert>
    </div>
  </KitStage>
);

/** A long unbroken word and a long sentence in a 320 px box: wraps, the buttons stay in view. */
export const LongText = () => (
  <KitStage mode="dark">
    <div style={{ ...stack, width: 320 }}>
      <Alert
        severity="danger"
        title="A rather long title that has to wrap onto a second line"
        action={{ label: 'Try again', onClick: noop }}
        onClose={noop}
      >
        This message keeps going so that it wraps, with an unbroken token
        https://example.com/a/very/long/path/that/never/ends/and/never/breaks/at/all
      </Alert>
    </div>
  </KitStage>
);
