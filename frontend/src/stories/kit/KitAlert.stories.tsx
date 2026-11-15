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

const CallAlerts = () => (
  <div style={stack}>
    <Alert
      severity="info"
      title="Incoming call"
      action={{ label: 'Join', onClick: noop }}
      secondaryAction={{ label: 'Decline', onClick: noop }}
    >
      dropbear is calling you in Squad Up.
    </Alert>
    <Alert severity="warning" secondaryAction={{ label: 'Not now', onClick: noop }} onClose={noop}>
      A new version is ready.
    </Alert>
    <Alert severity="danger" action={{ label: 'Retry', onClick: noop }} secondaryAction={{ label: 'Dismiss for today', onClick: noop }}>
      We could not reach Hangout.
    </Alert>
  </div>
);

/** Two actions (Join, Decline), a secondary action alone beside a close button, and two in other severities. */
export const SecondaryAction = () => (
  <KitStage mode="dark">
    <CallAlerts />
  </KitStage>
);

export const SecondaryActionLight = () => (
  <KitStage mode="light">
    <CallAlerts />
  </KitStage>
);

/** Long labels in a 260 px box: the buttons wrap onto a second line, nothing overflows. */
export const SecondaryActionLong = () => (
  <KitStage mode="dark">
    <div style={{ ...stack, width: 260 }}>
      <Alert
        severity="info"
        title="Incoming call"
        action={{ label: 'Join the call in Squad Up', onClick: noop }}
        secondaryAction={{ label: 'Decline and let dropbear know', onClick: noop }}
      >
        dropbear is calling you.
      </Alert>
    </div>
  </KitStage>
);

/** One action whose label is longer than the row: cut with an ellipsis inside the alert. */
export const SecondaryActionOneLong = () => (
  <KitStage mode="dark">
    <div style={{ ...stack, width: 220 }}>
      <Alert severity="warning" action={{ label: 'Join the call in Squad Up with dropbear and pri', onClick: noop }}>
        dropbear is calling you.
      </Alert>
    </div>
  </KitStage>
);

