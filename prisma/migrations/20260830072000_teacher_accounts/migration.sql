ALTER TABLE `AuthSession`
  ADD COLUMN `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

ALTER TABLE `TeacherAccount`
  MODIFY `email` VARCHAR(191) NULL,
  MODIFY `passwordHash` VARCHAR(255) NULL,
  MODIFY `status` ENUM('PENDING', 'PENDING_SETUP', 'ACTIVE', 'DISABLED', 'LOCKED') NOT NULL DEFAULT 'PENDING_SETUP',
  ADD COLUMN `activatedAt` DATETIME(3) NULL,
  ADD COLUMN `disabledAt` DATETIME(3) NULL;

UPDATE `TeacherAccount` SET `status` = 'PENDING_SETUP' WHERE `status` = 'PENDING';

ALTER TABLE `TeacherAccount`
  MODIFY `status` ENUM('PENDING_SETUP', 'ACTIVE', 'DISABLED', 'LOCKED') NOT NULL DEFAULT 'PENDING_SETUP';

CREATE TABLE `TeacherPasswordSetupToken` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `publicId` VARCHAR(26) NOT NULL,
  `teacherAccountId` BIGINT UNSIGNED NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `TeacherPasswordSetupToken_publicId_key`(`publicId`),
  UNIQUE INDEX `TeacherPasswordSetupToken_tokenHash_key`(`tokenHash`),
  INDEX `TeacherPasswordSetupToken_teacherAccountId_expiresAt_idx`(`teacherAccountId`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TeacherPasswordSetupToken_teacherAccountId_fkey`
    FOREIGN KEY (`teacherAccountId`) REFERENCES `TeacherAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
