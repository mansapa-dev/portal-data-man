-- CreateTable
CREATE TABLE `AdminUser` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'DATA_ADMIN', 'DATA_OPERATOR', 'AUDITOR') NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AdminUser_publicId_key`(`publicId`),
    UNIQUE INDEX `AdminUser_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthSession` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `adminUserId` BIGINT UNSIGNED NULL,
    `teacherAccountId` BIGINT UNSIGNED NULL,
    `secretHash` VARCHAR(255) NOT NULL,
    `csrfHash` VARCHAR(255) NOT NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(500) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `rotatedFrom` VARCHAR(26) NULL,

    UNIQUE INDEX `AuthSession_publicId_key`(`publicId`),
    UNIQUE INDEX `AuthSession_secretHash_key`(`secretHash`),
    INDEX `AuthSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `tokenHash` VARCHAR(255) NOT NULL,
    `accountType` VARCHAR(20) NOT NULL,
    `accountPublicId` VARCHAR(26) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordResetToken_tokenHash_key`(`tokenHash`),
    INDEX `PasswordResetToken_accountPublicId_idx`(`accountPublicId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AcademicYear` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `name` VARCHAR(30) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AcademicYear_publicId_key`(`publicId`),
    UNIQUE INDEX `AcademicYear_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Semester` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `academicYearId` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('ODD', 'EVEN') NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Semester_publicId_key`(`publicId`),
    UNIQUE INDEX `Semester_academicYearId_type_key`(`academicYearId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolClass` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `academicYearId` BIGINT UNSIGNED NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `gradeLevel` INTEGER NOT NULL,
    `homeroomTeacherId` BIGINT UNSIGNED NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `SchoolClass_publicId_key`(`publicId`),
    INDEX `SchoolClass_updatedAt_idx`(`updatedAt`),
    UNIQUE INDEX `SchoolClass_academicYearId_code_key`(`academicYearId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Student` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `nisn` VARCHAR(10) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `parentPhone` VARCHAR(30) NULL,
    `address` TEXT NULL,
    `rfidUid` VARCHAR(100) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'DROPPED_OUT') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Student_publicId_key`(`publicId`),
    UNIQUE INDEX `Student_nisn_key`(`nisn`),
    UNIQUE INDEX `Student_rfidUid_key`(`rfidUid`),
    INDEX `Student_fullName_idx`(`fullName`),
    INDEX `Student_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Teacher` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `nip` VARCHAR(50) NULL,
    `nuptk` VARCHAR(50) NULL,
    `employeeNumber` VARCHAR(50) NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `gender` ENUM('MALE', 'FEMALE') NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(30) NULL,
    `address` TEXT NULL,
    `photoPath` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'RETIRED', 'TRANSFERRED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Teacher_publicId_key`(`publicId`),
    UNIQUE INDEX `Teacher_nip_key`(`nip`),
    UNIQUE INDEX `Teacher_nuptk_key`(`nuptk`),
    UNIQUE INDEX `Teacher_employeeNumber_key`(`employeeNumber`),
    UNIQUE INDEX `Teacher_email_key`(`email`),
    INDEX `Teacher_fullName_idx`(`fullName`),
    INDEX `Teacher_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeacherAccount` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `teacherId` BIGINT UNSIGNED NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'DISABLED', 'LOCKED') NOT NULL DEFAULT 'PENDING',
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TeacherAccount_publicId_key`(`publicId`),
    UNIQUE INDEX `TeacherAccount_teacherId_key`(`teacherId`),
    UNIQUE INDEX `TeacherAccount_username_key`(`username`),
    UNIQUE INDEX `TeacherAccount_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClassEnrollment` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `studentId` BIGINT UNSIGNED NOT NULL,
    `schoolClassId` BIGINT UNSIGNED NOT NULL,
    `academicYearId` BIGINT UNSIGNED NOT NULL,
    `semesterId` BIGINT UNSIGNED NOT NULL,
    `attendanceNumber` INTEGER NULL,
    `activeEnrollmentKey` VARCHAR(64) NULL,
    `enrolledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leftAt` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'MOVED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ClassEnrollment_publicId_key`(`publicId`),
    UNIQUE INDEX `ClassEnrollment_activeEnrollmentKey_key`(`activeEnrollmentKey`),
    INDEX `ClassEnrollment_studentId_semesterId_status_idx`(`studentId`, `semesterId`, `status`),
    INDEX `ClassEnrollment_updatedAt_idx`(`updatedAt`),
    UNIQUE INDEX `ClassEnrollment_schoolClassId_semesterId_attendanceNumber_key`(`schoolClassId`, `semesterId`, `attendanceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApplicationClient` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `clientSecretHash` VARCHAR(255) NULL,
    `clientType` ENUM('CONFIDENTIAL_WEB', 'PUBLIC_WEB', 'SERVICE') NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `redirectUris` JSON NULL,
    `postLogoutRedirectUris` JSON NULL,
    `allowedOrigins` JSON NULL,
    `allowedScopes` JSON NOT NULL,
    `allowedGrantTypes` JSON NOT NULL,
    `logoPath` VARCHAR(500) NULL,
    `description` TEXT NULL,
    `accessTokenLifetime` INTEGER NOT NULL DEFAULT 900,
    `refreshTokenLifetime` INTEGER NOT NULL DEFAULT 2592000,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ApplicationClient_publicId_key`(`publicId`),
    UNIQUE INDEX `ApplicationClient_slug_key`(`slug`),
    UNIQUE INDEX `ApplicationClient_clientId_key`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeacherApplicationAccess` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `teacherId` BIGINT UNSIGNED NOT NULL,
    `applicationClientId` BIGINT UNSIGNED NOT NULL,
    `role` VARCHAR(100) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `grantedBy` VARCHAR(26) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TeacherApplicationAccess_teacherId_applicationClientId_key`(`teacherId`, `applicationClientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportBatch` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `type` ENUM('STUDENT', 'TEACHER') NOT NULL,
    `originalFilename` VARCHAR(255) NOT NULL,
    `storedFilename` VARCHAR(255) NOT NULL,
    `fileHash` VARCHAR(64) NOT NULL,
    `status` ENUM('UPLOADED', 'VALIDATING', 'READY', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED') NOT NULL DEFAULT 'UPLOADED',
    `totalRows` INTEGER NOT NULL DEFAULT 0,
    `validRows` INTEGER NOT NULL DEFAULT 0,
    `insertedRows` INTEGER NOT NULL DEFAULT 0,
    `updatedRows` INTEGER NOT NULL DEFAULT 0,
    `skippedRows` INTEGER NOT NULL DEFAULT 0,
    `warningRows` INTEGER NOT NULL DEFAULT 0,
    `failedRows` INTEGER NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(26) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `summary` JSON NULL,
    `errorFilePath` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ImportBatch_publicId_key`(`publicId`),
    INDEX `ImportBatch_fileHash_type_idx`(`fileHash`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportRowResult` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `importBatchId` BIGINT UNSIGNED NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `identifier` VARCHAR(191) NULL,
    `status` ENUM('VALID', 'INSERTED', 'UPDATED', 'SKIPPED', 'WARNING', 'FAILED') NOT NULL,
    `messages` JSON NULL,
    `originalData` JSON NULL,
    `normalizedData` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ImportRowResult_importBatchId_rowNumber_key`(`importBatchId`, `rowNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(26) NOT NULL,
    `actorType` ENUM('ADMIN', 'TEACHER', 'APPLICATION', 'SYSTEM') NOT NULL,
    `actorPublicId` VARCHAR(26) NULL,
    `applicationClientId` BIGINT UNSIGNED NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityType` VARCHAR(100) NULL,
    `entityPublicId` VARCHAR(26) NULL,
    `oldValues` JSON NULL,
    `newValues` JSON NULL,
    `requestMethod` VARCHAR(10) NULL,
    `requestPath` VARCHAR(500) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuditLog_publicId_key`(`publicId`),
    INDEX `AuditLog_entityType_entityPublicId_idx`(`entityType`, `entityPublicId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OidcPayload` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(50) NOT NULL,
    `payload` JSON NOT NULL,
    `grantId` VARCHAR(191) NULL,
    `userCode` VARCHAR(191) NULL,
    `uid` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OidcPayload_userCode_key`(`userCode`),
    INDEX `OidcPayload_kind_expiresAt_idx`(`kind`, `expiresAt`),
    INDEX `OidcPayload_grantId_idx`(`grantId`),
    INDEX `OidcPayload_uid_idx`(`uid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_adminUserId_fkey` FOREIGN KEY (`adminUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_teacherAccountId_fkey` FOREIGN KEY (`teacherAccountId`) REFERENCES `TeacherAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Semester` ADD CONSTRAINT `Semester_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolClass` ADD CONSTRAINT `SchoolClass_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolClass` ADD CONSTRAINT `SchoolClass_homeroomTeacherId_fkey` FOREIGN KEY (`homeroomTeacherId`) REFERENCES `Teacher`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeacherAccount` ADD CONSTRAINT `TeacherAccount_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `Teacher`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassEnrollment` ADD CONSTRAINT `ClassEnrollment_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassEnrollment` ADD CONSTRAINT `ClassEnrollment_schoolClassId_fkey` FOREIGN KEY (`schoolClassId`) REFERENCES `SchoolClass`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassEnrollment` ADD CONSTRAINT `ClassEnrollment_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassEnrollment` ADD CONSTRAINT `ClassEnrollment_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeacherApplicationAccess` ADD CONSTRAINT `TeacherApplicationAccess_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `Teacher`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeacherApplicationAccess` ADD CONSTRAINT `TeacherApplicationAccess_applicationClientId_fkey` FOREIGN KEY (`applicationClientId`) REFERENCES `ApplicationClient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportRowResult` ADD CONSTRAINT `ImportRowResult_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `ImportBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_applicationClientId_fkey` FOREIGN KEY (`applicationClientId`) REFERENCES `ApplicationClient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
