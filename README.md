# Gals Clip Studio

Editor video ringan untuk Windows, untuk mengedit rekaman vertikal dari OBS jadi video TikTok dan YouTube Shorts. Ada subtitle otomatis Bahasa Indonesia yang jalan offline.

## Pasang
Buka tab **Releases** di repo ini, unduh `Gals Clip Studio_..._x64-setup.exe`, lalu jalankan. Kalau muncul "Windows protected your PC", klik **More info → Run anyway**.

## Cara pakai
1. **Proyek baru**: klik **+** di halaman awal, lalu pilih **Dari video** (rekaman OBS / video yang sudah ada) atau **Kanvas kosong** (pilih bentuk 9:16/16:9/1:1/4:5, resolusi FHD/2K/4K, fps, dan warna latar; panjangnya mengikuti isi, tanpa batas). Bisa juga tarik file video ke jendela.
2. **Potong**: geser playhead, tekan **Ctrl+B** untuk split, pilih bagian yang tidak dipakai, tekan **Delete**. Potongan otomatis merapat.
3. **Subtitle**: buka tab **Subtitle**, unduh model sekali (148 MB atau 488 MB), lalu klik **Buat subtitle otomatis**. Pilih gaya **Kata menyala** atau **Per kalimat**. Klik baris untuk mengoreksi.
4. **Suara (soundboard)**: tab **Suara**. Pause di momennya, pencet pad atau angka **1–9**, lalu lanjut putar. Tarik file MP3/WAV/OGG ke jendela untuk menambah.
5. **Meme**: tab **Meme**. Klik gambar atau **Shift+1–9** untuk memasang meme di playhead, lengkap dengan animasi masuk/keluar (Pop, Fade, Geser). Klik **Atur** untuk mengubah default tiap meme.
6. **Zoom (punch-in)**: pilih potongan video, atur **Zoom** di panel kanan, geser preview untuk mengarahkan.
7. **Transisi**: klik penanda kotak di sambungan antar potongan (atau pilih potongan), lalu pilih Punch, Guncang, Kilat, Blur cepat, atau Gelap. Zoom sebuah potongan otomatis memasang Punch.
8. **Musik latar**: tab **Musik → Tambah musik latar**. Semua lagu di timeline tampil di panel itu: dengarkan, atur volume, auto-ducking (Ringan/Sedang/Kuat), mulai di playhead. Lagu yang pernah dipakai tersimpan di **Pernah dipakai** untuk dipasang lagi.
9. **Hapus jeda**: tombol **Hapus jeda** di atas timeline memotong semua bagian diam sekaligus. Ctrl+Z untuk membatalkan.
10. **Teks**: tab **Teks**, pilih gaya, ketik, lalu geser posisinya di preview.
11. **Ekspor**: tombol **Ekspor** di kanan atas. Hasil 1080×1920 MP4 di `Videos\Gals Clip Studio`.

| Tombol | Fungsi |
| --- | --- |
| Spasi | putar / jeda |
| Ctrl+B | split di playhead |
| Delete | hapus yang dipilih |
| Ctrl+Z / Ctrl+Y | urungkan / ulangi |
| ← / → | 1 frame (Shift: 1 detik) |
| 1–9 | pasang suara di playhead |
| Shift + 1–9 | pasang meme di playhead |
| Ctrl + scroll | zoom timeline (di atas gambar di preview: ubah ukuran) |
| Ctrl/Shift + klik | pilih beberapa item di timeline |
| Ctrl+A | pilih semua item (kecuali potongan video) |

## Pilih banyak sekaligus
Di timeline, tarik kotak dari area kosong untuk memilih semua yang kena kotak (subtitle, meme, suara, teks, layer, musik), atau Ctrl/Shift+klik satu per satu. Tarik salah satu yang terpilih untuk menggeser semuanya maju-mundur bersamaan, atau pakai tombol geser di panel kanan. Delete menghapus semuanya. Esc membatalkan pilihan.

## Tata letak
Panel kiri dan kanan bisa dilebarkan dengan menarik tepinya (klik dua kali untuk ukuran bawaan), dan disembunyikan dengan tombol di kanan atas. Klik ikon tab yang sedang aktif di rail kiri juga melipat panel kiri. Saat jendela dikecilkan, panel ikut menyesuaikan supaya preview tetap terlihat.

## Stop preview suara
Saat mendengarkan suara soundboard atau musik, bar kecil muncul di bawah panel kiri dengan tombol **Stop**. Klik tombol putar yang sama sekali lagi, tekan **Esc**, atau putar timeline juga menghentikannya.

## Volume suara
Suara soundboard dan video meme dipasang dengan volume 25% supaya tidak menutupi suaramu. Ubah bawaannya lewat **Volume saat ditempel** di panel Suara / Video meme; tiap suara yang sudah dipasang tetap bisa dibesarkan di panel kanan.

## Kanvas
Tombol format di bawah preview (mis. `9:16 · FHD · 30`) atau **Ctrl+Alt+C**: pilih bentuk **9:16** (Shorts/TikTok), **16:9** (YouTube), **1:1**, **4:5**, resolusi **FHD / 2K / 4K**, dan 30/60 fps. Teks, subtitle, meme, dan layer ikut menyesuaikan.

## Warna (color grading)
Tab **Warna** (atau **Ctrl+U**). Klik satu potongan/layer untuk mengatur sendiri; kalau tidak ada yang dipilih, semua potongan video utama ikut berubah.
- **Look**: Natural, Vivid, Cinematic, Gaming Pop, Warm, Cool, Moody, Film, B&W, dengan pratinjau dari frame yang sedang tampil.
- **Cahaya**: Exposure, Kontras, Highlight, Shadow, Fade. **Warna**: Suhu, Tint, Saturasi, Vibrance. **Detail**: Sharpness, Vignette.
- **LUT .cube dan .3dl** (dari Premiere, Resolve, CapCut, paket LUT apa pun) dengan slider kekuatan, untuk video utama, layer, video meme, dan meme. LUT yang pernah dipakai tersimpan.
- **Bandingkan**: tahan tombolnya (atau tahan **\\**) untuk melihat tanpa warna. Klik kanan video → **Salin warna / Tempel warna**.

## Shortcut ala Photoshop
| Tombol | Fungsi |
| --- | --- |
| Ctrl+T | Transform (Enter selesai, Esc batal) |
| C | Crop |
| Ctrl+U | Warna |
| Ctrl+J | Duplikat |
| Ctrl+[ / Ctrl+] | Layer ke belakang / depan (Shift: paling) |
| Ctrl+S | Simpan + salinan versi |
| Ctrl+E | Ekspor |
| Ctrl+Alt+C | Ukuran kanvas |
| Ctrl+0 | Muat seluruh timeline |

Klik kanan di timeline **atau langsung di preview** membuka menu: Transform, Crop, Warna, Salin, Tempel, Duplikat, fade suara, urutan layer, split, hapus.

## AI Asisten (offline, di PC sendiri)
Tab **AI** di rel kiri. Unduh model sekali (Super ±5 GB untuk kartu grafis 8 GB seperti RTX 4060 Ti, Pintar ±2,5 GB, atau Cepat ±1,1 GB; model Qwen3 berlisensi Apache 2.0), lalu semuanya jalan tanpa internet lewat llama.cpp versi Vulkan, jadi memakai kartu grafis kalau ada. Rekaman tidak dikirim ke mana pun.
- **Cari momen seru**: mendengarkan teriakan/tawa dan membaca kata seru di subtitle, lalu AI menilai dan memberi judul tiap momen. Satu klik untuk jadikan In/Out (lalu ekspor bagian itu) atau marker.
- **Judul, deskripsi & hashtag**: 5 pilihan judul dari isi subtitle.
- **Koreksi subtitle**: membetulkan kata salah dengar; kamu pilih mana yang dipakai.
- **Thumbnail**: memilih frame paling tajam & berwarna, judul besar dengan gaya gaming, 16:9 atau 9:16, simpan PNG.

## Ala Photoshop
- **Panel Layer**: semua objek (teks, subtitle, meme, layer video, adjustment, video utama) dengan mata (sembunyikan), gembok (kunci), ganti nama (klik dua kali), duplikat, hapus, seret untuk urutan, dan grup (Ctrl+G, lepas: Ctrl+Shift+G).
- **Adjustment layer**: atur warna semua yang ada di bawahnya, termasuk Levels, Curves, Hue/Saturation, Color Balance, dan LUT. Kekuatannya bisa diatur.
- **Transform lanjutan**: rotasi, flip, titik anchor, dan distort/perspektif (tarik 4 sudut di preview).
- **Mask**: kotak atau elips dengan feather, bisa dibalik, dan muncul bertahap (wipe). Ada juga **green screen** (chroma key) dengan pengambil warna dari preview.
- **Blending modes**: Multiply, Screen, Overlay, Soft Light, Add, Darken, Lighten, Difference.
- **Typography studio**: spasi huruf, tinggi baris, warna & tebal garis tepi, bayangan, teks gradasi, miring, dan preset teks sendiri.

## Lain-lain
- **Tempel gambar dari web**: di browser klik kanan gambar → Copy image (atau salin link .gif/.png), lalu di aplikasi tekan Ctrl+V. Gambar/GIF dipasang di playhead dan disimpan di library Meme (kategori Tempel). Bisa juga lewat klik kanan timeline → Tempel gambar dari web.
- **GIF bergerak** di preview, dan berulang terus selama tampil di hasil ekspor (juga GIF yang aslinya cuma main sekali).
- Reverse video (klik kanan potongan → Putar mundur).
- Ekspor: ketik nama file sendiri (kosong = nama proyek) dan pilih format MP4, MKV, MOV, atau WEBM.
- Auto emoji di subtitle dan tombol "Rapikan timing kata".

## Shortcut ala Premiere
| Tombol | Fungsi |
|---|---|
| J / K / L | Putar mundur / stop / maju. Tekan lagi untuk 2×, 4×, 8× |
| M | Tambah marker di playhead (M lagi di tempat yang sama: ganti nama) |
| Shift + M / Ctrl + Shift + M | Loncat ke marker berikut / sebelumnya |
| I / O | Set titik In / Out (Shift + I / O: loncat ke sana) |
| Ctrl + Shift + X | Hapus In/Out |
| Q / W | Buang bagian potongan dari awal sampai playhead (Q) atau dari playhead sampai akhir (W), celahnya langsung tertutup |

Klik kanan di penggaris waktu untuk menu marker (ganti nama, warna, hapus) dan In/Out. Kalau In/Out dipasang, panel Ekspor bisa mengekspor bagian itu saja. Marker bisa disalin sebagai **chapter YouTube** (`0:00 Intro`, `1:05 Boss`, …) untuk deskripsi video. Video, musik, dan suara di timeline menampilkan gelombang suara.

## Ekspor = persis preview
Subtitle dan teks di video hasil ekspor digambar oleh aplikasi sendiri, dengan kode yang sama dengan preview: font, baris, posisi, ukuran, dan animasinya sama persis. Suara juga tidak lagi maju sedikit dibanding gambar pada rekaman yang audionya mulai sedikit terlambat.

## Salin & tempel
Pilih item di timeline lalu **Ctrl+C**, **Ctrl+V** (tempel di playhead), **Ctrl+Shift+V** (tempel di waktu aslinya), **Ctrl+X** (potong), atau **Ctrl+D** (duplikat). Klik kanan di timeline membuka menu yang sama, plus Transform, Crop, fade suara, split, dan hapus.

Potongan video utama yang disalin ditempel sebagai **layer baru di waktu yang sama**, jadi video yang sama bisa tampil di dua tempat (misalnya gameplay di atas, facecam di bawah). Atur lewat tab **Transform** dan **Crop**.

## Transform & Crop
Klik video, layer, meme, atau teks, lalu **Ctrl+T** atau tab **Transform** (posisi, ukuran, opacity, posisi cepat). Mode **Crop** (tombol **C**) ada di tab yang sama: (bentuk 9:16/1:1/16:9, ambil bagian atas/bawah/kiri/kanan, potong per sisi, atau tarik kotak kuning di preview). Video utama selalu mengisi layar; untuk meng-crop-nya, salin dulu jadi layer.

## Fade suara
Pilih potongan video, suara, musik, atau layer video, lalu tarik **titik putih** di pojok atas kotaknya di timeline, atau atur slider **Fade suara** di panel kanan. Klik kanan juga punya Fade in/out 0,5 detik.

## Stinger
Tab **Media → Stinger GALSURKU → Pasang di awal**: intro 1,9 detik (1080×1920, dengan suara) dipasang sebelum video, dan semua subtitle, meme, serta suara ikut bergeser. **Simpan file** menyalin MP4-nya ke folder ekspor.

## Layer video
Panel **Layer** (rail kiri). Setiap layer bisa digeser, di-resize (tarik pojok, Shift untuk bebas), diregang (tarik sisi), dan di-crop (tombol **C** atau tab Crop, Enter untuk selesai).
- **Layer dari video utama** mengikuti potongan, speed, dan hapus jeda video utama.
- **Layer dari video lain**: file lain dengan waktu dan volume sendiri.
- Posisi cepat (Penuh, Setengah atas/bawah) mengisi area dengan zoom, tidak gepeng.

## Video meme
Panel **Video meme**: tambah klip reaksi (MP4/MOV/WebM/MKV) atau impor satu folder. Klik untuk review, **Pasang di playhead** (atau klik dua kali / Alt+1–9) untuk menaruhnya sebagai layer bersuara.

## Animasi teks
Pilih teks, lalu di panel kanan pilih **Pop**, **Fade**, **Naik**, **Ketik**, atau **Goyang**. Teks baru otomatis memakai Pop.

Subtitle punya **Template** (Minimal, Kinetic, Documentary, Gaming, Podcast) yang memasang font, warna, mode, animasi, dan posisi sekaligus. Animasinya juga bisa diatur di **Subtitle → Animasi**: Pop, Fade, Naik, Goyang (per baris), **Per kata** (kata muncul satu per satu), dan **Memantul** (kata yang diucapkan membesar sebentar). Ini berlaku untuk semua baris.

Untuk bagian tertentu, klik baris subtitle-nya, lalu di panel kanan:
- **Animasi baris ini**: animasi khusus baris itu saja. **Umum** = ikut animasi semua.
- **Gaya per kata**: klik kata (Ctrl/Shift+klik untuk beberapa), lalu pilih **Pop**, **Besar**, atau **Teriak** (besar, menghentak, merah), dan warna sendiri. Cocok untuk kata yang diteriakkan.
Baris yang punya gaya sendiri ditandai ✦ di daftar subtitle.

## Autosave & riwayat versi
Proyek tersimpan otomatis setiap ada perubahan (lihat "Tersimpan" di kanan atas). Salinan versi dibuat tiap 3 menit, saat proyek dibuka, dan sebelum hapus jeda atau buat subtitle. Pulihkan dari panel kanan (klik area kosong di timeline) → **Riwayat versi**.

## Library
Suara, meme, dan video meme tidak dibatasi jumlahnya. Pakai kolom cari, kategori (nama folder saat impor folder), dan favorit ★.

## Watermark
Klik area kosong di timeline, lalu di panel kanan pilih **+ Pasang logo**. Atur pojok, ukuran, dan transparansi. Centang **Pasang otomatis di proyek baru** agar logo GALSURKU selalu ikut.

## Catatan
- Subtitle diproses di PC ini dengan whisper.cpp; tidak ada yang dikirim ke internet selain unduhan model sekali.
- Emoji belum ikut di video hasil ekspor.
- Efek bawaan (Ding, Boing, Whoosh, dll.) dibuat dari nol untuk aplikasi ini. Isi library lainnya dari file milikmu sendiri.
- GIF tampil diam di preview, tapi bergerak di hasil ekspor.
- FFmpeg (build GPL BtbN) dan whisper.cpp ikut dibundel.
