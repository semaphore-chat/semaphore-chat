import { useParams } from "react-router-dom";
import { Channel as ChannelType } from "../../types/channel.type";
import { useResponsive } from "../../hooks/useResponsive";
import { ChannelRow } from "./ChannelRow";

interface ChannelProps {
  channel: ChannelType;
}

/**
 * Desktop sidebar channel entry: the shared `ChannelRow`, selected from the
 * route, with touch sizing on touch devices (never in Electron).
 */
export function Channel({ channel }: ChannelProps) {
  const { communityId, channelId } = useParams<{
    communityId: string;
    channelId: string;
  }>();
  const { shouldUseTouchUI } = useResponsive();

  return (
    <ChannelRow
      channel={channel}
      communityId={communityId ?? channel.communityId}
      selected={channelId === channel.id}
      variant={shouldUseTouchUI ? "touch" : "desktop"}
    />
  );
}
