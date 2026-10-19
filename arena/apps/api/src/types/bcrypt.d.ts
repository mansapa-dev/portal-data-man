/**
 * Minimal type shim for the native `bcrypt` package.
 *
 * Hanya mendeklarasikan subset yang digunakan oleh password-verify-worker.ts,
 * sehingga build TypeScript tidak memerlukan @types/bcrypt sebagai devDependency.
 * Ini membuat build dapat berjalan meskipun npm install dijalankan dengan --omit=dev.
 */
declare module 'bcrypt' {
  /** Verifikasi apakah `data` cocok dengan hash bcrypt `encrypted`. */
  function compare(data: string | Buffer, encrypted: string): Promise<boolean>;
  /** Buat hash bcrypt dari `data` dengan cost factor `saltOrRounds`. */
  function hash(data: string | Buffer, saltOrRounds: string | number): Promise<string>;

  const bcrypt: {
    compare: typeof compare;
    hash: typeof hash;
  };
  export default bcrypt;
  export { compare, hash };
}
