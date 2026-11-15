/**
 * The call bar (design §3.5, guide "Three islands" › The call bar): the strip that shows the call you are in,
 * in the frame's call slot. It renders the one call model both shells read (`data/callBar`), and every
 * control calls that model's action: the same function the classic voice bar calls for the same action.
 *
 * - Every width: the room and its state line, which together are the Open call view control; the mic (tap to
 *   mute; under push-to-talk the key's hint, and on a touch layout a hold-to-talk control), Deafen and Leave.
 *   Nobody is ever deafened without a control on screen to undeafen.
 * - A mic that can do nothing (blocked, muted by a moderator, the push-to-talk key) stays focusable and named,
 *   reads as unavailable, and says why when pressed. The reason is also the state line, in full.
 * - Joining: the room and "Joining…" only, as the classic app offers nothing to press while a join runs.
 * - Reconnecting: a row with the attempt and Cancel above the rest, and no "connected" line.
 *
 * Not offered here (camera, starting a share, soundboard, replay, device settings, the debug panel): they
 * are on the classic call view ("Open call view") and in classic settings.
 */
import type { JSX } from 'react';
import { Button, Card, IconButton, ListRow, Spinner, Stack, Text, useAnnounce } from '../../../../kit';
import type { CallBarModel } from '../../../../data/callBar';
import { callBarLine, micUnavailableReason } from './callBarLine';

export interface CallBarProps {
  model: CallBarModel;
}

/** The mic: tap to mute, or press and hold on a touch layout under push-to-talk. Unavailable when it can do nothing. */
function MicControl({ model }: { model: CallBarModel }): JSX.Element {
  const { mic, actions } = model;
  const announce = useAnnounce();
  const reason = micUnavailableReason(model);
  const sayWhy = reason === null ? undefined : () => announce(reason);
  // Shown live while the push-to-talk key (or a hold) transmits, even though the mic is otherwise off.
  const live = mic.on || mic.transmitting;
  if (mic.mode === 'holdToTalk' && !mic.blocked) {
    return (
      <IconButton
        icon={live ? 'Mic' : 'MicOff'}
        label={mic.label}
        title={mic.description ?? undefined}
        variant={mic.transmitting ? 'primary' : 'soft'}
        // Server-muted: a hold would transmit nothing (the model refuses it), so pressing only says why.
        aria-disabled={reason !== null}
        onUnavailablePress={sayWhy}
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
  return (
    <IconButton
      icon={live ? 'Mic' : 'MicOff'}
      label={mic.label}
      title={mic.description ?? undefined}
      // The name stays "Mute"; pressed means muted (as the classic bar's aria-pressed).
      selected={!mic.on}
      aria-disabled={reason !== null}
      onUnavailablePress={sayWhy}
      onClick={reason === null ? actions.toggleMute : undefined}
    />
  );
}

export function CallBar({ model }: CallBarProps): JSX.Element {
  const { place, phase, actions } = model;
  const line = callBarLine(model);
  const joining = phase === 'connecting';

  const row = (
    <ListRow
      size="lg"
      // The kit's strong primary line (bold, full text colour): the room is the bar's title.
      unread
      primary={place.name}
      secondary={line !== null && !line.full ? line.text : undefined}
      // The room (with its line) is the Open call view control at every width: the kit's pressable row (hover,
      // pressed and focus states over the whole row). Nothing to press while joining.
      onClick={joining ? undefined : actions.openCallView}
      label={joining ? undefined : `Open call view, ${place.name}`}
      trailing={
        joining ? undefined : (
          <>
            <MicControl model={model} />
            <IconButton
              icon={model.deafened ? 'HeadphoneOff' : 'Headphones'}
              label="Deafen"
              selected={model.deafened}
              onClick={actions.toggleDeafen}
            />
            <IconButton icon="PhoneOff" label="Leave call" variant="danger" onClick={actions.leave} />
          </>
        )
      }
    />
  );

  // The arrangement is the kit's own: the Card stacks its children, a ListRow lays out the name, the line
  // and its trailing controls, and a line that must be read in full sits under them in a Stack. No layout CSS.
  return (
    <div role="region" aria-label={`Call in ${place.name}`} data-testid="lounge-call-bar">
      <Card padding="md">
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
        {line?.full ? (
          <Stack gap="xs">
            {row}
            <div data-testid="lounge-call-line">
              <Text variant="meta" tone={line.tone} as="p">
                {line.text}
              </Text>
            </div>
          </Stack>
        ) : (
          row
        )}
      </Card>
    </div>
  );
}
