import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog, CopyButton, DetailItem, EmptyState, ErrorState, LoadingSkeleton, Modal, StatusBadge, useToast } from '../components/management';
import { api } from '../lib/api';

type Account = { publicId: string; username: string; email?: string; status: string; lastLoginAt?: string; passwordConfigured: boolean };

export function TeacherAccountPanel({ teacherId }: { teacherId: string }) {
    return <PortalAccountPanel entity="teacher" publicId={teacherId}/>;
}

export function EmployeeAccountPanel({ employeeId }: { employeeId: string }) {
    return <PortalAccountPanel entity="employee" publicId={employeeId}/>;
}

function PortalAccountPanel({ entity, publicId }: { entity: 'teacher'|'employee'; publicId: string }) {
    const teacherId = publicId;
    const plural = entity === 'teacher' ? 'teachers' : 'employees';
    const label = entity === 'teacher' ? 'guru' : 'pegawai';

    const q = useQuery({ queryKey: [`${entity}-account`, teacherId], queryFn: () => api<Account | null>(`/${plural}/${teacherId}/account`) });
    const qc = useQueryClient(), toast = useToast();
    const [url, setUrl] = useState('');
    const [password, setPassword] = useState('');
    const [customPassword, setCustomPassword] = useState('');
    const [mailStatus, setMailStatus] = useState('');
    const [action, setAction] = useState<string>();

    const mutation = useMutation({
        mutationFn: async () => {
            if (action === 'create') {
                return api<any>(`/${plural}/${teacherId}/account`, { method: 'POST', body: '{}' });
            }
            if (action === 'reset-password') {
                const body = customPassword ? JSON.stringify({ password: customPassword }) : '{}';
                return api<any>(`/${plural}/${teacherId}/account/reset-password`, { method: 'POST', body });
            }
            return api<any>(`/${plural}/${teacherId}/account/${action}`, { method: 'POST' });
        },
        onSuccess: r => {
            toast(r.message);
            if (r.data?.defaultPassword || r.data?.newPassword) {
                setPassword(r.data.defaultPassword || r.data.newPassword);
            }
            if (r.data?.passwordSetupUrl) {
                setUrl(r.data.passwordSetupUrl);
                setMailStatus(r.data.mailStatus ?? '');
            }
            setAction(undefined);
            setCustomPassword('');
            qc.invalidateQueries({ queryKey: [`${entity}-account`, teacherId] });
        },
        onError: e => toast((e as Error).message, 'error')
    });

    if (q.isPending) return <LoadingSkeleton rows={2}/>;
    if (q.isError) return <ErrorState retry={() => q.refetch()}/>;

    const a = q.data.data;
    const openResult = Boolean(url || password);

    return (
        <section>
            <h2>Akun Portal</h2>
            {!a ? (
                <div className="formcard">
                    <EmptyState title="Akun belum dibuat"/>
                    <p>Username akan dibuat otomatis dari NIP, NUPTK{entity === 'teacher' ? ', atau nomor pegawai' : ''}.</p>
                    <button className="primary" disabled={mutation.isPending} onClick={() => setAction('create')}>
                        Buat akun dan kirim aktivasi
                    </button>
                </div>
            ) : (
                <>
                    <div className="details">
                        <DetailItem label="Status" value={<StatusBadge value={a.status}/>}/>
                        <DetailItem label="Username" value={a.username}/>
                        <DetailItem label="Email" value={a.email}/>
                        <DetailItem label="Login terakhir" value={a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('id-ID') : '—'}/>
                    </div>
                    <div className="actions">
                        <button className="primary" onClick={() => setAction('reset-password')}>
                            🔑 Reset password
                        </button>
                        {a.status === 'PENDING_SETUP' && (
                            <button onClick={() => setAction('setup-token')}>Kirim ulang aktivasi</button>
                        )}
                        {a.status === 'ACTIVE' && (
                            <button className="danger" onClick={() => setAction('disable')}>Nonaktifkan</button>
                        )}
                        {a.status === 'DISABLED' && (
                            <button onClick={() => setAction('enable')}>Aktifkan</button>
                        )}
                        {a.status === 'LOCKED' && (
                            <button onClick={() => setAction('unlock')}>Buka kunci</button>
                        )}
                        <button onClick={() => setAction('revoke-sessions')}>Cabut seluruh session</button>
                    </div>
                </>
            )}

            {/* Dialog konfirmasi standar untuk aksi create, disable, dsb */}
            <ConfirmDialog
                open={Boolean(action && action !== 'reset-password')}
                title={action === 'create' ? `Buat akun ${label}?` : 'Konfirmasi tindakan akun'}
                description={action === 'create' ? 'Username dibuat otomatis dan tautan aktivasi akan dibuat.' : 'Perubahan credential dan session akan dicatat dalam audit log.'}
                busy={mutation.isPending}
                onClose={() => setAction(undefined)}
                onConfirm={() => mutation.mutate()}
            />

            {/* Modal interaktif untuk Reset Password */}
            <Modal
                title={`Reset Password ${label.toUpperCase()}`}
                open={action === 'reset-password'}
                onClose={() => { setAction(undefined); setCustomPassword(''); }}
            >
                <p>
                    Password akun {label} akan diperbarui. Sesi aktif lama akan dicabut dan guru dapat langsung login ke SIPADU, Arena, serta Agen menggunakan password baru ini.
                </p>
                <div style={{ marginTop: '1rem', marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                        Password baru (opsional, min. 8 karakter):
                    </label>
                    <input
                        type="text"
                        placeholder="Kosongkan untuk generate acak otomatis (disarankan)"
                        value={customPassword}
                        onChange={e => setCustomPassword(e.target.value)}
                        style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.95rem' }}
                    />
                    <small style={{ color: '#6b7280', display: 'block', marginTop: '0.35rem' }}>
                        💡 Jika dikosongkan, sistem akan otomatis menghasilkan password aman (contoh: <code>{entity === 'teacher' ? 'Guru#AB12CD34' : 'Pegawai#AB12CD34'}</code>) dan menampilkannya di layar.
                    </small>
                </div>
                <div className="actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => { setAction(undefined); setCustomPassword(''); }}>
                        Batal
                    </button>
                    <button
                        className="primary"
                        disabled={mutation.isPending || (Boolean(customPassword) && customPassword.length < 8)}
                        onClick={() => mutation.mutate()}
                    >
                        {mutation.isPending ? 'Mereset…' : 'Reset Password Sekarang'}
                    </button>
                </div>
            </Modal>

            {/* Modal hasil reset / pembuatan akun */}
            <Modal
                title={password ? `Credential Baru Akun ${label.toUpperCase()}` : 'Tautan aktivasi satu kali'}
                open={openResult}
                onClose={() => { setUrl(''); setPassword(''); }}
            >
                {password && (
                    <>
                        <p><strong>Password baru</strong> berhasil diterapkan. Salin dan berikan kepada {label} untuk login ke SIPADU/Arena/Agen.</p>
                        <div style={{ margin: '1rem 0' }}>
                            <input readOnly value={password} style={{ fontWeight: 'bold', fontSize: '1.1rem', letterSpacing: '0.05em' }}/>
                        </div>
                        <div className="actions">
                            <CopyButton value={password} label="Salin password"/>
                        </div>
                    </>
                )}
                {url && (
                    <>
                        <p>{mailStatus === 'SENT' ? `Tautan aktivasi berhasil dikirim ke email ${label}.` : `Atau berikan tautan aktivasi ini kepada ${label}:`}</p>
                        <textarea readOnly value={url} rows={2}/>
                        <div className="actions">
                            <CopyButton value={url} label="Salin URL"/>
                        </div>
                    </>
                )}
                <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
                    <button className="primary" onClick={() => { setUrl(''); setPassword(''); }}>
                        Selesai
                    </button>
                </div>
            </Modal>
        </section>
    );
}
