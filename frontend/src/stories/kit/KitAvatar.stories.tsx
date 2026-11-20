import { Avatar, AvatarStack, type AvatarSize, type Presence as PresenceState } from '../../kit';
import { PEOPLE_COLOURS } from '../../kit/theme/personColour';
import { KitStage, Row } from '../fixtures/kitStory';

const SIZES: AvatarSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

/** People from the design sheet: name and their own colour. */
const PEOPLE = [
  { name: 'aiko', colour: '#FF8FB8' },
  { name: 'dropbear', colour: '#5FD49A' },
  { name: 'gracie', colour: '#FFA366' },
  { name: 'kwam3', colour: '#6FB1F5' },
  { name: 'pri', colour: '#C792F0' },
  { name: 'Samira', colour: '#5ED1D1' },
];

const PRESENCES: PresenceState[] = ['online', 'away', 'offline', 'speaking'];

const SizesBody = () => (
  <>
    <Row label="xs, sm, md, lg, xl: a colour each">
      {SIZES.map((size, index) => (
        <Avatar key={size} size={size} {...PEOPLE[index]} />
      ))}
    </Row>
    <Row label="md: six people colours">
      {PEOPLE.map((person) => (
        <Avatar key={person.name} {...person} />
      ))}
    </Row>
    <Row label="No colour: fill and secondary initials">
      {SIZES.map((size) => (
        <Avatar key={size} size={size} name="Alex Kim" />
      ))}
    </Row>
  </>
);

/** Five sizes, six person colours, and no colour. */
export const Sizes = () => (
  <KitStage mode="dark">
    <SizesBody />
  </KitStage>
);

/** Online, away, offline and speaking, at md and lg. */
export const Presence = () => (
  <KitStage mode="dark">
    {(['md', 'lg'] as const).map((size) => (
      <Row key={size} label={size}>
        {PRESENCES.map((presence, index) => (
          <Avatar key={presence} size={size} presence={presence} {...PEOPLE[index]} />
        ))}
      </Row>
    ))}
  </KitStage>
);

/** Communities: rounded squares in five sizes. */
export const Communities = () => (
  <KitStage mode="dark">
    <Row label="Couch Co-op, rounded">
      {SIZES.map((size) => (
        <Avatar key={size} size={size} shape="rounded" name="Couch Co-op" colour="#FF9A6B" />
      ))}
    </Row>
    <Row label="No colour">
      {SIZES.map((size) => (
        <Avatar key={size} size={size} shape="rounded" name="Couch Co-op" />
      ))}
    </Row>
  </KitStage>
);

/** A broken image, an empty name, one word, a long name, an emoji, non-Latin letters. */
export const Fallbacks = () => (
  <KitStage mode="dark">
    <Row label="Broken image (initials show)">
      <Avatar name="aiko" colour="#FF8FB8" src="/this-image-does-not-exist.png" />
      <Avatar name="Couch Co-op" shape="rounded" colour="#FF9A6B" src="/this-image-does-not-exist.png" size="xl" />
    </Row>
    <Row label="Empty name (icon)">
      <Avatar name="" />
      <Avatar name="" colour="#6FB1F5" size="lg" />
    </Row>
    <Row label="One word, many words, long">
      <Avatar name="dropbear" colour="#5FD49A" />
      <Avatar name="Mary Jane Watson-Parker" colour="#C792F0" />
      <Avatar name="Pneumonoultramicroscopicsilicovolcanoconiosis" colour="#FFA366" />
    </Row>
    <Row label="Emoji and non-Latin">
      <Avatar name="🎉" colour="#FF8FB8" />
      <Avatar name="Ünal çelik" colour="#5ED1D1" />
      <Avatar name="日本語の名前" colour="#6FB1F5" />
    </Row>
  </KitStage>
);

/** A small logo on a transparent background: a white ring and a dot, no fill. */
const TRANSPARENT_LOGO =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><circle cx='20' cy='20' r='13' fill='none' stroke='%23ffffff' stroke-width='4'/><circle cx='20' cy='20' r='4' fill='%23ffffff'/></svg>";

/** An image with a transparent background: the initials must not show through it. */
export const TransparentImage = () => (
  <KitStage mode="dark">
    <Row label="On the community colour, then on no colour">
      <Avatar name="Couch Co-op" shape="rounded" colour="#FF9A6B" src={TRANSPARENT_LOGO} size="xl" />
      <Avatar name="Couch Co-op" shape="rounded" src={TRANSPARENT_LOGO} size="xl" />
      <Avatar name="Couch Co-op" colour="#6FB1F5" src={TRANSPARENT_LOGO} />
    </Row>
  </KitStage>
);

/** Stacks of people: five with the default max, two that all fit, and a big size. */
export const Stack = () => (
  <KitStage mode="dark">
    <Row label="Six people, max 3 (default)">
      <AvatarStack people={PEOPLE} />
    </Row>
    <Row label="Two people">
      <AvatarStack people={PEOPLE.slice(0, 2)} />
    </Row>
    <Row label="max 4 at md, max 2 at lg">
      <AvatarStack people={PEOPLE} max={4} size="md" />
      <AvatarStack people={PEOPLE} max={2} size="lg" />
    </Row>
  </KitStage>
);

/** The sizes in light mode. */
export const SizesLight = () => (
  <KitStage mode="light">
    <SizesBody />
    <Row label="Stack">
      <AvatarStack people={PEOPLE} />
    </Row>
  </KitStage>
);

/** Presence in the tinted palette (teal, vibrant). */
export const PresenceTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <Row label="md">
      {PRESENCES.map((presence, index) => (
        <Avatar key={presence} presence={presence} {...PEOPLE[index]} />
      ))}
    </Row>
    <Row label="Stack and no colour">
      <AvatarStack people={PEOPLE} />
      <Avatar name="Alex Kim" />
    </Row>
  </KitStage>
);

const CREW = [
  { name: 'dropbear', colour: '#5FD49A', speaking: true },
  { name: 'pri', colour: '#C792F0' },
  { name: 'aiko', colour: '#FF8FB8' },
  { name: 'kwam3', colour: '#6FB1F5', speaking: true },
];

const SpeakingBody = () => (
  <>
    <Row label="dropbear is talking">
      <AvatarStack people={CREW.slice(0, 3)} />
    </Row>
    <Row label="Two talking, one behind the +N (max 3)">
      <AvatarStack people={CREW} />
    </Row>
    <Row label="The four, max 4, at xs, sm, md, lg and xl">
      {SIZES.map((size) => (
        <AvatarStack key={size} people={CREW} max={4} size={size} />
      ))}
    </Row>
  </>
);

/** A person who is talking wears the speaking ring in a stack, and the stack's name says so. */
export const StackSpeaking = () => (
  <KitStage mode="dark">
    <SpeakingBody />
  </KitStage>
);

export const StackSpeakingLight = () => (
  <KitStage mode="light">
    <SpeakingBody />
  </KitStage>
);

export const StackSpeakingTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <SpeakingBody />
  </KitStage>
);

/** Two-letter names, one per colour, so each face has initials. */
const NINE = ['Pi Nk', 'Or An', 'Ye Lo', 'Li Me', 'Gr Ee', 'Te Al', 'Bl Ue', 'In Di', 'Pu Rp'];

/**
 * The nine frozen people colours (`personColour`), in list order: plain, online, away, offline and
 * speaking, at md and lg, and a speaking stack. Green, lime and teal sit next to the green online
 * dot and speaking ring.
 */
const PeopleColoursBody = () => (
  <>
    {(['md', 'lg'] as const).map((size) => (
      <Row key={size} label={`${size}: the nine colours, in list order`}>
        {PEOPLE_COLOURS.map((colour, index) => (
          <Avatar key={colour} size={size} name={NINE[index]} colour={colour} />
        ))}
      </Row>
    ))}
    {PRESENCES.map((presence) => (
      <Row key={presence} label={presence}>
        {PEOPLE_COLOURS.map((colour, index) => (
          <Avatar key={colour} name={NINE[index]} colour={colour} presence={presence} />
        ))}
      </Row>
    ))}
    <Row label="Stacks: green, lime and teal talking">
      <AvatarStack
        max={4}
        people={[3, 4, 5, 6].map((index) => ({ name: NINE[index], colour: PEOPLE_COLOURS[index], speaking: index !== 6 }))}
      />
      <AvatarStack people={PEOPLE_COLOURS.map((colour, index) => ({ name: NINE[index], colour }))} />
    </Row>
  </>
);

/** Every person colour with each presence, dark. */
export const PeopleColours = () => (
  <KitStage mode="dark">
    <PeopleColoursBody />
  </KitStage>
);

export const PeopleColoursLight = () => (
  <KitStage mode="light">
    <PeopleColoursBody />
  </KitStage>
);

export const PeopleColoursTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <PeopleColoursBody />
  </KitStage>
);
