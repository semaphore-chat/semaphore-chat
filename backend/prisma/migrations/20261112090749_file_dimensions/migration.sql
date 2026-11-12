-- NOTE: Prisma's diff also wants to DROP the generated Message."searchVector"
-- tsvector column and its GIN index, which schema.prisma cannot express (see
-- migration 20260307210420_restore_search_vector). That DROP has been manually
-- stripped from this migration; do not apply it.

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;
