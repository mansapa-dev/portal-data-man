<?php
declare(strict_types=1);
namespace Sipintar;
use mysqli;
use RuntimeException;
final class Inventory
{
    public function __construct(private mysqli $db) {}
    public function query(string $sql, array $params=[]): \mysqli_stmt {
        $s=$this->db->prepare($sql);
        if ($params) { $types=''; foreach($params as $p) $types.=is_int($p)?'i':'s'; $s->bind_param($types,...$params); }
        $s->execute(); return $s;
    }
    public function transactions(int $page, int $limit): array {
        $offset=($page-1)*$limit;
        $heads=$this->query('SELECT * FROM transaksi ORDER BY tanggal_pengambilan DESC,id DESC LIMIT ? OFFSET ?',[$limit,$offset])->get_result()->fetch_all(MYSQLI_ASSOC);
        $details=[];
        if ($heads) {
            $codes=array_column($heads,'kode_transaksi'); $marks=implode(',',array_fill(0,count($codes),'?'));
            foreach($this->query("SELECT kode_transaksi,nama_barang,jumlah,satuan FROM transaksi_detail WHERE kode_transaksi IN ($marks)",$codes)->get_result()->fetch_all(MYSQLI_ASSOC) as $d) {
                $code=$d['kode_transaksi']; unset($d['kode_transaksi']); $details[$code][]=$d;
            }
        }
        foreach($heads as &$head) $head['items']=$details[$head['kode_transaksi']] ?? [];
        return ['data'=>$heads,'page'=>$page,'per_page'=>$limit,'total'=>(int)$this->db->query('SELECT COUNT(*) FROM transaksi')->fetch_row()[0]];
    }
    private function items(array $items): array {
        if (!$items || count($items)>100) throw new RuntimeException('Isi 1–100 baris barang.');
        $result=[];
        foreach($items as $item) {
            $name=trim($item['nama_barang'] ?? ''); $qty=filter_var($item['jumlah'] ?? null,FILTER_VALIDATE_INT);
            if ($name==='' || $qty===false || $qty<1 || $qty>1000000) throw new RuntimeException('Barang dan jumlah harus valid serta positif.');
            $result[$name]=($result[$name] ?? 0)+$qty;
        }
        ksort($result); return $result;
    }
    private function adjust(array $deltas): array {
        ksort($deltas); $units=[];
        foreach($deltas as $name=>$delta) {
            $rows=$this->query('SELECT id,stok,satuan FROM barang WHERE nama_barang=? FOR UPDATE',[$name])->get_result()->fetch_all(MYSQLI_ASSOC);
            if (count($rows)!==1) throw new RuntimeException('Barang tidak ditemukan atau nama barang duplikat: '.$name);
            $r=$rows[0];
            if ((int)$r['stok']+$delta<0) throw new RuntimeException('Stok tidak cukup: '.$name);
            $this->query('UPDATE barang SET stok=stok+? WHERE id=?',[$delta,(int)$r['id']]); $units[$name]=$r['satuan'];
        }
        return $units;
    }
    public function save(array $input, bool $edit): void {
        $items=$this->items($input['items'] ?? []); $date=$input['tanggal_pengambilan'] ?? '';
        $parsed=\DateTimeImmutable::createFromFormat('!Y-m-d',$date);
        if (!$parsed || $parsed->format('Y-m-d')!==$date) throw new RuntimeException('Tanggal tidak valid.');
        $code=trim($input['kode_transaksi'] ?? '');
        if ($code==='' || strlen($code)>50 || trim($input['nama_pengambil'] ?? '')==='') throw new RuntimeException('Identitas transaksi tidak lengkap.');
        $type=strtoupper($input['tipe'] ?? 'KELUAR');
        if (!in_array($type,['MASUK','KELUAR'],true)) throw new RuntimeException('Tipe transaksi tidak valid.');
        $this->db->begin_transaction();
        try {
            $deltas=[];
            if ($edit) {
                $old=$this->query('SELECT tipe FROM transaksi WHERE kode_transaksi=? FOR UPDATE',[$code])->get_result()->fetch_assoc();
                if (!$old) throw new RuntimeException('Transaksi tidak ditemukan.'); $type=$old['tipe'];
                foreach($this->query('SELECT nama_barang,jumlah FROM transaksi_detail WHERE kode_transaksi=?',[$code])->get_result()->fetch_all(MYSQLI_ASSOC) as $row) $deltas[$row['nama_barang']]=($deltas[$row['nama_barang']] ?? 0)+(int)$row['jumlah']*($type==='MASUK'?-1:1);
            }
            foreach($items as $name=>$qty) $deltas[$name]=($deltas[$name] ?? 0)+$qty*($type==='MASUK'?1:-1);
            $units=$this->adjust($deltas);
            $values=[$date,$input['nama_pengambil'],$input['jabatan_unit'] ?? 'Pegawai',$input['keterangan'] ?? '',$code];
            if ($edit) {
                $this->query('UPDATE transaksi SET tanggal_pengambilan=?,nama_pengambil=?,jabatan_unit=?,keterangan=? WHERE kode_transaksi=?',$values);
                $this->query('DELETE FROM transaksi_detail WHERE kode_transaksi=?',[$code]);
            } else $this->query('INSERT INTO transaksi (tanggal_pengambilan,nama_pengambil,jabatan_unit,keterangan,kode_transaksi,tipe) VALUES (?,?,?,?,?,?)',[...$values,$type]);
            foreach($items as $name=>$qty) $this->query('INSERT INTO transaksi_detail (kode_transaksi,nama_barang,jumlah,satuan) VALUES (?,?,?,?)',[$code,$name,$qty,$units[$name]]);
            $this->db->commit();
        } catch(\Throwable $e) { $this->db->rollback(); throw $e; }
    }
    public function delete(array $codes): void {
        $codes=array_values(array_unique($codes)); sort($codes);
        if (!$codes || count($codes)>100) throw new RuntimeException('Pilih 1–100 transaksi.');
        $this->db->begin_transaction();
        try {
            $delta=[];
            foreach($codes as $code) {
                $head=$this->query('SELECT tipe FROM transaksi WHERE kode_transaksi=? FOR UPDATE',[$code])->get_result()->fetch_assoc();
                if (!$head) throw new RuntimeException('Transaksi tidak ditemukan.');
                foreach($this->query('SELECT nama_barang,jumlah FROM transaksi_detail WHERE kode_transaksi=?',[$code])->get_result()->fetch_all(MYSQLI_ASSOC) as $r) $delta[$r['nama_barang']]=($delta[$r['nama_barang']] ?? 0)+(int)$r['jumlah']*($head['tipe']==='MASUK'?-1:1);
            }
            $this->adjust($delta);
            foreach($codes as $code) { $this->query('DELETE FROM transaksi_detail WHERE kode_transaksi=?',[$code]); $this->query('DELETE FROM transaksi WHERE kode_transaksi=?',[$code]); }
            $this->db->commit();
        } catch(\Throwable $e) { $this->db->rollback(); throw $e; }
    }
}
