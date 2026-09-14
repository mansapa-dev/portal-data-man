<?php
declare(strict_types=1);
namespace Sipintar;
use RuntimeException;
require_once __DIR__.'/Database.php';
final class Borrowings
{
    public function __construct(private Database $repository) {}
    public function save(array $input, array $employee, bool $edit = false): string
    {
        $date=$input['borrowDate'] ?? date('Y-m-d'); $expected=$input['expectedReturnDate'] ?? '';
        foreach([$date,$expected] as $value) { $d=\DateTimeImmutable::createFromFormat('!Y-m-d',$value); if(!$d || $d->format('Y-m-d')!==$value) throw new RuntimeException('Tanggal tidak valid.'); }
        if($expected<$date) throw new RuntimeException('Tanggal kembali tidak boleh sebelum tanggal pinjam.');
        $item=trim(($input['itemNameCustom'] ?? '') ?: ($input['itemName'] ?? $input['presetItemSelect'] ?? ''));
        $qty=filter_var($input['itemQty'] ?? null,FILTER_VALIDATE_INT); $purpose=trim($input['borrowPurpose'] ?? '');
        if($item==='' || strlen($item)>150 || $qty===false || $qty<1 || $qty>1000000 || $purpose==='') throw new RuntimeException('Barang, jumlah positif, dan keperluan wajib diisi.');
        $type=$input['borrowerType'] ?? 'Guru';
        if(!in_array($type,['Guru','Pegawai','Staf','Siswa','Lainnya','Tendik'],true)) throw new RuntimeException('Kategori peminjam tidak valid.');
        $id=$edit ? ($input['edit_id'] ?? '') : 'MAN1-'.date('Ymd').'-'.bin2hex(random_bytes(8));
        $name=trim($input['borrowerName'] ?? '') ?: $employee['name'];
        $idNum=trim($input['borrowerIdNum'] ?? '') ?: ($employee['nip'] ?: '-');
        if (strlen($name)>100 || strlen($idNum)>50 || strlen($purpose)>65535) throw new RuntimeException('Data peminjam atau keperluan terlalu panjang.');
        $values=[$name,$type,$idNum,$item,$qty,$purpose,$date,$expected];
        if($edit) $this->repository->query('UPDATE borrowings SET name=?,type=?,id_num=?,item=?,qty=?,purpose=?,date=?,expected_return=? WHERE id=?',[...$values,$id]);
        else $this->repository->query('INSERT INTO borrowings (name,type,id_num,item,qty,purpose,date,expected_return,id,time,`condition`) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[...$values,$id,date('H:i:s'),$input['initialCondition'] ?? 'Baik']);
        return $id;
    }
    public function returned(string $id, int $status): void {
        if(!in_array($status,[0,1],true)) throw new RuntimeException('Status tidak valid.');
        $this->repository->query('UPDATE borrowings SET returned=?,actual_return=? WHERE id=?',[$status,$status?date('Y-m-d H:i'):'-',$id]);
    }
    public function delete(string $id): void {
        if (!preg_match('/^MAN1-\d{8}-[a-f0-9]{16}$/', $id)) throw new RuntimeException('Kode peminjaman tidak valid.');
        $result = $this->repository->query('DELETE FROM borrowings WHERE id=?', [$id]);
        if ($result->affected_rows !== 1) throw new RuntimeException('Peminjaman tidak ditemukan.');
    }
}
