<?php
declare(strict_types=1);
namespace Cbt\Support;

use Cbt\Exceptions\DomainException;

final class ExamWindow
{
    public static function parse(string $value): \DateTimeImmutable
    {
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d H:i', $value, new \DateTimeZone('Asia/Jakarta'));
        if (!$date || $date->format('Y-m-d H:i') !== $value) throw new DomainException('Tanggal dan waktu jadwal tidak valid. Gunakan YYYY-MM-DD HH:MM WIB.', 422);
        return $date;
    }

    public static function assertSameDay(\DateTimeImmutable $start, \DateTimeImmutable $end): void
    {
        $zone = new \DateTimeZone('Asia/Jakarta');
        if ($end <= $start || $start->setTimezone($zone)->format('Y-m-d') !== $end->setTimezone($zone)->format('Y-m-d')) {
            throw new DomainException('Ujian susulan dan ujian ulang harus selesai pada satu tanggal WIB yang sama, setelah waktu mulai.', 422);
        }
    }

    public static function assertCommonDay(\PDO $db, string $startUtc, string $year, string $semester, int $exceptExam = 0): void
    {
        // Serialize scheduling across subjects, including concurrent admin requests.
        // Caller must keep this lock inside the schedule mutation transaction.
        if (!$db->inTransaction()) throw new \LogicException('Schedule validation requires a transaction.');
        $db->exec("INSERT IGNORE INTO cbt_settings(key_name,value) VALUES('follow_up_schedule_lock','')");
        $db->query("SELECT value FROM cbt_settings WHERE key_name='follow_up_schedule_lock' FOR UPDATE")->fetchColumn();
        $statement = $db->prepare("SELECT e.starts_at FROM exams e JOIN exam_follow_up_meta m ON m.exam_id=e.id WHERE e.status='ACTIVE' AND e.ends_at>=UTC_TIMESTAMP(3) AND e.academic_year=? AND e.semester=? AND e.id<>? LOCK IN SHARE MODE");
        $statement->execute([$year, $semester, $exceptExam]);
        $zone = new \DateTimeZone('Asia/Jakarta');
        $date = (new \DateTimeImmutable($startUtc, new \DateTimeZone('UTC')))->setTimezone($zone)->format('Y-m-d');
        foreach ($statement->fetchAll(\PDO::FETCH_COLUMN) as $existing) {
            $scheduled = (new \DateTimeImmutable($existing, new \DateTimeZone('UTC')))->setTimezone($zone)->format('Y-m-d');
            if ($date !== $scheduled) throw new DomainException('Seluruh ujian susulan dan ulang pada periode ini harus menggunakan tanggal bersama '.$scheduled.' WIB.', 422);
        }
    }
}
