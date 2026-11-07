# GALSURKU Clipper

Editor video ringan untuk Windows, untuk mengedit rekaman vertikal dari OBS jadi video TikTok dan YouTube Shorts. Ada subtitle otomatis Bahasa Indonesia yang jalan offline.

## Pasang
Buka tab **Releases** di repo ini, unduh `GALSURKU Clipper_..._x64-setup.exe`, lalu jalankan. Kalau muncul "Windows protected your PC", klik **More info → Run anyway**.

## Cara pakai
1. **Proyek baru**: pilih rekaman, atau tarik file dari folder OBS ke jendela.
2. **Potong**: geser playhead, tekan **Ctrl+B** untuk split, pilih bagian yang tidak dipakai, tekan **Delete**. Potongan otomatis merapat.
3. **Subtitle**: buka tab **Subtitle**, unduh model sekali (148 MB atau 488 MB), lalu klik **Buat subtitle otomatis**. Pilih gaya **Kata menyala** atau **Per kalimat**. Klik baris untuk mengoreksi.
4. **Teks**: tab **Teks**, pilih gaya, ketik, lalu geser posisinya di preview.
5. **Ekspor**: tombol **Ekspor** di kanan atas. Hasil 1080×1920 MP4 di `Videos\GALSURKU Clipper`.

| Tombol | Fungsi |
| --- | --- |
| Spasi | putar / jeda |
| Ctrl+B | split di playhead |
| Delete | hapus yang dipilih |
| Ctrl+Z / Ctrl+Y | urungkan / ulangi |
| ← / → | 1 frame (Shift: 1 detik) |
| Ctrl + scroll | zoom timeline |

## Catatan
- Subtitle diproses di PC ini dengan whisper.cpp; tidak ada yang dikirim ke internet selain unduhan model sekali.
- Emoji belum ikut di video hasil ekspor.
- FFmpeg (build GPL BtbN) dan whisper.cpp ikut dibundel.
