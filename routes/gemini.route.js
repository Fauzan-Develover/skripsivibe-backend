require("dotenv").config();

const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse'); 

const { GoogleGenerativeAI } = require('@google/generative-ai');
const evaluasiController = require('../controllers/evaluasiController.js');

const upload = multer({ storage: multer.memoryStorage() });

// 🔥 1. SISTEM ROTASI 5 API KEY GEMINI DARI .ENV 🔥
const apiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5
].filter(Boolean); // Otomatis membuang key yang kosong jika Anda belum mengisi kelimanya

const getDynamicGenAI = () => {
    if (apiKeys.length === 0) throw new Error("Tidak ada API Key Gemini di .env!");
    const randomIndex = Math.floor(Math.random() * apiKeys.length);
    console.log(`[LOG] Memakai Gemini API Key ke-${randomIndex + 1}`);
    return new GoogleGenerativeAI(apiKeys[randomIndex]);
};

// =========================================================
// 1. ENDPOINT: GENERATE PERTANYAAN DARI PDF (TEXT MODE)
// =========================================================
router.post('/generate-pertanyaan', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ detail: "File harus berupa PDF" });
        
        const pdfData = await pdfParse(req.file.buffer);
        let teks_skripsi_mentah = pdfData.text;

        if (!teks_skripsi_mentah || !teks_skripsi_mentah.trim()) {
            return res.status(400).json({ detail: "Tidak dapat membaca teks dari PDF ini." });
        }

        // 🔥 2. SMART SAMPLING (Membaca Awal, Tengah, Akhir tanpa bikin server jebol) 🔥
        const totalPanjang = teks_skripsi_mentah.length;
        let teks_matang = "";

        if (totalPanjang < 30000) {
            teks_matang = teks_skripsi_mentah;
        } else {
            const awal = teks_skripsi_mentah.substring(0, 10000);
            const titikTengah = Math.floor(totalPanjang / 2);
            const tengah = teks_skripsi_mentah.substring(titikTengah - 5000, titikTengah + 5000);
            const akhir = teks_skripsi_mentah.substring(totalPanjang - 10000, totalPanjang);
            teks_matang = `${awal}\n\n... [BAGIAN TENGAH DOKUMEN DILEWATI] ...\n\n${tengah}\n\n... [BAGIAN SEBELUM KESIMPULAN DILEWATI] ...\n\n${akhir}`;
        }

        const prompt = `
        Anda adalah Dosen Penguji Sidang Skripsi. Baca potongan teks draf skripsi mahasiswa berikut ini:

        """${teks_matang}"""

        Tugas Anda: Buatkan 3 pertanyaan kritis, analitis, dan menantang untuk menguji pemahaman mahasiswa saat sidang berdasarkan teks tersebut. Jangan menanyakan hal yang terlalu dasar.
        
        Keluarkan HANYA output JSON Array berisi 3 string pertanyaan (tanpa markdown \`\`\`json).
        Contoh Format Wajib:
        [
          "Pertanyaan penguji pertama...",
          "Pertanyaan penguji kedua...",
          "Pertanyaan penguji ketiga..."
        ]
        `;

        const genAI = getDynamicGenAI();
        // Gunakan gemini-2.5-flash agar evaluasi lebih cepat selesai
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });
        
        let jawaban_teks = result.response.text().trim();

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
        // 🔥 UBAH BARIS INI: Kirim pesan error aslinya ke React 🔥
        res.status(500).json({ detail: `Gagal memproses PDF: ${error.message}` });
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
            "feedback": "FEEDBACK TIDAK DIBATASI. Berikan analisis yang komprehensif, sedetail dan semendalam mungkin sesuai dengan kualitas asli mahasiswa. Jika jawaban mahasiswa sangat hancur, berikan teguran panjang yang konstruktif. Jika sangat bagus, bedah argumennya secara akademis."
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

        const genAI = getDynamicGenAI();
        
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });
        
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