import React, { useCallback } from "react";
import { Alert, AlertTitle, Button, IconButton } from "@mui/material";
import { Close } from "@mui/icons-material";
import { TOUCH_TARGETS } from "../../utils/breakpoints";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useVoiceDispatch, VoiceActionType } from "../../contexts/VoiceContext";
import { logger } from "../../utils/logger";
import { describeVoiceNotice } from "./voiceNoticeModel";

/**
 * The one place voice failures are shown: a failed join (what went wrong and
 * what to do, with Retry when it can help) or why a call ended (another
 * device, removed, access lost, reconnect failed...). Dismissible; replaced by
 * the next notice instead of stacking toasts.
 *
 * Rendered by the always-mounted VoiceBottomBar shell, so no livekit-client
 * imports here (see features/voice/livekitEvents.ts).
 */
/** Full-size touch targets on phones and tablets, compact on desktop. */
const touchTarget = {
  minWidth: { xs: TOUCH_TARGETS.MINIMUM, md: "auto" },
  minHeight: { xs: TOUCH_TARGETS.MINIMUM, md: "auto" },
};

export const VoiceNotice: React.FC = () => {
  const { state, actions } = useVoiceConnection();
  const { dispatch } = useVoiceDispatch();
  const notice = describeVoiceNotice(state);

  const dismiss = useCallback(() => {
    dispatch({ type: VoiceActionType.ClearVoiceNotice });
  }, [dispatch]);

  const retryTarget = notice?.retryTarget ?? null;
  const retry = useCallback(async () => {
    if (!retryTarget) return;
    try {
      if (retryTarget.type === "dm") {
        await actions.joinDmVoice(retryTarget.dmGroupId, retryTarget.dmGroupName);
      } else {
        await actions.joinVoiceChannel(
          retryTarget.channelId,
          retryTarget.channelName,
          retryTarget.communityId,
          retryTarget.isPrivate,
          retryTarget.createdAt,
        );
      }
    } catch (error) {
      // A new failure replaces this notice.
      logger.warn("[Voice] Retry failed:", error);
    }
  }, [actions, retryTarget]);

  if (!notice) return null;

  return (
    <Alert
      key={notice.id}
      severity={notice.severity}
      variant="outlined"
      data-testid="voice-notice"
      // Alert drops its own close button when `action` is set, so both live here.
      action={
        <>
          {retryTarget && (
            <Button color="inherit" size="small" onClick={retry} disabled={state.isConnecting} sx={touchTarget}>
              Retry
            </Button>
          )}
          <IconButton aria-label="Close" color="inherit" size="small" onClick={dismiss} sx={touchTarget}>
            <Close fontSize="small" />
          </IconButton>
        </>
      }
      sx={{
        bgcolor: "background.paper",
        boxShadow: 4,
        width: "100%",
        maxWidth: 640,
        pointerEvents: "auto",
        alignItems: "flex-start",
        "& .MuiAlert-action": { alignItems: "center", pt: 0.5 },
      }}
    >
      <AlertTitle sx={{ mb: 0.25 }}>{notice.title}</AlertTitle>
      {notice.message}
    </Alert>
  );
};

export default VoiceNotice;
