# Gals Clip Studio

Editor video ringan untuk Windows, untuk mengedit rekaman vertikal dari OBS jadi video TikTok dan YouTube Shorts. Ada subtitle otomatis Bahasa Indonesia yang jalan offline.

## Pasang
Buka tab **Releases** di repo ini, unduh `Gals Clip Studio_..._x64-setup.exe`, lalu jalankan. Kalau muncul "Windows protected your PC", klik **More info → Run anyway**.

## Cara pakai
1. **Proyek baru**: pilih rekaman, atau tarik file dari folder OBS ke jendela.
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

## Layer video
Panel **Layer** (rail kiri). Setiap layer bisa digeser, di-resize (tarik pojok, Shift untuk bebas), diregang (tarik sisi), dan di-crop (tombol **C** atau tab Crop, Enter untuk selesai).
- **Pisah atas + bawah dari video utama**: untuk rekaman yang ikut merekam jendela lain. Video yang sama jadi dua layer (misal gameplay di atas, facecam di bawah); bagian yang tidak dipakai hilang.
- **Layer dari video utama** mengikuti potongan, speed, dan hapus jeda video utama.
- **Layer dari video lain**: file lain dengan waktu dan volume sendiri.
- Posisi cepat (Penuh, Setengah atas/bawah) mengisi area dengan zoom, tidak gepeng.

## Video meme
Panel **Video meme**: tambah klip reaksi (MP4/MOV/WebM/MKV) atau impor satu folder. Klik untuk review, **Pasang di playhead** (atau klik dua kali / Alt+1–9) untuk menaruhnya sebagai layer bersuara.

## Animasi teks
Pilih teks, lalu di panel kanan pilih **Pop**, **Fade**, **Naik**, **Ketik**, atau **Goyang**. Teks baru otomatis memakai Pop.

Subtitle punya animasinya sendiri di panel **Subtitle → Animasi**: Pop, Fade, Naik, Goyang (per baris), **Per kata** (kata muncul satu per satu), dan **Memantul** (kata yang diucapkan membesar sebentar). Ini berlaku untuk semua baris.

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
