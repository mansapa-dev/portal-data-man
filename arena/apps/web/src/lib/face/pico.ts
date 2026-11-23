/*
 * pico.js — deteksi wajah frontal dalam ~200 baris JavaScript.
 * MIT License. Sumber asli: https://github.com/nenadmarkus/picojs
 *
 * Diadaptasi menjadi modul ES + TypeScript agar bisa dipakai Arena CBT tanpa
 * dependensi runtime tambahan. Seluruh pemrosesan tetap di perangkat siswa.
 */

export type CascadeClassifier = (
  r: number,
  c: number,
  s: number,
  pixels: Uint8Array,
  ldim: number,
) => number;

export type FaceImage = {
  pixels: Uint8Array;
  nrows: number;
  ncols: number;
  ldim: number;
};

/** [row, column, size, score] */
export type Detection = [number, number, number, number];

export type CascadeParams = {
  shiftfactor: number;
  minsize: number;
  maxsize: number;
  scalefactor: number;
};

/**
 * Membaca file cascade biner pico menjadi fungsi klasifikasi wilayah.
 * Format file: 8 byte header, int32 kedalaman pohon, lalu tabel tree/threshold.
 */
export function unpackCascade(bytes: Uint8Array): CascadeClassifier {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;

  const tdepth = view.getInt32(p, true);
  p += 4;

  const ntrees = view.getInt32(p, true);
  p += 4;

  const tcodesList: number[] = [];
  const tpredsList: number[] = [];
  const threshList: number[] = [];

  for (let t = 0; t < ntrees; ++t) {
    // Empat nilai awal untuk node akar, lalu sisa node internal.
    tcodesList.push(0, 0, 0, 0);
    const internalBytes = 4 * Math.pow(2, tdepth) - 4;
    for (let i = 0; i < internalBytes; ++i) tcodesList.push(bytes[p + i]);
    p += internalBytes;

    for (let i = 0; i < Math.pow(2, tdepth); ++i) {
      tpredsList.push(view.getFloat32(p, true));
      p += 4;
    }

    threshList.push(view.getFloat32(p, true));
    p += 4;
  }

  const tcodes = new Int8Array(tcodesList);
  const tpreds = new Float32Array(tpredsList);
  const thresh = new Float32Array(threshList);
  const pow2tdepth = Math.pow(2, tdepth) >> 0;

  return (r, c, s, pixels, ldim) => {
    let rr = 256 * r;
    let cc = 256 * c;
    let root = 0;
    let o = 0.0;

    for (let i = 0; i < ntrees; ++i) {
      let idx = 1;
      for (let j = 0; j < tdepth; ++j) {
        const a = ((rr + tcodes[root + 4 * idx + 0] * s) >> 8) * ldim + ((cc + tcodes[root + 4 * idx + 1] * s) >> 8);
        const b = ((rr + tcodes[root + 4 * idx + 2] * s) >> 8) * ldim + ((cc + tcodes[root + 4 * idx + 3] * s) >> 8);
        idx = 2 * idx + (pixels[a] <= pixels[b] ? 1 : 0);
      }

      o += tpreds[pow2tdepth * i + idx - pow2tdepth];
      if (o <= thresh[i]) return -1;
      root += 4 * pow2tdepth;
    }

    return o - thresh[ntrees - 1];
  };
}

/** Jalankan cascade pada satu frame grayscale. */
export function runCascade(image: FaceImage, classifyRegion: CascadeClassifier, params: CascadeParams): Detection[] {
  const { pixels, nrows, ncols, ldim } = image;
  const { shiftfactor, minsize, maxsize, scalefactor } = params;

  let scale = minsize;
  const detections: Detection[] = [];

  while (scale <= maxsize) {
    const step = Math.max(shiftfactor * scale, 1) >> 0;
    const offset = (scale / 2 + 1) >> 0;

    for (let r = offset; r <= nrows - offset; r += step) {
      for (let c = offset; c <= ncols - offset; c += step) {
        const score = classifyRegion(r, c, scale, pixels, ldim);
        if (score > 0.0) detections.push([r, c, scale, score]);
      }
    }

    scale *= scalefactor;
  }

  return detections;
}

/** Non-maximum suppression untuk menggabungkan deteksi yang bertumpuk. */
export function clusterDetections(detections: Detection[], iouThreshold: number): Detection[] {
  const dets = detections.slice().sort((a, b) => b[3] - a[3]);

  const calculateIou = (det1: Detection, det2: Detection) => {
    const r1 = det1[0], c1 = det1[1], s1 = det1[2];
    const r2 = det2[0], c2 = det2[1], s2 = det2[2];
    const overR = Math.max(0, Math.min(r1 + s1 / 2, r2 + s2 / 2) - Math.max(r1 - s1 / 2, r2 - s2 / 2));
    const overC = Math.max(0, Math.min(c1 + s1 / 2, c2 + s2 / 2) - Math.max(c1 - s1 / 2, c2 - s2 / 2));
    return (overR * overC) / (s1 * s1 + s2 * s2 - overR * overC);
  };

  const assignments = new Array(dets.length).fill(0);
  const clusters: Detection[] = [];

  for (let i = 0; i < dets.length; ++i) {
    if (assignments[i] !== 0) continue;

    let r = 0.0, c = 0.0, s = 0.0, q = 0.0, n = 0;
    for (let j = i; j < dets.length; ++j) {
      if (calculateIou(dets[i], dets[j]) > iouThreshold) {
        assignments[j] = 1;
        r += dets[j][0];
        c += dets[j][1];
        s += dets[j][2];
        q += dets[j][3];
        n += 1;
      }
    }

    clusters.push([r / n, c / n, s / n, q]);
  }

  return clusters;
}
