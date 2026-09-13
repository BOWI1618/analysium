-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "acceptedById" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

