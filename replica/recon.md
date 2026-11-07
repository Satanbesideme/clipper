# Recon map: CapCut (desktop + web)

Scope: alur "rekaman live panjang → klip vertikal 9:16 → TikTok & YouTube Shorts"
For: pemakaian sendiri, memotong VOD live GALSURKU jadi shorts
Date: 2026-11-07

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing site (fitur desktop) | https://www.capcut.com/tools/desktop-ai-power | daftar fitur AI: auto reframe, auto captions, scene detection |
| 2 | panduan resmi pakai di PC | https://www.capcut.com/resource/how-to-use-capcut-on-pc | tata letak editor, alur import → split → reframe → teks → export |
| 3 | perbandingan Standard vs Pro | https://capcut.com/resource/capcut-standard-vs-pro | auto captions khusus Pro, cloud gratis dihapus |
| 4 | help center ekspor | https://www.capcut.com/help/export-videos-in-capcut | opsi resolusi ekspor |
| 5 | help center harga | https://www.capcut.com/help/capcut-pro-price | kenaikan harga Pro |

Sumber yang belum dipakai: akun CapCut milikmu sendiri (bisa dicek bareng nanti), video walkthrough publik.

## Core loop

Ambil satu momen dari rekaman live, jadikan video 9:16 dengan layout dan teks yang enak dilihat, lalu ekspor siap unggah.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Beranda / proyek | buka app | daftar proyek, mulai proyek baru | kartu proyek, tombol Import | kosong, ada isi |
| S02 | Import | S01 → Import | pilih file VOD dari disk | pemilih file, info file | memuat, error format |
| S03 | Pemindai VOD | setelah import | jelajahi VOD panjang, tandai momen | timeline panjang, thumbnail, gelombang audio, penanda in/out, daftar klip | kosong, ada penanda |
| S04 | Editor klip | klik klip di S03 | edit satu klip 9:16 | preview 9:16, timeline klip, tombol split, panel kanan | idle, memutar, terpilih |
| S05 | Panel layout | S04 → Layout | atur crop/reframe | pilihan layout, kotak crop yang bisa digeser | crop, split facecam |
| S06 | Panel teks & subtitle | S04 → Teks / Subtitle | judul, subtitle manual/otomatis | editor teks, gaya, daftar baris subtitle | kosong, memproses, selesai |
| S07 | Dialog ekspor | S04 → Export | atur file keluaran | nama, lokasi, resolusi, fps, bitrate, format | default, preset |
| S08 | Antrean ekspor | setelah S07 | progres ekspor beberapa klip | daftar job, progress bar | antre, jalan, selesai, gagal |
| S09 | Pengaturan | menu | folder default, watermark, preset | form | — |

## Flows

```
F01 Satu momen live jadi satu short
    S01 -> S02 -> S03 (tandai in/out) -> S04 -> S05 (layout) -> S06 (judul) -> S07 -> S08
    happy path clicks: ±12 di CapCut (split manual 2x, hapus sisa, atur rasio, crop, teks, export)
    target klon: ±7
    edge: VOD 4 jam, file MKV, audio dua track (mic + game), VOD 60fps

F02 Banyak highlight dari satu VOD, ekspor sekaligus
    S03 (tandai 5-10 klip) -> S04 per klip -> S07 -> S08 (antrean)
    edge: dua klip saling tumpang tindih, satu ekspor gagal

F03 Layout facecam + gameplay
    S04 -> S05 pilih "split" -> atur kotak facecam dan kotak gameplay
    edge: facecam berpindah posisi di tengah stream

F04 Subtitle otomatis
    S04 -> S06 -> generate (Bahasa Indonesia) -> koreksi baris -> pilih gaya
    edge: suara game menutupi suara mic, campur bahasa Inggris

F05 Lanjut edit nanti
    S01 -> buka proyek -> S03/S04 apa adanya
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ikon | default, hover, disabled, loading | semua |
| Timeline | VOD panjang, klip pendek | zoom, scrub, terpilih | S03, S04 |
| Penanda in/out | — | aktif, tumpang tindih | S03 |
| Preview player | 16:9 sumber, 9:16 hasil | memutar, jeda | S03, S04 |
| Kotak crop | tunggal, ganda (split) | geser, ubah ukuran | S05 |
| Editor teks | judul, subtitle | edit, gaya | S06 |
| Progress bar | — | jalan, selesai, gagal | S02, S06, S08 |
| Toast | info, error | — | semua |

## Inferred data model

```
Project   id, name, source_path, duration, fps, width, height, created_at
          evidence: S01 daftar proyek, S02 info file · confidence: high
Clip      id, project_id, in_ms, out_ms, title, layout_id, status
          evidence: S03 penanda, S04 · confidence: high
Layout    id, type (crop | split), crop_main {x,y,w,h}, crop_cam {x,y,w,h}, cam_position (top | bottom)
          evidence: S05 · confidence: medium (tebakan, CapCut pakai layer bebas)
TextItem  id, clip_id, kind (title | caption), text, start_ms, end_ms, style
          evidence: S06 · confidence: high
ExportJob id, clip_id, preset (tiktok | shorts | custom), fps, bitrate, out_path, status, progress
          evidence: S07, S08 · confidence: high
Settings  watermark_path, watermark_pos, default_out_dir, default_preset
          evidence: S09 · confidence: medium (tebakan)
```

## What cannot be cloned

- Pustaka musik, efek suara, stiker dan font milik CapCut (berlisensi) → pakai file sendiri dan font open source.
- Template komunitas dan akun pengguna CapCut.
- Fitur AI generatif berbasis cloud (Script to Video, AI Presenter).
- Kode, ikon, logo dan teks antarmuka CapCut. Semua dibuat ulang dari nol.

## Size

- 9 layar, 5 alur, 6 entitas.
- Bagian tersulit:
  1. Membuka dan scrub VOD berjam-jam dengan lancar di PC tanpa makan RAM besar.
  2. Render 9:16 dengan layout split facecam + gameplay, cepat (encode pakai GPU kalau ada).
  3. Subtitle otomatis Bahasa Indonesia yang jalan lokal tanpa bikin PC berat.
- Ukuran: **M** (beberapa minggu kerja untuk semua must + should). Versi pertama yang bisa dipakai (F01 + F03 tanpa subtitle otomatis): S, sekitar akhir pekan.
