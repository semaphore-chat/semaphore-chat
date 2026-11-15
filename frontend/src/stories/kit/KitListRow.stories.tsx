import { Avatar, Badge, Icon, IconButton, ListRow, Pill } from '../../kit';
import { KitStage, Row } from '../fixtures/kitStory';
import { KitSurface } from '../fixtures/kitSurface';

const noop = () => undefined;
const hash = <Icon name="Hash" />;

interface Look {
  mode?: 'dark' | 'light';
  base?: string;
  intensity?: 'minimal' | 'balanced' | 'vibrant';
}

const StatesBody = (look: Look) => (
  <>
    <Row label="Channel rows: default, selected, unread, muted, disabled">
      <KitSurface width={288} {...look}>
        <ListRow primary="lfg" leading={hash} onClick={noop} />
        <ListRow primary="general" leading={hash} selected href="#general" />
        <ListRow primary="clips" leading={hash} unread onClick={noop} trailing={<Badge count={2} tone="accent" label="2 unread" />} />
        <ListRow primary="old-news" leading={hash} muted onClick={noop} />
        <ListRow primary="staff" leading={<Icon name="Lock" />} disabled onClick={noop} />
        <ListRow primary="Plain content, no action" leading={hash} />
      </KitSurface>
    </Row>
    <Row label="With an avatar, secondary line and trailing pill">
      <KitSurface width={288} {...look}>
        <ListRow size="lg" primary="aiko" secondary="Playing Hades" leading={<Avatar decorative name="aiko" colour="#FF8FB8" presence="online" />} onClick={noop} />
        <ListRow size="lg" primary="gracie" secondary="Away" selected leading={<Avatar decorative name="gracie" colour="#FFA366" presence="away" />} onClick={noop} />
        <ListRow size="lg" primary="Diego" secondary="Offline" muted leading={<Avatar decorative name="Diego" presence="offline" />} onClick={noop} trailing={<Pill size="sm">Mod</Pill>} />
      </KitSurface>
    </Row>
  </>
);

export const States = () => (
  <KitStage mode="dark">
    <StatesBody mode="dark" />
  </KitStage>
);

export const StatesLight = () => (
  <KitStage mode="light">
    <StatesBody mode="light" />
  </KitStage>
);

export const StatesTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <StatesBody mode="dark" base="#0d9488" intensity="vibrant" />
  </KitStage>
);

/** A channel list like the app's: Hash rows, unread badges, one selected. */
export const Channels = () => (
  <KitStage mode="dark">
    <KitSurface width={288}>
      <ListRow primary="general" leading={hash} selected href="#general" />
      <ListRow primary="lfg" leading={hash} unread href="#lfg" trailing={<Badge count={3} tone="accent" label="3 unread" />} />
      <ListRow primary="clips" leading={hash} unread href="#clips" trailing={<Badge count={120} tone="accent" label="120 unread" />} />
      <ListRow primary="memes" leading={hash} href="#memes" />
      <ListRow primary="Game night" leading={<Icon name="Volume2" />} href="#voice" trailing={<Badge dot tone="accent" label="Someone is talking" />} />
      <ListRow primary="afk" leading={<Icon name="Volume2" />} muted href="#afk" />
    </KitSurface>
  </KitStage>
);

/** A member list: two-line rows, presence, a role pill or an action. */
export const People = () => (
  <KitStage mode="dark">
    <KitSurface width={264}>
      <ListRow size="lg" primary="Samira" secondary="Admin" leading={<Avatar decorative name="Samira" colour="#5ED1D1" presence="online" />} onClick={noop} trailing={<Pill size="sm" tone="accent">Admin</Pill>} />
      <ListRow size="lg" primary="dropbear" secondary="Streaming" leading={<Avatar decorative name="dropbear" colour="#5FD49A" presence="speaking" />} onClick={noop} trailing={<IconButton size="sm" icon="Ellipsis" label="More about dropbear" />} />
      <ListRow size="lg" primary="kwam3" secondary="Away" leading={<Avatar decorative name="kwam3" colour="#6FB1F5" presence="away" />} onClick={noop} />
      <ListRow size="lg" primary="pri" leading={<Avatar decorative name="pri" colour="#C792F0" presence="online" />} onClick={noop} />
      <ListRow size="lg" primary="zara" secondary="Offline" muted leading={<Avatar decorative name="zara" presence="offline" />} onClick={noop} />
    </KitSurface>
  </KitStage>
);

const LONG = 'a-very-long-channel-name-that-goes-on-and-on-and-on-forever-ok';

/** A 60-character name in a 280 px box: an ellipsis, trailing slot kept. */
export const LongNames = () => (
  <KitStage mode="dark">
    <KitSurface width={280}>
      <ListRow primary={LONG} leading={hash} unread onClick={noop} trailing={<Badge count={7} tone="accent" label="7 unread" />} />
      <ListRow primary={LONG} leading={hash} selected onClick={noop} trailing={<IconButton size="sm" icon="Ellipsis" label="More" />} />
      <ListRow size="lg" primary={LONG} secondary={`${LONG} (secondary)`} leading={<Avatar decorative name="Long Name" colour="#FF8FB8" />} onClick={noop} trailing={<Pill size="sm">Mod</Pill>} />
    </KitSurface>
  </KitStage>
);
