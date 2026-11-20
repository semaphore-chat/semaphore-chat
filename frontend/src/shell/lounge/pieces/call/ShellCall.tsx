/**
 * The call-bar slot of the Lounge frame (design §3.5-3.6, §5): in a call, the call surface (when there is
 * video to offer or your own share) above the call bar; out of a call, the voice notice; otherwise nothing.
 * The kit's `CallStack` arranges them: the surface is bounded and scrolls, collapses to one line while the
 * on-screen keyboard is up, and the bar under it always keeps its whole row.
 *
 * Everything comes from the data layer both shells read: `useCallBarModel` (the classic voice bar renders
 * from it too), `useVoiceNotice` (the classic `VoiceNotice`) and `useCallVideo` (the classic watch state and
 * watch functions). Nothing here changes the call by itself: no effect, timer or subscription of its own
 * beyond reading the room's events while mounted.
 */
import { lazy, Suspense, type JSX } from 'react';
import { CallStack, useWidthRange } from '../../../../kit';
import { useCallBarModel } from '../../../../data/callBar';
import { useVoiceNotice } from '../../../../data/voiceNotice';
import { useCallVideo } from '../../../../data/callVideo';
import { useTouchFirst } from '../../../../data/touchFirst';
import { CallBar } from './CallBar';
import { VoiceNoticeBar } from './VoiceNoticeBar';
import { CallSurfaceSummary } from './CallSurfaceSummary';

/** Its own chunk: loaded only while the call has video to offer (or you share). */
const CallSurface = lazy(() => import('../../call/surface/CallSurface'));

export function ShellCall(): JSX.Element | null {
  const range = useWidthRange();
  const touch = useTouchFirst(range);
  const model = useCallBarModel(touch);
  const notice = useVoiceNotice();
  const video = useCallVideo();

  if (model) {
    const showSurface =
      model.phase !== 'connecting' && video !== null && (video.tiles.length > 0 || model.sharingScreen);
    // Always the same tree in a call, so the bar (and a hold running on its mic) is never remounted when the
    // surface comes or goes.
    return (
      <CallStack
        bar={<CallBar model={model} />}
        surface={
          showSurface ? (
            <Suspense fallback={null}>
              <CallSurface
                tiles={video.tiles}
                sharingScreen={model.sharingScreen}
                onWatch={video.watch}
                onStopWatching={video.stopWatching}
                onStopSharing={model.actions.stopSharing}
                onOpenCallView={model.actions.openCallView}
              />
            </Suspense>
          ) : undefined
        }
        summary={showSurface ? <CallSurfaceSummary tiles={video.tiles} sharingScreen={model.sharingScreen} onStopSharing={model.actions.stopSharing} /> : undefined}
      />
    );
  }
  if (notice && !notice.joining) return <VoiceNoticeBar notice={notice} />;
  return null;
}
