import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError, api } from '../lib/api';
import { ConfirmDialog, DetailItem, EmptyState, ErrorState, FormField, LoadingSkeleton, PageHeader, ServerPagination, StatusBadge, humanizeStatus, useToast } from '../components/management';
import { EmployeeAccountPanel } from './teacher-account';

type Employee = {
  publicId: string;
  employmentType: 'PNS' | 'PPPK' | 'HONORER';
  fullName: string;
  nip?: string;
  nuptk?: string;
  position: string;
  rank?: string;
  gender?: 'MALE' | 'FEMALE';
  education?: string;
  grade?: string;
  status: 'ACTIVE' | 'INACTIVE';
  account?: { status: string; username: string } | null;
};

export const employeeSchema = z.object({
  employmentType: z.enum(['PNS', 'PPPK', 'HONORER']),
  fullName: z.string().min(2, 'Nama minimal 2 karakter.'),
  nip: z.string().min(1, 'NIP wajib diisi.'),
  nuptk: z.string().optional(),
  position: z.string().min(1, 'Jabatan wajib diisi.'),
  rank: z.string().optional(),
  gender: z.enum(['', 'MALE', 'FEMALE']),
  education: z.string().optional(),
  grade: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
type Values = z.infer<typeof employeeSchema>;

export function EmployeesPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      search ? next.set('search', search) : next.delete('search');
      next.set('page', '1');
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({ queryKey: ['employees', params.toString()], queryFn: () => api<Employee[]>(`/employees?${params}`) });
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.set('page', '1');
    setParams(next);
  };

  return <div className="page">
    <PageHeader title="Data Pegawai" description="Data PNS, PPPK, dan tenaga honorer" action={<div className="actions">
      <a className="button" href={`/api/v1/exports/employees?${params}`}>Export</a>
      <a className="button" href={`/api/v1/exports/employee-credentials?search=${encodeURIComponent(search)}`}>Export akun & password</a>
      <Link className="button" to="/imports/employees">Import pegawai</Link>
      <Link className="button primary" to="/employees/new">Tambah pegawai</Link>
    </div>} />
    <div className="filters">
      <input aria-label="Cari pegawai" placeholder="Cari nama, NIP, NUPTK, atau jabatan…" value={search} onChange={event => setSearch(event.target.value)} />
      <select aria-label="Jenis pegawai" value={params.get('employmentType') ?? ''} onChange={event => filter('employmentType', event.target.value)}><option value="">Semua jenis</option><option value="PNS">PNS</option><option value="PPPK">PPPK</option><option value="HONORER">Honorer</option></select>
      <select aria-label="Status pegawai" value={params.get('status') ?? ''} onChange={event => filter('status', event.target.value)}><option value="">Semua status</option><option value="ACTIVE">Aktif</option><option value="INACTIVE">Tidak aktif</option></select>
      <button onClick={() => { setSearch(''); setParams({ page: '1' }); }}>Reset</button>
    </div>
    {query.isPending ? <LoadingSkeleton /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="Pegawai tidak ditemukan" /> : <>
      <div className="tablewrap"><table><thead><tr><th>Nama</th><th>Jenis</th><th>NIP/NUPTK</th><th>Jabatan</th><th>Golongan</th><th>Pendidikan</th><th>Grade</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
        {query.data.data.map(employee => <tr key={employee.publicId}><td><strong>{employee.fullName}</strong></td><td>{humanizeStatus(employee.employmentType)}</td><td>{employee.nip ?? employee.nuptk ?? '—'}</td><td>{employee.position}</td><td>{employee.rank ?? '—'}</td><td>{employee.education ?? '—'}</td><td>{employee.grade ?? '—'}</td><td><StatusBadge value={employee.status} /></td><td><Link to={`/employees/${employee.publicId}`}>Detail</Link> · <Link to={`/employees/${employee.publicId}/edit`}>Edit</Link></td></tr>)}
      </tbody></table></div>
      <ServerPagination meta={query.data.meta} onPage={page => { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next); }} />
    </>}
  </div>;
}

export function EmployeeFormPage() {
  const { id } = useParams();
  const edit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['employee', id], queryFn: () => api<Employee>(`/employees/${id}`), enabled: edit });
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<Values>({ resolver: zodResolver(employeeSchema), defaultValues: { employmentType: 'PPPK', gender: '', status: 'ACTIVE' } });
  useEffect(() => { if (detail.data) reset({ ...detail.data.data, gender: detail.data.data.gender ?? '' }); }, [detail.data]);
  const save = useMutation({
    mutationFn: (values: Values) => api<Employee>(edit ? `/employees/${id}` : '/employees', { method: edit ? 'PATCH' : 'POST', body: JSON.stringify({ ...values, gender: values.gender || null }) }),
    onSuccess: response => { toast(response.message); client.invalidateQueries({ queryKey: ['employees'] }); client.invalidateQueries({ queryKey: ['dashboard'] }); navigate(`/employees/${response.data.publicId}`); },
    onError: error => {
      if (error instanceof ApiError && error.errors) for (const [field, messages] of Object.entries(error.errors)) setError(field as keyof Values, { message: messages[0] ?? 'Validasi gagal.' });
      else toast((error as Error).message, 'error');
    },
  });
  if (edit && detail.isPending) return <LoadingSkeleton />;

  return <div className="page"><PageHeader title={edit ? 'Edit Pegawai' : 'Tambah Pegawai'} description="Data PNS, PPPK, atau tenaga honorer" />
    <form className="formcard" onSubmit={handleSubmit(values => save.mutate(values))}>
      <FormField label="Jenis pegawai" required error={errors.employmentType?.message}><select {...register('employmentType')}><option value="PNS">PNS</option><option value="PPPK">PPPK</option><option value="HONORER">Honorer</option></select></FormField>
      <FormField label="Nama" required error={errors.fullName?.message}><input {...register('fullName')} /></FormField>
      <FormField label="NIP" required error={errors.nip?.message}><input {...register('nip')} /></FormField>
      <FormField label="NUPTK" helper="Boleh kosong untuk tenaga honorer"><input {...register('nuptk')} /></FormField>
      <FormField label="Jabatan" required error={errors.position?.message}><input {...register('position')} /></FormField>
      <FormField label="Golongan" helper="Boleh kosong untuk tenaga honorer"><input {...register('rank')} /></FormField>
      <FormField label="Jenis kelamin"><select {...register('gender')}><option value="">Belum diisi</option><option value="MALE">Laki-laki</option><option value="FEMALE">Perempuan</option></select></FormField>
      <FormField label="Pendidikan"><input {...register('education')} placeholder="Contoh: S1 Administrasi" /></FormField>
      <FormField label="Grade"><input {...register('grade')} /></FormField>
      <FormField label="Status"><select {...register('status')}><option value="ACTIVE">Aktif</option><option value="INACTIVE">Tidak aktif</option></select></FormField>
      <div className="actions"><button type="button" onClick={() => navigate(-1)}>Batal</button><button className="primary" disabled={save.isPending}>{save.isPending ? 'Menyimpan…' : 'Simpan'}</button></div>
    </form>
  </div>;
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ role: string }>('/auth/admin/me') });
  const query = useQuery({ queryKey: ['employee', id], queryFn: () => api<Employee>(`/employees/${id}`) });
  const remove = useMutation({
    mutationFn: () => api(`/employees/${id}`, { method: 'DELETE' }),
    onSuccess: response => { toast(response.message); setConfirmDelete(false); client.invalidateQueries({ queryKey: ['employees'] }); client.invalidateQueries({ queryKey: ['dashboard'] }); navigate('/employees'); },
    onError: error => { toast((error as Error).message, 'error'); setConfirmDelete(false); },
  });
  if (query.isPending) return <LoadingSkeleton />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;
  const employee = query.data.data;
  const canDelete = ['SUPER_ADMIN', 'DATA_ADMIN'].includes(me.data?.data.role ?? '');

  return <div className="page">
    <PageHeader title={employee.fullName} description={`${humanizeStatus(employee.employmentType)} · ${employee.position}`} action={<div className="actions"><a className="button primary" href="#portal-account">Buat akun Portal</a><Link className="button" to={`/employees/${id}/edit`}>Edit</Link>{canDelete && <button className="danger" onClick={() => setConfirmDelete(true)}>Hapus pegawai</button>}</div>} />
    <div id="portal-account"><EmployeeAccountPanel employeeId={id!} /></div>
    <section className="details">
      <DetailItem label="Jenis pegawai" value={humanizeStatus(employee.employmentType)} /><DetailItem label="Status" value={<StatusBadge value={employee.status} />} />
      <DetailItem label="NIP" value={employee.nip} /><DetailItem label="NUPTK" value={employee.nuptk} /><DetailItem label="Jabatan" value={employee.position} />
      <DetailItem label="Golongan" value={employee.rank} /><DetailItem label="Jenis kelamin" value={employee.gender === 'MALE' ? 'Laki-laki' : employee.gender === 'FEMALE' ? 'Perempuan' : undefined} />
      <DetailItem label="Pendidikan" value={employee.education} /><DetailItem label="Grade" value={employee.grade} />
    </section>
    <ConfirmDialog open={confirmDelete} title="Hapus data pegawai?" description={`${employee.fullName} akan dinonaktifkan dan dipindahkan ke data terhapus.`} busy={remove.isPending} onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} />
  </div>;
}
