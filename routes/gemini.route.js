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
].filter(Boolean);

const getDynamicGenAI = () => {
    if (apiKeys.length === 0) throw new Error("Tidak ada API Key Gemini di .env!");
    const randomIndex = Math.floor(Math.random() * apiKeys.length);
    console.log(`[LOG] Memakai Gemini API Key ke-${randomIndex + 1}`);
    return new GoogleGenerativeAI(apiKeys[randomIndex]);
};

// =========================================================
// 1. ENDPOINT: GENERATE PERTANYAAN DARI PDF
// =========================================================
router.post('/generate-pertanyaan', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ detail: "File harus berupa PDF" });
        
        const pdfData = await pdfParse(req.file.buffer);
        let teks_skripsi_mentah = pdfData.text;

        if (!teks_skripsi_mentah || !teks_skripsi_mentah.trim()) {
            return res.status(400).json({ detail: "Tidak dapat membaca teks dari PDF ini." });
        }

        // 🔥 2. SMART SAMPLING 🔥
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
        
        🔥 ATURAN WAJIB:
        1. Setiap pertanyaan HARUS SINGKAT DAN PADAT (Maksimal 1-2 kalimat atau sekitar 15-25 kata).
        2. LANGSUNG ke inti pertanyaan. JANGAN berikan kalimat pengantar, basa-basi, atau ringkasan materi sebelum bertanya.
        3. Gunakan bahasa lisan yang natural selayaknya dosen yang sedang bertanya langsung secara verbal.
        
        Keluarkan HANYA output JSON Array berisi 3 string pertanyaan (tanpa markdown \`\`\`json).
        Contoh Format Wajib:
        [
          "Pertanyaan penguji pertama yang singkat dan padat...",
          "Pertanyaan penguji kedua yang langsung ke inti...",
          "Pertanyaan penguji ketiga tanpa basa-basi..."
        ]
        `;

        const genAI = getDynamicGenAI();
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" }); 
        
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
        res.status(500).json({ detail: `Gagal memproses PDF: ${error.message}` });
    }
});

// =========================================================
// 2. ENDPOINT: EVALUASI QNA 
// =========================================================
router.post('/evaluasi-qna', upload.none(), async (req, res) => {
    try {
        const { presentasi_transcript, pertanyaan_1, jawaban_1, pertanyaan_2, jawaban_2, pertanyaan_3, jawaban_3 } = req.body;

        if (!presentasi_transcript && !jawaban_1 && !jawaban_2 && !jawaban_3) {
            return res.status(400).json({ detail: "Tidak ada data presentasi atau jawaban yang dikirim." });
        }

        // 🔥 PERBAIKAN PROMPT: Feedback dinamis, Soal asli, dan Peningkatan kualitas jawaban
        const prompt = `
        Anda adalah seorang Dosen Penguji Sidang Skripsi yang ahli, berwibawa, kritis, dan "Killer". 
        Anda tidak bisa dikelabui oleh mahasiswa yang hanya pandai menggunakan jargon tanpa esensi logis.
        
        ATURAN WAJIB EVALUASI (HARUS DIIKUTI 100%):
        1. Berikan porsi evaluasi yang SEIMBANG antara Sesi "Presentasi" dan Sesi "QnA".
        2. Pada bagian "qna_summary" (keunggulan, kelemahan, strategi), JUMLAH POIN BEBAS tergantung dari kualitas asli performa mahasiswa. Anda tidak dibatasi harus 2 poin. Namun, SETIAP POIN WAJIB diawali dengan tag [Presentasi] atau [QnA] agar mahasiswa tahu konteksnya.
        3. Pada bagian "evaluasi_qna", Anda WAJIB MENULIS ULANG PERTANYAAN ASLINYA secara utuh dan persis di bagian "soal". Jangan diringkas atau diubah.
        4. Pada bagian "feedback" di "evaluasi_qna":
           - Jika jawaban mahasiswa SALAH atau MENGHINDAR: Berikan kritik tajam, lalu berikan contoh/rekomendasi cara menjawab yang benar secara teori.
           - Jika jawaban mahasiswa SUDAH BENAR: Jangan hanya memuji. Anda WAJIB memberikan arahan bagaimana menyempurnakan jawaban tersebut agar kalimatnya jauh lebih padat, terstruktur, dan akademis. Berikan contoh kalimat jawaban sempurnanya.
        
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
            "feedback": "Berikan analisis komprehensif, padat, dan akademis selayaknya dosen penguji terkait materi presentasinya."
          },
          "qna_summary": {
            "keunggulan": [
              "[Presentasi] (Tulis poin keunggulan presentasi, jumlah bebas...)", 
              "[QnA] (Tulis poin keunggulan cara menjawab, jumlah bebas...)"
            ],
            "kelemahan": [
              "[Presentasi] (Tulis poin kelemahan presentasi, jumlah bebas...)", 
              "[QnA] (Tulis poin kelemahan cara menjawab, jumlah bebas...)"
            ],
            "strategi": [
              "[Presentasi] (Tulis poin strategi presentasi, jumlah bebas...)", 
              "[QnA] (Tulis poin strategi QnA, jumlah bebas...)"
            ]
          },
          "evaluasi_qna": [
            {
              "soal": "Tulis PERSIS ulang Pertanyaan 1 di sini sesuai data yang dikirimkan",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "Kritik akademis dosen. Jika benar, berikan contoh cara menyusun kalimat jawaban agar lebih akademis dan padat. Jika salah, perbaiki teorinya."
            },
            {
              "soal": "Tulis PERSIS ulang Pertanyaan 2 di sini sesuai data yang dikirimkan",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "Kritik akademis dosen. Jika benar, berikan contoh cara menyusun kalimat jawaban agar lebih akademis dan padat. Jika salah, perbaiki teorinya."
            },
            {
              "soal": "Tulis PERSIS ulang Pertanyaan 3 di sini sesuai data yang dikirimkan",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "Kritik akademis dosen. Jika benar, berikan contoh cara menyusun kalimat jawaban agar lebih akademis dan padat. Jika salah, perbaiki teorinya."
            }
          ]
        }
        `;

        const genAI = getDynamicGenAI();
        
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" }); 
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