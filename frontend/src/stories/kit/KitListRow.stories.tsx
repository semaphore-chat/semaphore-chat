import { Avatar, Badge, Icon, IconButton, Island, ListRow, Pill } from '../../kit';
import { KitStage, Row } from '../fixtures/kitStory';

const noop = () => undefined;
const hash = <Icon name="Hash" />;

const StatesBody = () => (
  <>
    <Row label="Channel rows: default, selected, unread, muted, disabled">
      <div style={{ width: 288, maxWidth: '100%' }}><Island padding="md">
        <ListRow primary="lfg" leading={hash} onClick={noop} />
        <ListRow primary="general" leading={hash} selected href="#general" />
        <ListRow primary="clips" leading={hash} unread onClick={noop} trailing={<Badge count={2} tone="accent" label="2 unread" />} />
        <ListRow primary="old-news" leading={hash} muted onClick={noop} />
        <ListRow primary="staff" leading={<Icon name="Lock" />} disabled onClick={noop} />
        <ListRow primary="Plain content, no action" leading={hash} />
      </Island></div>
    </Row>
    <Row label="With an avatar, secondary line and trailing pill">
      <div style={{ width: 288, maxWidth: '100%' }}><Island padding="md">
        <ListRow size="lg" primary="aiko" secondary="Playing Hades" leading={<Avatar decorative name="aiko" colour="#FF8FB8" presence="online" />} onClick={noop} />
        <ListRow size="lg" primary="gracie" secondary="Away" selected leading={<Avatar decorative name="gracie" colour="#FFA366" presence="away" />} onClick={noop} />
        <ListRow size="lg" primary="Diego" secondary="Offline" muted leading={<Avatar decorative name="Diego" presence="offline" />} onClick={noop} trailing={<Pill size="sm">Mod</Pill>} />
      </Island></div>
    </Row>
  </>
);

export const States = () => (
  <KitStage mode="dark">
    <StatesBody />
  </KitStage>
);

export const StatesLight = () => (
  <KitStage mode="light">
    <StatesBody />
  </KitStage>
);

export const StatesTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <StatesBody />
  </KitStage>
);

/** A channel list like the app's: Hash rows, unread badges, one selected. */
export const Channels = () => (
  <KitStage mode="dark">
    <div style={{ width: 288, maxWidth: '100%' }}><Island padding="md">
      <ListRow primary="general" leading={hash} selected href="#general" />
      <ListRow primary="lfg" leading={hash} unread href="#lfg" trailing={<Badge count={3} tone="accent" label="3 unread" />} />
      <ListRow primary="clips" leading={hash} unread href="#clips" trailing={<Badge count={120} tone="accent" label="120 unread" />} />
      <ListRow primary="memes" leading={hash} href="#memes" />
      <ListRow primary="Game night" leading={<Icon name="Volume2" />} href="#voice" trailing={<Badge dot tone="accent" label="Someone is talking" />} />
      <ListRow primary="afk" leading={<Icon name="Volume2" />} muted href="#afk" />
    </Island></div>
  </KitStage>
);

/** A member list: two-line rows, presence, a role pill or an action. */
export const People = () => (
  <KitStage mode="dark">
    <div style={{ width: 264, maxWidth: '100%' }}><Island padding="md">
      <ListRow size="lg" primary="Samira" secondary="Admin" leading={<Avatar decorative name="Samira" colour="#5ED1D1" presence="online" />} onClick={noop} trailing={<Pill size="sm" tone="accent">Admin</Pill>} />
      <ListRow size="lg" primary="dropbear" secondary="Streaming" leading={<Avatar decorative name="dropbear" colour="#5FD49A" presence="speaking" />} onClick={noop} trailing={<IconButton size="sm" icon="Ellipsis" label="More about dropbear" />} />
      <ListRow size="lg" primary="kwam3" secondary="Away" leading={<Avatar decorative name="kwam3" colour="#6FB1F5" presence="away" />} onClick={noop} />
      <ListRow size="lg" primary="pri" leading={<Avatar decorative name="pri" colour="#C792F0" presence="online" />} onClick={noop} />
      <ListRow size="lg" primary="zara" secondary="Offline" muted leading={<Avatar decorative name="zara" presence="offline" />} onClick={noop} />
    </Island></div>
  </KitStage>
);

const LONG = 'a-very-long-channel-name-that-goes-on-and-on-and-on-forever-ok';

/** A 60-character name in a 280 px box: an ellipsis, trailing slot kept. */
export const LongNames = () => (
  <KitStage mode="dark">
    <div style={{ width: 280, maxWidth: '100%' }}><Island padding="md">
      <ListRow primary={LONG} leading={hash} unread onClick={noop} trailing={<Badge count={7} tone="accent" label="7 unread" />} />
      <ListRow primary={LONG} leading={hash} selected onClick={noop} trailing={<IconButton size="sm" icon="Ellipsis" label="More" />} />
      <ListRow size="lg" primary={LONG} secondary={`${LONG} (secondary)`} leading={<Avatar decorative name="Long Name" colour="#FF8FB8" />} onClick={noop} trailing={<Pill size="sm">Mod</Pill>} />
    </Island></div>
  </KitStage>
);

/** A role written out in full in a 264 px members island: the pill cuts at half the row, the name keeps its room. */
export const LongTrailingPill = () => (
  <KitStage mode="dark">
    <div style={{ width: 264, maxWidth: '100%' }}><Island padding="md">
      <ListRow size="lg" primary="Samira" secondary="keeping the server warm" leading={<Avatar decorative name="Samira" presence="online" />} onClick={noop} trailing={<Pill size="sm">Server administrator</Pill>} />
      <ListRow size="lg" primary="dropbear" secondary="back at 9" leading={<Avatar decorative name="dropbear" presence="online" />} onClick={noop} trailing={<Pill size="sm">mod</Pill>} />
      <ListRow size="lg" primary="Samira-the-longest-username" secondary="keeping the server warm while everyone sleeps" leading={<Avatar decorative name="Samira" presence="online" />} onClick={noop} trailing={<Pill size="sm">Community moderator and events lead</Pill>} />
    </Island></div>
  </KitStage>
);

/**
 * The selected row is the solid accent pill: kit children in its slots switch to on-accent ink, so
 * an unread Badge, a Pill and a ghost IconButton stay visible and readable.
 */
export const SelectedWithTrailing = () => (
  <KitStage mode="dark">
    <div style={{ width: 288, maxWidth: '100%' }}><Island padding="md">
      <ListRow primary="general" leading={hash} selected href="#general" trailing={<Badge count={3} tone="accent" label="3 unread" />} />
      <ListRow primary="clips" leading={hash} selected unread href="#clips" trailing={<Badge count={12} label="12 unread" />} />
      <ListRow
        size="lg"
        primary="dropbear"
        secondary="Streaming"
        selected
        leading={<Avatar decorative name="dropbear" colour="#5FD49A" presence="speaking" />}
        onClick={noop}
        trailing={
          <>
            <Pill size="sm" tone="accent">Mod</Pill>
            <IconButton size="sm" icon="Ellipsis" label="More about dropbear" />
          </>
        }
      />
      <ListRow
        size="lg"
        primary="aiko"
        secondary="Playing Hades"
        selected
        leading={<Avatar decorative name="aiko" colour="#FF8FB8" presence="online" />}
        onClick={noop}
        trailing={<IconButton size="sm" variant="soft" icon="Pin" label="Pin aiko" />}
      />
    </Island></div>
  </KitStage>
);

export const SelectedWithTrailingLight = () => (
  <KitStage mode="light">
    <div style={{ width: 288, maxWidth: '100%' }}><Island padding="md">
      <ListRow primary="general" leading={hash} selected href="#general" trailing={<Badge count={3} tone="accent" label="3 unread" />} />
      <ListRow size="lg" primary="aiko" secondary="Playing Hades" selected leading={<Avatar decorative name="aiko" colour="#FF8FB8" />} onClick={noop} trailing={<IconButton size="sm" icon="Ellipsis" label="More" />} />
    </Island></div>
  </KitStage>
);

/**
 * `label`: a pressable row whose visible lines do not say what it does gets its own accessible name ("Open call
 * view, Squad Up"), and its secondary line becomes the description. `chevron`: the visible sign that it goes
 * somewhere. Its trailing controls keep their own names and presses.
 */
const LabelledBody = () => (
  <div style={{ width: 288, maxWidth: '100%' }}><Island padding="md">
    <ListRow
      size="lg"
      strong
      primary="Squad Up"
      secondary="Voice connected"
      label="Open call view, Squad Up"
      chevron
      onClick={noop}
      trailing={<IconButton icon="PhoneOff" label="Leave call" variant="danger" />}
    />
  </Island></div>
);

export const Labelled = () => (
  <KitStage mode="dark">
    <LabelledBody />
  </KitStage>
);

export const LabelledLight = () => (
  <KitStage mode="light">
    <LabelledBody />
  </KitStage>
);

const BusyBody = () => (
  <Row label="Busy: a tapped channel whose screen is loading (aria-busy, a spinner at the end), selected, unread, and a busy button row">
    <div style={{ width: 288, maxWidth: '100%' }}><Island padding="md">
      <ListRow primary="general" leading={hash} href="#general" busy />
      <ListRow primary="lfg" leading={hash} selected href="#lfg" busy />
      <ListRow primary="clips" leading={hash} unread href="#clips" busy trailing={<Badge count={2} tone="accent" label="2 mentions" />} />
      <ListRow primary="the-extremely-long-channel-name-that-somebody-thought-was-a-good-idea" leading={hash} href="#long" busy />
      <ListRow primary="Settings" leading={<Icon name="Settings" />} onClick={noop} chevron busy />
    </Island></div>
  </Row>
);

/** `busy` rows: what a phone shows while a tapped row's screen is still a chunk on its way. */
export const Busy = () => (
  <KitStage mode="dark">
    <BusyBody />
  </KitStage>
);

/** Busy, light. */
export const BusyLight = () => (
  <KitStage mode="light">
    <BusyBody />
  </KitStage>
);

/** Busy, tinted. */
export const BusyTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <BusyBody />
  </KitStage>
);
