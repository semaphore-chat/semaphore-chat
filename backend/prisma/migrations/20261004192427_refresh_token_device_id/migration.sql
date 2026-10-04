-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "deviceId" TEXT;

-- CreateIndex
CREATE INDEX "RefreshToken_userId_deviceId_idx" ON "RefreshToken"("userId", "deviceId");
