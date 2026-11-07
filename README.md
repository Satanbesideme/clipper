# GALSURKU Clipper

Editor video ringan untuk Windows, untuk mengedit rekaman vertikal dari OBS jadi video TikTok dan YouTube Shorts. Ada subtitle otomatis Bahasa Indonesia yang jalan offline.

## Pasang
Buka tab **Releases** di repo ini, unduh `GALSURKU Clipper_..._x64-setup.exe`, lalu jalankan. Kalau muncul "Windows protected your PC", klik **More info → Run anyway**.

## Cara pakai
1. **Proyek baru**: pilih rekaman, atau tarik file dari folder OBS ke jendela.
2. **Potong**: geser playhead, tekan **Ctrl+B** untuk split, pilih bagian yang tidak dipakai, tekan **Delete**. Potongan otomatis merapat.
3. **Subtitle**: buka tab **Subtitle**, unduh model sekali (148 MB atau 488 MB), lalu klik **Buat subtitle otomatis**. Pilih gaya **Kata menyala** atau **Per kalimat**. Klik baris untuk mengoreksi.
4. **Soundboard**: tab **Soundboard**. Saat memutar, pause di momennya, pencet pad atau angka **1–9**, lalu lanjut putar. Tarik file suara (MP3/WAV/OGG) atau gambar (PNG/JPG/GIF) ke jendela untuk menambah ke library. Klik **Atur** untuk menggabungkan suara + gambar jadi combo meme, mengganti nama, warna, dan urutan tombol.
5. **Teks**: tab **Teks**, pilih gaya, ketik, lalu geser posisinya di preview.
6. **Ekspor**: tombol **Ekspor** di kanan atas. Hasil 1080×1920 MP4 di `Videos\GALSURKU Clipper`.

| Tombol | Fungsi |
| --- | --- |
| Spasi | putar / jeda |
| Ctrl+B | split di playhead |
| Delete | hapus yang dipilih |
| Ctrl+Z / Ctrl+Y | urungkan / ulangi |
| ← / → | 1 frame (Shift: 1 detik) |
| 1–9 | pasang pad soundboard di playhead |
| Ctrl + scroll | zoom timeline (di atas gambar di preview: ubah ukuran) |

## Catatan
- Subtitle diproses di PC ini dengan whisper.cpp; tidak ada yang dikirim ke internet selain unduhan model sekali.
- Emoji belum ikut di video hasil ekspor.
- Efek bawaan (Ding, Boing, Whoosh, dll.) dibuat dari nol untuk aplikasi ini. Isi library lainnya dari file milikmu sendiri.
- GIF tampil diam di preview, tapi bergerak di hasil ekspor.
- FFmpeg (build GPL BtbN) dan whisper.cpp ikut dibundel.
