// Durable, ordered writes. The server's revision is authoritative, never the device clock.
(function (root) {
  'use strict';
  class AnswerQueue {
    constructor({ storage, key, attemptId, send, notify = () => {} }) {
      this.storage = storage; this.key = key; this.attemptId = attemptId;
      this.send = send; this.notify = notify; this.running = null; this.stopped = false;
      this.error = null; this.blocked = false; this.revisions = {};
      const raw = storage.getItem(key);
      this.items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this.items) || this.items.some(item => !item || !Number.isInteger(item.question_id) || typeof item.mutation_id !== 'string')) {
        throw new Error('Antrean jawaban lokal tidak dapat dibaca. Jangan hapus data browser; hubungi pengawas.');
      }
      this.persist(); // Fail visibly before allowing answers if storage is unavailable.
    }
    persist() { this.storage.setItem(this.key, JSON.stringify(this.items)); }
    state() { return { pending: this.items.length, saving: !!this.running, blocked: this.blocked, error: this.error }; }
    report() { this.notify(this.state()); }
    restore(answers) {
      const merged = new Map(answers.map(a => [Number(a.question_id), { ...a }]));
      answers.forEach(a => { this.revisions[a.question_id] = Number(a.revision || 0); });
      // A response may have been lost after the server committed the head write.
      while (this.items.length) {
        const head = this.items[0], saved = merged.get(head.question_id);
        if (!saved || saved.mutation_id !== head.mutation_id) break;
        this.items.shift();
      }
      this.persist();
      for (const item of this.items) {
        merged.set(item.question_id, { question_id: item.question_id, answer: item.answer, is_flagged: item.is_flagged });
      }
      this.report();
      return [...merged.values()];
    }
    enqueue(questionId, answer, flagged) {
      if (this.stopped || this.blocked) throw new Error(this.error || 'Penyimpanan dihentikan. Hubungi pengawas.');
      const bytes = new Uint8Array(16); root.crypto.getRandomValues(bytes);
      const mutation = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      const item = { question_id: Number(questionId), answer, is_flagged: !!flagged, mutation_id: mutation };
      // Capture the expected revision at enqueue time. Never silently rebase an offline
      // answer onto changes made by another device after a refresh.
      const previous = [...this.items].reverse().find(i => i.question_id === item.question_id);
      item.base_revision = previous ? previous.base_revision + 1 : (this.revisions[item.question_id] || 0);
      this.items.push(item);
      try { this.persist(); } catch (_) {
        this.items.pop();
        throw new Error('Jawaban belum disimpan: penyimpanan perangkat penuh atau tidak tersedia. Hubungi pengawas.');
      }
      this.report();
      this.flush().catch(() => {});
    }
    async flush() {
      if (this.running) return this.running;
      if (this.stopped || this.blocked) throw new Error(this.error || 'Antrean tidak aktif.');
      const work = async () => {
        this.error = null;
        while (this.items.length && !this.stopped) {
          const item = this.items[0];
          const result = await this.send({ ...item, attempt_id: this.attemptId });
          this.revisions[item.question_id] = Number(result.revision);
          this.items.shift();
          try { this.persist(); } catch (error) { this.items.unshift(item); throw error; }
          this.report();
        }
      };
      this.running = work().catch(error => {
        this.error = error.message || 'Koneksi terputus. Jawaban menunggu pengiriman.';
        this.blocked = [400, 401, 403, 404, 409, 422].includes(error.status);
        throw error;
      }).finally(() => { this.running = null; this.report(); });
      this.report();
      return this.running;
    }
    async stop() { this.stopped = true; if (this.running) await this.running.catch(() => {}); }
    complete() { this.stopped = true; this.storage.removeItem(this.key); this.items = []; this.report(); }
  }
  root.CbtAnswerQueue = AnswerQueue;
  if (typeof module !== 'undefined') module.exports = AnswerQueue;
})(typeof window !== 'undefined' ? window : globalThis);
