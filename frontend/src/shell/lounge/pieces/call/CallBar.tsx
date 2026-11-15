/**
 * The call bar (design §3.5, guide "Three islands" › The call bar): the strip that shows the call you are in,
 * in the frame's call slot. It renders the one call model both shells read (`data/callBar`), and every
 * control calls that model's action: the same function the classic voice bar calls for the same action.
 *
 * - Every width: the room, a state line, the mic (tap to mute; under push-to-talk the key's hint, and on a
 *   touch layout a hold-to-talk control), Open call view and Leave.
 * - Phone also has Deafen (PA-3); at compact and wide deafen is on the user card in the left island.
 * - Joining: the room and "Joining…" only, as the classic app offers nothing to press while a join runs.
 * - Reconnecting: a row with the attempt and Cancel above the rest.
 *
 * Not offered here (camera, starting a share, soundboard, replay, device settings, the debug panel): they
 * are on the classic call view ("Open call view") and in classic settings.
 */
import type { JSX, ReactNode } from 'react';
import { Button, Card, IconButton, ListRow, Spinner, type WidthRange } from '../../../../kit';
import type { CallBarModel } from '../../../../data/callBar';
import { callBarLine } from './callBarLine';

export interface CallBarProps {
  model: CallBarModel;
  width: WidthRange;
  /** Shown first inside the bar's card: the call surface, when there is video to offer. */
  above?: ReactNode;
}

/** The mic: tap to mute, or press and hold on a touch layout under push-to-talk. Disabled when it can do nothing. */
function MicControl({ model }: { model: CallBarModel }): JSX.Element {
  const { mic, actions } = model;
  // Shown live while the push-to-talk key (or a hold) transmits, even though the mic is otherwise off.
  const live = mic.on || mic.transmitting;
  if (mic.mode === 'holdToTalk' && !mic.blocked) {
    return (
      <IconButton
        icon={live ? 'Mic' : 'MicOff'}
        label={mic.label}
        title={mic.description ?? undefined}
        variant={mic.transmitting ? 'primary' : 'soft'}
        // Server-muted: a hold would transmit nothing (the model refuses it), so there is nothing to press.
        disabled={mic.serverMuted}
        hold={{
          onStart: () => {
            actions.holdStart();
          },
          onEnd: () => {
            actions.holdEnd();
          },
        }}
      />
    );
  }
  const canTap = mic.tappable && !mic.blocked;
  return (
    <IconButton
      icon={live ? 'Mic' : 'MicOff'}
      label={mic.label}
      title={mic.description ?? undefined}
      // The name stays "Mute"; pressed means muted (as the classic bar's aria-pressed).
      selected={!mic.on}
      disabled={!canTap}
      onClick={canTap ? actions.toggleMute : undefined}
    />
  );
}

export function CallBar({ model, width, above }: CallBarProps): JSX.Element {
  const { place, phase, actions } = model;
  const line = callBarLine(model);
  const phone = width === 'phone';
  const joining = phase === 'connecting';

  // The arrangement is the kit's own: the Card stacks its children, a ListRow lays out the name, the line
  // and its trailing controls. No layout CSS here.
  return (
    <div role="region" aria-label={`Call in ${place.name}`} data-testid="lounge-call-bar">
      <Card padding="md">
        {above}
        {phase === 'reconnecting' && (
          <div role="status">
            <ListRow
              primary={`Reconnecting (${model.reconnectAttempt ?? 1})…`}
              leading={<Spinner size="sm" />}
              trailing={
                <Button variant="ghost" size="sm" onClick={actions.cancel}>
                  Cancel
                </Button>
              }
            />
          </div>
        )}
        <ListRow
          size="lg"
          // The kit's strong primary line (bold, full text colour): the room is the bar's title.
          unread
          primary={place.name}
          secondary={line.text}
          trailing={
            joining ? undefined : (
              <>
                <MicControl model={model} />
                {phone && (
                  <IconButton
                    icon={model.deafened ? 'HeadphoneOff' : 'Headphones'}
                    label="Deafen"
                    selected={model.deafened}
                    onClick={actions.toggleDeafen}
                  />
                )}
                {phone ? (
                  <Button variant="ghost" size="sm" aria-label="Open call view" onClick={actions.openCallView}>
                    Open
                  </Button>
                ) : (
                  <IconButton icon="Maximize" label="Open call view" onClick={actions.openCallView} />
                )}
                <IconButton icon="PhoneOff" label="Leave call" variant="danger" onClick={actions.leave} />
              </>
            )
          }
        />
      </Card>
    </div>
  );
}
