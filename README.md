# GALSURKU Clipper

Aplikasi Windows ringan untuk memotong rekaman live jadi video vertikal 9:16 untuk TikTok dan YouTube Shorts.

## Pasang
Buka tab **Releases** di repo ini, unduh file `GALSURKU Clipper_..._x64-setup.exe`, lalu jalankan.

## Cara pakai
1. Klik **Import rekaman live**, atau tarik file MP4/MKV dari OBS ke jendela.
2. Putar rekamannya. Gelombang suara di timeline menunjukkan momen ramai.
3. Tekan **I** di awal momen, **O** di akhirnya, lalu **Enter**. Klip jadi.
4. Pilih layout **Crop** atau **Facecam + game**, lalu geser kotaknya langsung di video.
5. Tulis judul kalau perlu, pilih TikTok atau YouTube Shorts, lalu klik **Ekspor**.

Hasil tersimpan di `Videos\GALSURKU Clipper`. Ekspor otomatis memakai GPU (NVIDIA, Intel, atau AMD) kalau ada.

| Tombol | Fungsi |
| --- | --- |
| Spasi | putar / jeda |
| I / O | tandai awal / akhir |
| Enter | buat klip |
| J / L | mundur / maju 5 detik |
| ← / → | 1 detik (Shift: 1 frame) |
| Esc | hapus tanda |
| Delete | hapus klip terpilih |
| Scroll di timeline | zoom; Shift + scroll untuk geser |

## Catatan
- File MKV dari OBS disalin sekali ke MP4 di folder yang sama (tanpa encode ulang), supaya bisa diputar.
- Emoji di judul belum ikut ke video hasil ekspor.
- FFmpeg dibundel dari build GPL BtbN.
