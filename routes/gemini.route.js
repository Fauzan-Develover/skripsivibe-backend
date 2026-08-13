require("dotenv").config();

const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse'); 

const { GoogleGenerativeAI } = require('@google/generative-ai')
const evaluasiController = require('../controllers/evaluasiController.js');

// Konfigurasi Multer untuk menangkap file PDF dari React di memori
const upload = multer({ storage: multer.memoryStorage() });

// Konfigurasi Gemini (Menggunakan API Key dari .env)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// =========================================================
// 1. ENDPOINT: GENERATE PERTANYAAN DARI PDF (TEXT MODE)
// =========================================================
router.post('/generate-pertanyaan', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ detail: "File harus berupa PDF" });
        
        // 🚀 BACA PDF SECARA LANGSUNG (Tanpa pengecekan yang bikin error)
        const pdfData = await pdfParse(req.file.buffer);
        let teks_skripsi_mentah = pdfData.text;

        if (!teks_skripsi_mentah || !teks_skripsi_mentah.trim()) {
            return res.status(400).json({ detail: "Tidak dapat membaca teks dari PDF ini." });
        }

        // Potong teks agar tidak kepanjangan untuk model gemini-pro (Sekitar 4000 karakter)
        const teks_matang = teks_skripsi_mentah.substring(0, 4000);

        const prompt = `
        Anda adalah Dosen Penguji Sidang Skripsi yang kritis dan analitis. 
        Tugas Anda HANYA memberikan feedback kualitatif (teks). 
        DILARANG KERAS memberikan skor angka (0-100) atau label status kelulusan/pemahaman. Penilaian skor sudah dilakukan oleh sistem AI lain. Fokuslah pada substansi teks, artikulasi, dan logika kalimat.

        Berikut adalah transkrip ucapan mahasiswa selama simulasi:
        
        [TRANSKRIP PRESENTASI AWAL]: 
        "${presentasi_transcript || "Mahasiswa tidak memberikan presentasi verbal."}"
        
        [SESI TANYA JAWAB]:
        [Soal 1]: "${pertanyaan_1}"
        [Jawab 1]: "${jawaban_1 || "-"}"
        
        [Soal 2]: "${pertanyaan_2}"
        [Jawab 2]: "${jawaban_2 || "-"}"
        
        [Soal 3]: "${pertanyaan_3}"
        [Jawab 3]: "${jawaban_3 || "-"}"

        Keluarkan output MURNI DALAM FORMAT JSON berikut (pastikan format ini dipatuhi 100%, jangan gunakan markdown \`\`\`json):
        {
          "qna_summary": {
            "keunggulan": [
              {"aspek": "Presentasi", "detail": "Wajib isi 2 kalimat evaluasi positif KHUSUS untuk [TRANSKRIP PRESENTASI AWAL]. Analisis kerapian struktur kalimat, penguasaan materi di awal, atau ketegasannya."},
              {"aspek": "QnA", "detail": "Wajib isi 2 kalimat evaluasi positif tentang cara mahasiswa menjawab soal secara keseluruhan."}
            ],
            "kelemahan": [
              {"aspek": "Presentasi", "detail": "Wajib isi 2 kalimat kritik tajam KHUSUS untuk [TRANSKRIP PRESENTASI AWAL]. Apakah berbelit-belit, ada kata filler 'eee', atau pembukaan kurang jelas?"},
              {"aspek": "QnA", "detail": "Wajib isi 2 kalimat kritik tajam tentang cara menjawab soal QnA (apakah mengulang jawaban, panik, dsb)."}
            ],
            "strategi": [
              {"aspek": "Presentasi", "detail": "Saran perbaikan konkret khusus untuk performa presentasi awal."},
              {"aspek": "QnA", "detail": "Saran perbaikan konkret khusus untuk sesi tanya jawab."}
            ]
          },
          "evaluasi_qna": [
            {
              "soal": "Tulis ulang Soal 1",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "Kritik khusus untuk Jawab 1 secara detail (minimal 2 kalimat). Walaupun Benar, sebutkan celah atau cara penyampaian yang bisa disempurnakan."
            },
            {
              "soal": "Tulis ulang Soal 2",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "Kritik khusus untuk Jawab 2 secara detail (minimal 2 kalimat). Walaupun Benar, sebutkan celah atau cara penyampaian yang bisa disempurnakan."
            },
            {
              "soal": "Tulis ulang Soal 3",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "Kritik khusus untuk Jawab 3 secara detail (minimal 2 kalimat). Walaupun Benar, sebutkan celah atau cara penyampaian yang bisa disempurnakan."
            }
          ]
        }
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });
        const result = await model.generateContent(prompt);
        let jawaban_teks = result.response.text().trim();

        // PEMBERSIH JSON DARI MARKDOWN
        if (jawaban_teks.includes("```json")) {
            jawaban_teks = jawaban_teks.split("```json")[1].split("```")[0].trim();
        } else if (jawaban_teks.includes("```")) {
            jawaban_teks = jawaban_teks.split("```")[1].split("```")[0].trim();
        }

        const daftar_pertanyaan = JSON.parse(jawaban_teks);

        res.json({
            status: "success",
            message: "Pertanyaan berhasil dibuat.",
            questions: daftar_pertanyaan,
            full_text: "Teks PDF sukses diproses." 
        });

    } catch (error) {
        console.error("Error Generate Pertanyaan:", error);
        res.status(500).json({ detail: "Gagal memproses PDF atau terhubung ke AI." });
    }
});

// =========================================================
// 2. ENDPOINT: EVALUASI QNA (MURNI UNTUK TEKS FEEDBACK)
// =========================================================
router.post('/evaluasi-qna', upload.none(), async (req, res) => {
    try {
        const { presentasi_transcript, pertanyaan_1, jawaban_1, pertanyaan_2, jawaban_2, pertanyaan_3, jawaban_3 } = req.body;

        if (!presentasi_transcript && !jawaban_1 && !jawaban_2 && !jawaban_3) {
            return res.status(400).json({ detail: "Tidak ada data presentasi atau jawaban yang dikirim." });
        }

        // 🔥 PERBAIKAN PROMPT: Memaksa Gemini membahas Presentasi & QnA seimbang
        const prompt = `
        Anda adalah seorang Dosen Penguji Sidang Skripsi yang ahli, berwibawa, kritis, dan "Killer". 
        Anda tidak bisa dikelabui oleh mahasiswa yang hanya pandai menggunakan jargon teknologi/buzzword tanpa memahami esensi logis dari penelitiannya.
        
        ATURAN WAJIB EVALUASI (HARUS DIIKUTI 100%):
        1. Anda WAJIB memberikan porsi evaluasi yang SEIMBANG antara Sesi "Presentasi" dan Sesi "QnA".
        2. Teks presentasi mahasiswa harus dibedah secara mendalam (analisis alur logika, kelengkapan teori, dan penyampaian latar belakang). Jangan abaikan ini!
        3. Pada bagian "qna_summary" (keunggulan, kelemahan, strategi), Anda WAJIB memberikan MINIMAL 2 poin.
           - Poin pertama WAJIB berawalan tag [Presentasi] yang murni membahas detail teknis presentasinya.
           - Poin kedua WAJIB berawalan tag [QnA] yang murni membahas cara dia menjawab pertanyaan.
        4. Jangan berikan pujian palsu. Jika presentasinya hanya berisi omong kosong (Word Salad) tanpa teori teknis, hajar dengan kritik tajam di poin [Presentasi].
        
        Evaluasi data berikut:
        [Transkrip Presentasi Mahasiswa]: ${presentasi_transcript || "Mahasiswa diam / tidak presentasi."}
        
        [Pertanyaan 1]: ${pertanyaan_1}
        [Jawaban Mahasiswa 1]: ${jawaban_1 || "Tidak ada jawaban."}
        
        [Pertanyaan 2]: ${pertanyaan_2}
        [Jawaban Mahasiswa 2]: ${jawaban_2 || "Tidak ada jawaban."}
        
        [Pertanyaan 3]: ${pertanyaan_3}
        [Jawaban Mahasiswa 3]: ${jawaban_3 || "Tidak ada jawaban."}

        Kembalikan hasil HANYA dalam format JSON persis seperti struktur ini (tanpa markdown tambahan seperti \`\`\`json):
        {
          "evaluasi_presentasi": {
            "feedback": "Tuliskan 1-2 kalimat feedback tajam khusus performa presentasi. Tegur keras jika hanya berisi buzzword tanpa logika."
          },
          "qna_summary": {
            "keunggulan": [
              "[Presentasi] Tulis detail keunggulan/analisis dari isi presentasinya di sini...", 
              "[QnA] Tulis detail keunggulan cara menjawab di sini..."
            ],
            "kelemahan": [
              "[Presentasi] Kritik tajam apa yang kurang dari penjelasan materi di presentasinya...", 
              "[QnA] Kritik tajam untuk jawaban yang salah atau menghindar..."
            ],
            "strategi": [
              "[Presentasi] Langkah perbaikan untuk struktur atau isi materi presentasi...", 
              "[QnA] Langkah perbaikan cara menjawab atau teori QnA yang harus dipelajari..."
            ]
          },
          "evaluasi_qna": [
            {
              "soal": "Tulis ulang intisari pertanyaan 1",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "1-2 kalimat feedback selayaknya dosen."
            },
            {
              "soal": "Tulis ulang intisari pertanyaan 2",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "1-2 kalimat feedback selayaknya dosen."
            },
            {
              "soal": "Tulis ulang intisari pertanyaan 3",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "1-2 kalimat feedback selayaknya dosen."
            }
          ]
        }
        Catatan Penting: 
        - JANGAN PERNAH menyertakan teks apapun di luar JSON.
        `;
        
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });
        const result = await model.generateContent(prompt);
        let jawaban_teks = result.response.text().trim();

        const jsonStart = jawaban_teks.indexOf('{');
        const jsonEnd = jawaban_teks.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1) {
            jawaban_teks = jawaban_teks.substring(jsonStart, jsonEnd + 1);
        }

        const hasil_evaluasi = JSON.parse(jawaban_teks);

        res.json({
            status: "success",
            message: "Evaluasi berhasil diselesaikan.",
            data: hasil_evaluasi
        });

        } catch (error) {
        console.error("Error Evaluasi QnA:", error);
        res.status(500).json({ detail: `Sistem AI Gagal: ${error.message}` });
    }
});

router.post('/evaluasi-skripsi', upload.single('file'), evaluasiController.evaluasiSkripsi);

// =========================================================
// 3. ENDPOINT: TRANSKRIPSI AUDIO VIA GROQ (WHISPER)
// =========================================================
router.post('/transcribe-audio', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ detail: "File audio tidak ditemukan." });

        // Mengubah buffer audio dari Multer menjadi format Blob yang diterima Fetch API Node.js
        const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
        
        const formData = new FormData();
        formData.append("file", audioBlob, "audio.webm");
        formData.append("model", "whisper-large-v3");
        formData.append("language", "id"); 
        formData.append(
            "prompt", 
            "Ini adalah rekaman ujian sidang skripsi. Tolong pertahankan kata-kata jeda seperti eee, hmmm, anu, dan biarkan kata-kata yang diucapkan secara terbata-bata atau tidak baku apa adanya."
        );
        formData.append("temperature", "0.2");

        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}` 
            },
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Groq API Error:", data);
            return res.status(response.status).json({ detail: data.error?.message || "Gagal transkrip dari Groq" });
        }

        res.json({ text: data.text });

    } catch (error) {
        console.error("Server Error (Groq):", error);
        res.status(500).json({ detail: "Terjadi kesalahan saat menghubungi Groq." });
    }
});

module.exports = router;