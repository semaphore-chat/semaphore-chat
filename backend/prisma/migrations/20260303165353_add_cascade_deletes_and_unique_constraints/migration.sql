/*
  Warnings:

  - A unique constraint covering the columns `[userId,channelId]` on the table `ReadReceipt` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,directMessageGroupId]` on the table `ReadReceipt` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,communityId,roleId]` on the table `UserRoles` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_communityId_fkey";

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_userId_fkey";

-- DropForeignKey
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";

-- DropIndex
DROP INDEX "UserRoles_userId_communityId_roleId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ReadReceipt_userId_channelId_key" ON "ReadReceipt"("userId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadReceipt_userId_directMessageGroupId_key" ON "ReadReceipt"("userId", "directMessageGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoles_userId_communityId_roleId_key" ON "UserRoles"("userId", "communityId", "roleId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
