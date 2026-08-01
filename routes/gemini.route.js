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

        console.log("Membaca teks dari PDF menggunakan pdf-parse...");
        
        // 🚀 BACA PDF SECARA LANGSUNG (Tanpa pengecekan yang bikin error)
        const pdfData = await pdfParse(req.file.buffer);
        let teks_skripsi_mentah = pdfData.text;

        if (!teks_skripsi_mentah || !teks_skripsi_mentah.trim()) {
            return res.status(400).json({ detail: "Tidak dapat membaca teks dari PDF ini." });
        }

        // Potong teks agar tidak kepanjangan untuk model gemini-pro (Sekitar 4000 karakter)
        const teks_matang = teks_skripsi_mentah.substring(0, 4000);

        const prompt = `
        Anda adalah seorang Dosen Penguji Skripsi yang SANGAT KRITIS, tegas, dan "Killer".
        Anda benci basa-basi dan selalu bertanya langsung ke titik kelemahan mahasiswa.
        
        Berikut adalah RINGKASAN skripsi mahasiswa:
        ---
        ${teks_matang}
        ---
        
        Buatlah 3 pertanyaan sidang skripsi dengan ATURAN SUPER KETAT berikut:
        1. HARUS SANGAT SINGKAT, padat, tajam. Maksimal 1-2 kalimat pendek saja per pertanyaan!
        2. DILARANG KERAS menggunakan kata pengantar/basa-basi.
        3. Langsung serang intinya!
        
        Topik Pertanyaan:
        - Pertanyaan 1: Serang validitas data atau alat ukur metodologinya.
        - Pertanyaan 2: Serang alasan pemilihan teori/metodenya.
        - Pertanyaan 3: Serang nilai guna / dampak asli dari penelitiannya.
        
        Format output HARUS murni berupa array JSON (TANPA MARKDOWN \`\`\`json, TANPA TEKS LAIN):
        [
            "pertanyaan 1",
            "pertanyaan 2",
            "pertanyaan 3"
        ]
        `;

        console.log("Meminta pertanyaan ke Gemini (Model: gemini-3.5-flash-lite)...");
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
        console.log("✅ Berhasil generate pertanyaan!");

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

        // 🔥 PERBAIKAN: Prompt dibersihkan dari tugas menghitung skor logika / rata-rata
        const prompt = `
        Anda adalah seorang Dosen Penguji Sidang Skripsi yang ahli, berwibawa, kritis, dan "Killer". 
        Anda tidak bisa dikelabui oleh mahasiswa yang hanya pandai menggunakan jargon teknologi/buzzword tanpa memahami esensi logis dari penelitiannya.
        
        TUGAS ANDA:
        1. Evaluasi [Transkrip Presentasi]: Berikan feedback tajam! Cek apakah mahasiswa benar-benar menjelaskan metodologi/alur dengan logis, atau hanya menumpuk kata-kata keren (buzzword salad).
        2. Evaluasi [Jawaban QnA]: Berikan feedback deskriptif atas keakuratan jawaban terhadap pertanyaan penguji.
        
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
              "Poin keunggulan 1", 
              "Poin keunggulan 2"
            ],
            "kelemahan": [
              "Poin kelemahan 1 (Fokus pada substansi QnA dan penyampaian)", 
              "Poin kelemahan 2"
            ],
            "strategi": [
              "Saran perbaikan 1", 
              "Saran perbaikan 2"
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
        
        console.log("Meminta feedback teks evaluasi QnA ke Gemini...");
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });
        
        const result = await model.generateContent(prompt);
        let jawaban_teks = result.response.text().trim();

        const jsonStart = jawaban_teks.indexOf('{');
        const jsonEnd = jawaban_teks.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1) {
            jawaban_teks = jawaban_teks.substring(jsonStart, jsonEnd + 1);
        }

        const hasil_evaluasi = JSON.parse(jawaban_teks);
        console.log("✅ Berhasil mengevaluasi presentasi dan jawaban (Mode Teks Murni)!");

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

        console.log("Mengirim audio ke Groq API...");
        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                // 🔥 Pastikan kamu menambahkan GROQ_API_KEY di file .env backend kamu!
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}` 
            },
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Groq API Error:", data);
            return res.status(response.status).json({ detail: data.error?.message || "Gagal transkrip dari Groq" });
        }

        console.log("Berhasil men-transkrip audio via Groq!");
        res.json({ text: data.text });

    } catch (error) {
        console.error("Server Error (Groq):", error);
        res.status(500).json({ detail: "Terjadi kesalahan saat menghubungi Groq." });
    }
});

module.exports = router;