import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    // Used by the migrate CLI (`migrate deploy`, `migrate dev`, ...). Not
    // env('DATABASE_URL'): that throws when the variable is unset, and
    // `prisma generate` (image builds, postinstall) runs without a database.
    // Prisma 7 doesn't load .env files: the variable comes from the
    // environment (Docker Compose, Helm, CI).
    url: process.env.DATABASE_URL ?? '',
  },
});
