-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'REVIEWER', 'VIEWER');

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "lastUsedOrganizationId" TEXT;

-- Data migration: preserve existing user-org binding as owner membership.
UPDATE "User"
SET "lastUsedOrganizationId" = "organizationId"
WHERE "organizationId" IS NOT NULL;

INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "createdAt")
SELECT
  md5("id" || ':' || "organizationId"),
  "id",
  "organizationId",
  'OWNER'::"MembershipRole",
  CURRENT_TIMESTAMP
FROM "User"
WHERE "organizationId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_organizationId_fkey";

-- DropIndex
DROP INDEX "User_organizationId_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "organizationId";

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE INDEX "User_lastUsedOrganizationId_idx" ON "User"("lastUsedOrganizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_lastUsedOrganizationId_fkey" FOREIGN KEY ("lastUsedOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
