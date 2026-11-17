import { LinkCard, MessageRow, MessageText, Stack } from '../../kit';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, text } from './kitChatData';

/** A picture as a data URL, so stories need no network. */
const picture = (w: number, h: number, fill: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#121214"/></svg>`,
  );

const Cards = () => (
  <ChatColumn width={390}>
    <MessageRow
      author="aiko"
      avatarColour="#FF8FB8"
      time="8:19 PM"
      body={<MessageText segments={text('https://trailheads.example/routes/ridge-loop')} />}
      attachments={
        <LinkCard
          href="https://trailheads.example/routes/ridge-loop"
          site="Trailheads · Aiko Tanaka"
          title="The ridge loop, in late autumn"
          description="Eleven kilometres, one steep climb and the best view of the valley before the snow comes in."
          imageSrc={picture(1200, 630, '#6FB1F5')}
          iconSrc={picture(32, 32, '#FFA366')}
        />
      }
    />
    <MessageRow
      author="dropbear"
      avatarColour="#5FD49A"
      time="8:20 PM"
      body={<MessageText segments={text('no picture, no icon; a long title and summary cut at two lines')} />}
      attachments={
        <Stack gap="sm" align="start">
          <LinkCard
            href="https://news.example.org/a"
            site="news.example.org"
            title="A very long title that keeps going well past the second line so it has to give way with an ellipsis at phone width"
            description="And a summary that is just as long, written to show that it also stops after two lines however much the page says about itself."
          />
          <LinkCard href="https://example.com/" site="example.com" />
        </Stack>
      }
    />
    <MessageRow
      author="kwam3"
      avatarColour="#6FB1F5"
      time="8:21 PM"
      body={<MessageText segments={text('a picture that is still loading, one that failed, and an address the kit will not open')} />}
      attachments={
        <Stack gap="sm" align="start">
          <LinkCard href="https://slow.example/" site="slow.example" title="Its picture never arrives" imageSrc="data:image/png;base64," />
          <LinkCard href="https://broken.example/" site="broken.example" title="Broken picture and icon" imageSrc="data:image/png;base64,broken" iconSrc="data:image/png;base64,broken" />
          <LinkCard href="https://bank.example@evil.example/" site="bank.example" title="Drawn, but not a link" />
        </Stack>
      }
    />
  </ChatColumn>
);

/** Cards with and without a picture, long text, a broken picture, a refused address. */
export const States = () => (
  <OnPalette palette={PALETTES[0]}>
    <Cards />
  </OnPalette>
);

export const StatesLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Cards />
  </OnPalette>
);

export const StatesTinted = () => (
  <OnPalette palette={PALETTES[2]}>
    <Cards />
  </OnPalette>
);
