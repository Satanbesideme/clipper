# Arsitektur: GALSURKU Clipper (nama sementara)

Aplikasi desktop Windows untuk memotong rekaman live jadi shorts 9:16.
Semua jalan lokal: tanpa akun, tanpa server, tanpa cloud.

## Stack

| lapisan | pilihan | kenapa |
| --- | --- | --- |
| shell aplikasi | **Tauri 2** (Rust + WebView2 bawaan Windows) | installer ±10 MB dan RAM jauh lebih kecil dari Electron, sesuai syarat "ringan" |
| UI | **React + TypeScript + Vite** | ekosistem besar, mudah diubah |
| styling | **Tailwind**, token dari /replica-design | konsisten, gampang ganti tema |
| mesin video | **FFmpeg** (dibundel sebagai sidecar) | potong, crop, susun layout, burn subtitle, encode; sudah teruji |
| encode GPU | NVENC (NVIDIA) / QSV (Intel) / AMF (AMD), otomatis dideteksi, cadangan libx264 | ekspor cepat tanpa bikin PC panas |
| subtitle otomatis | **whisper.cpp** sidecar, model `small` multibahasa (Bahasa Indonesia) | offline, gratis, jalan di CPU; model lebih besar opsional |
| database | **SQLite** (via `rusqlite`), satu file di folder data app | proyek dan klip tersimpan, tanpa server |
| file kerja | folder cache per proyek: proxy, thumbnail, waveform | bisa dihapus kapan saja, dibuat ulang otomatis |

Tidak ada auth, pembayaran, email, atau hosting. Tidak perlu untuk alat pribadi.

## Cara kerja inti (kenapa tetap ringan untuk VOD 4 jam)

1. **Import**: file asli tidak pernah disalin atau di-decode penuh.
   - MKV dari OBS di-*remux* ke MP4 (stream copy, tanpa encode ulang, beberapa detik), supaya bisa diputar di WebView2.
   - Di latar belakang FFmpeg membuat: strip thumbnail (1 per 10 detik), data waveform audio (peak per 100 ms), dan proxy 540p untuk scrub mulus.
2. **Pemindai & editor**: preview memutar proxy. Layout 9:16 di-preview pakai CSS (crop + susun dua elemen video), jadi tidak ada render saat mengedit.
3. **Ekspor**: baru di sini FFmpeg membaca file asli dan merender sekali dengan satu `filter_complex`:
   `trim → crop gameplay + crop facecam → scale → vstack → subtitle (ASS) → overlay watermark → encode GPU`.

## Schema (SQLite)

Lihat `schema.sql`. Ringkas:

| tabel | isi |
| --- | --- |
| `projects` | satu VOD: path, durasi, fps, resolusi, status cache |
| `clips` | potongan dari VOD: in/out (ms), judul, layout |
| `layouts` | preset layout: crop tunggal atau split facecam+gameplay |
| `text_items` | judul dan baris subtitle per klip |
| `export_jobs` | antrean ekspor: preset, status, progres, path hasil |
| `settings` | key/value: watermark, folder default, preset default |

Aturan akses: tidak perlu, satu pengguna lokal. Semua waktu disimpan sebagai milidetik integer dari awal VOD; tanggal sebagai ISO-8601 UTC.

## Perintah (pengganti API)

Tauri `invoke` dari UI ke Rust:

| perintah | fungsi | input | output | alur |
| --- | --- | --- | --- | --- |
| `project_import` | buat proyek dari file VOD, mulai remux & cache | path | project | F01 |
| `project_list` / `project_open` / `project_delete` | kelola proyek | id | project(s) | F05 |
| `cache_status` | progres thumbnail/waveform/proxy | project_id | persen per jenis | F01 |
| `waveform_get` | data peak audio untuk rentang | project_id, from, to | array | F01, F02 |
| `clip_create` / `clip_update` / `clip_delete` | kelola klip | data klip | clip | F01, F02 |
| `layout_list` / `layout_save` | preset layout | layout | layout(s) | F03 |
| `text_save` | judul & subtitle | clip_id, items | items | F01, F04 |
| `captions_generate` | jalankan whisper.cpp pada audio klip | clip_id, bahasa | baris subtitle | F04 |
| `export_enqueue` | tambah klip ke antrean | clip_ids, preset | jobs | F01, F02 |
| `export_cancel` | batalkan job | job_id | — | F02 |
| `settings_get` / `settings_set` | pengaturan | key, value | — | — |

Event dari Rust ke UI: `cache://progress`, `export://progress`, `captions://progress`.

Pekerjaan latar: satu antrean FFmpeg (maks 1 ekspor jalan bersamaan, sisanya menunggu) supaya PC tetap enak dipakai.

## Bagian yang rawan

- **Ukuran file**: VOD bisa 10–30 GB. Jangan pernah membaca seluruhnya ke memori; semua lewat FFmpeg dengan seek.
- **Track audio ganda dari OBS**: mic dan game bisa terpisah. Saat import, deteksi jumlah track; subtitle pakai track mic kalau ada.
- **VFR (frame rate berubah-ubah)**: rekaman OBS kadang VFR. Ekspor dipaksa CFR 30/60 agar sinkron di TikTok/Shorts.
- **Akurasi potong**: seek cepat FFmpeg bisa meleset ke keyframe. Ekspor selalu decode ulang dari keyframe sebelum titik in, jadi potongan presisi.
- **Encoder GPU tidak tersedia / driver lama**: uji encoder saat start, jatuh ke libx264 kalau gagal.
- **Subtitle**: suara game menutupi mic; whisper bisa salah. Selalu ada layar koreksi sebelum ekspor.
- **Path Windows**: nama folder dengan spasi atau karakter non-ASCII; semua argumen FFmpeg dikirim sebagai array, bukan string.

## Urutan pembangunan

1. **Irisan vertikal** (S02, S03, S04 sederhana, S07)
   Import VOD → tandai satu in/out → layout crop tengah 9:16 → ekspor MP4. Jelek tapi jalan. Tabel: `projects`, `clips`, `export_jobs`.
2. **Must-have**: thumbnail + waveform di S03, banyak klip, trim/split di S04, layout split facecam (S05), judul (S06), preset ekspor.
3. **Should-have**: antrean ekspor (S08), subtitle manual lalu otomatis (S06), gaya subtitle per kata, watermark GALSURKU, audio/lagu sendiri, simpan proyek (S01, S09).
4. **Could-have**: zoom keyframe, deteksi highlight dari lonjakan audio, unggah langsung via API resmi TikTok/YouTube.
5. **Perbaikan** dari /replica-entrepreneur, kalau dijalankan.
