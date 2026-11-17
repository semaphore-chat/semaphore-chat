import { delay, http, HttpResponse } from 'msw';
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
          imageSrc="https://pictures.story.example/banner.svg"
          iconSrc="https://pictures.story.example/icon.svg"
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
          <LinkCard href="https://slow.example/" site="slow.example" title="Its picture never arrives" imageSrc="https://slow.story.example/banner.png" />
          <LinkCard href="https://broken.example/" site="broken.example" title="Broken picture and icon" imageSrc="https://broken.story.example/b.png" iconSrc="https://broken.story.example/f.ico" />
          <LinkCard href="https://bank.example@evil.example/" site="bank.example" title="Drawn, but not a link" />
        </Stack>
      }
    />
  </ChatColumn>
);

/** The cards' pictures, from "other sites" served here (a link card draws only http(s) pictures, so no data URLs). */
const pictures = [
  http.get('https://pictures.story.example/banner.svg', () =>
    new HttpResponse(decodeURIComponent(picture(1200, 630, '#6FB1F5').split(',')[1]), { headers: { 'Content-Type': 'image/svg+xml' } }),
  ),
  http.get('https://pictures.story.example/icon.svg', () =>
    new HttpResponse(decodeURIComponent(picture(32, 32, '#FFA366').split(',')[1]), { headers: { 'Content-Type': 'image/svg+xml' } }),
  ),
  http.get('https://slow.story.example/*', async () => {
    await delay('infinite');
    return new HttpResponse(null);
  }),
  http.get('https://broken.story.example/*', () => new HttpResponse(null, { status: 404 })),
];

/** Cards with and without a picture, long text, a broken picture, a refused address. */
export const States = () => (
  <OnPalette palette={PALETTES[0]}>
    <Cards />
  </OnPalette>
);

States.msw = pictures;

export const StatesLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Cards />
  </OnPalette>
);

StatesLight.msw = pictures;

export const StatesTinted = () => (
  <OnPalette palette={PALETTES[2]}>
    <Cards />
  </OnPalette>
);

StatesTinted.msw = pictures;
