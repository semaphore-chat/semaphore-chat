import { Avatar, IconButton, Island, Pill, Table, Text, type TableColumn, type TableRow } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const columns: TableColumn[] = [
  { id: 'member', header: 'Member' },
  { id: 'role', header: 'Role' },
  { id: 'joined', header: 'Joined' },
  { id: 'actions', header: 'Actions', align: 'end' },
];

const person = (name: string, colour: string) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: tokens.space.sm }}>
    <Avatar decorative size="sm" name={name} colour={colour} />
    <Text>{name}</Text>
  </span>
);

const rows: TableRow[] = [
  ['aiko', '#FF8FB8', 'Member', 'neutral', '2026-01-12'],
  ['Samira', '#5ED1D1', 'Admin', 'accent', '2025-11-02'],
  ['dropbear', '#5FD49A', 'Mod', 'positive', '2026-03-30'],
].map(([name, colour, role, tone, joined]) => ({
  id: name,
  cells: {
    member: person(name, colour),
    role: <Pill tone={tone as 'neutral' | 'accent' | 'positive'}>{role}</Pill>,
    joined,
    actions: <IconButton size="sm" icon="Ellipsis" label={`More about ${name}`} />,
  },
}));

export const Basic = () => (
  <KitStage mode="dark">
    <Island padding="md">
      <Table label="Members" columns={columns} rows={rows} />
    </Island>
  </KitStage>
);

export const BasicLight = () => (
  <KitStage mode="light">
    <Island padding="md">
      <Table label="Members" columns={columns} rows={rows} />
    </Island>
  </KitStage>
);

export const BasicTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <Island padding="md">
      <Table label="Members" columns={columns} rows={rows} />
    </Island>
  </KitStage>
);

export const Empty = () => (
  <KitStage mode="dark">
    <Island padding="md">
      <Table label="Members" columns={columns} rows={[]} empty="No members match that search" />
    </Island>
  </KitStage>
);

/** Too wide for a 320 px box: it scrolls inside its own box, not the page. */
export const Narrow = () => (
  <KitStage mode="dark">
    <Row label="320 px box">
      <div style={{ width: 320, maxWidth: '100%' }}><Island padding="md">
        <Table label="Members" columns={columns} rows={rows} />
      </Island></div>
    </Row>
  </KitStage>
);
