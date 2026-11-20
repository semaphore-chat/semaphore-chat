export class AppearanceSettingsResponseDto {
  id: string;
  userId: string;
  themeMode: string;
  accentColor: string;
  intensity: string;
  baseColor: string;
  matchSystem: boolean;
  newDesign: boolean;
  /** Load pictures, site icons, GIFs and webhook avatars from other sites automatically. */
  loadRemoteContent: boolean;
  createdAt: Date;
  updatedAt: Date;
}
