import { AttachmentTile, MessageRow, MessageText, Stack } from '../../kit';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, noop, text } from './kitChatData';

/** A picture as a data URL, so stories need no network. */
const picture = (w: number, h: number, fill: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#121214"/></svg>`,
  );

const Body = () => (
  <ChatColumn width={390}>
    <MessageRow
      author="aiko"
      avatarColour="#FF8FB8"
      time="8:19 PM"
      body={<MessageText segments={text('a wide picture, shrunk to fit its box')} />}
      attachments={<AttachmentTile kind="image" name="sunset.png" src={picture(1600, 900, '#FFA366')} width={1600} height={900} onOpen={noop} />}
    />
    <MessageRow
      author="aiko"
      avatarColour="#FF8FB8"
      time="8:20 PM"
      continued
      body={<MessageText segments={text('a tall one, and one still loading (its box is already the right size)')} />}
      attachments={
        <Stack direction="row" gap="sm">
          <AttachmentTile kind="image" name="tall.png" src={picture(600, 1200, '#6FB1F5')} width={600} height={1200} onOpen={noop} />
          <AttachmentTile kind="image" name="loading.png" width={600} height={1200} onOpen={noop} />
        </Stack>
      }
    />
    <MessageRow
      author="dropbear"
      avatarColour="#5FD49A"
      time="8:21 PM"
      body={<MessageText segments={text('size unknown, a broken picture, and opening')} />}
      attachments={
        <Stack gap="sm">
          <AttachmentTile kind="image" name="no-size.jpg" src={picture(300, 300, '#5FD49A')} onOpen={noop} />
          <AttachmentTile kind="image" name="broken-picture-with-a-long-name.webp" src="data:image/png;base64,broken" width={400} height={300} onOpen={noop} />
          <AttachmentTile kind="image" name="opening.png" src={picture(400, 300, '#FF8FB8')} width={400} height={300} onOpen={noop} busy />
        </Stack>
      }
    />
    <MessageRow
      author="kwam3"
      avatarColour="#6FB1F5"
      time="8:21 PM"
      body={<MessageText segments={text('extreme shapes: a 4000×10 strip and a 10×4000 pole, letterboxed in boxes no side under 48 px')} />}
      attachments={
        <Stack gap="sm" align="start">
          <AttachmentTile kind="image" name="strip.png" src={picture(4000, 10, '#FFA366')} width={4000} height={10} onOpen={noop} />
          <AttachmentTile kind="image" name="pole.png" src={picture(10, 4000, '#5FD49A')} width={10} height={4000} onOpen={noop} />
        </Stack>
      }
    />
    <MessageRow
      author="gracie"
      avatarColour="#FFA366"
      time="8:22 PM"
      body={<MessageText segments={text('files: a short one, a long name, one downloading')} />}
      attachments={
        <Stack gap="sm">
          <AttachmentTile kind="file" name="notes.txt" detail="2.1 KB" onOpen={noop} />
          <AttachmentTile kind="file" name="a-very-long-recording-name-from-last-night-that-will-not-fit.mp3" detail="38.4 MB" onOpen={noop} />
          <AttachmentTile kind="file" name="clip.mp4" detail="120 MB" onOpen={noop} busy />
        </Stack>
      }
    />
    <MessageRow
      author="me"
      avatarColour="#8E75FF"
      time="8:23 PM"
      state="pending"
      body={<MessageText segments={text('on its way: uploading, failed with Retry, a picture uploading')} />}
      attachments={
        <Stack gap="sm">
          <AttachmentTile kind="file" name="recording.mp3" detail="38.4 MB" progress={42} onRemove={noop} />
          <AttachmentTile kind="file" name="too-big.zip" detail="2 GB" error="Upload failed: File too large" onRetry={noop} onRemove={noop} />
          <AttachmentTile kind="file" name="sunset.png" detail="1.2 MB" src={picture(1600, 900, '#FFA366')} progress={90} />
        </Stack>
      }
    />
  </ChatColumn>
);

/** Queued in the composer's tray: not pressable, a thumbnail for a picture, Remove, a long name. */
const Tray = () => (
  <ChatColumn width={390}>
    <Stack gap="sm">
      <AttachmentTile kind="file" name="notes.txt" detail="2.1 KB" onRemove={noop} />
      <AttachmentTile kind="file" name="sunset.png" detail="1.2 MB" src={picture(1600, 900, '#FFA366')} onRemove={noop} />
      <AttachmentTile kind="file" name="a-very-long-file-name-that-has-to-give-way-at-phone-width.pdf" detail="4 MB" onRemove={noop} />
    </Stack>
  </ChatColumn>
);

export const Queued = () => (
  <OnPalette palette={PALETTES[0]}>
    <Tray />
  </OnPalette>
);

export const QueuedLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Tray />
  </OnPalette>
);

/** Images in boxes sized before they load, unknown size, broken, busy, extreme shapes; files with long names. */
export const States = () => (
  <OnPalette palette={PALETTES[0]}>
    <Body />
  </OnPalette>
);

export const StatesLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Body />
  </OnPalette>
);

export const StatesTinted = () => (
  <OnPalette palette={PALETTES[2]}>
    <Body />
  </OnPalette>
);
