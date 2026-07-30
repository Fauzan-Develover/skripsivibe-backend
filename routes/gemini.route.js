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

        console.log("Meminta pertanyaan ke Gemini (Model: gemini-2.5-flash)...");
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
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
// 2. ENDPOINT: EVALUASI JAWABAN QNA
// =========================================================
router.post('/evaluasi-qna', upload.none(), async (req, res) => {
    try {
        const { pertanyaan_1, jawaban_1, pertanyaan_2, jawaban_2, pertanyaan_3, jawaban_3 } = req.body;

        if (!jawaban_1 && !jawaban_2 && !jawaban_3) {
            return res.status(400).json({ detail: "Tidak ada jawaban yang dikirim." });
        }

        const prompt = `
        Anda adalah seorang Dosen Penguji Sidang Skripsi yang ahli, berwibawa, dan suportif.
        Tugas Anda adalah memvalidasi dan memberikan feedback atas 3 jawaban mahasiswa saat sesi tanya jawab (QnA).
        Berikan feedback selayaknya dosen yang sedang menasihati mahasiswanya secara langsung secara lisan (gunakan bahasa yang natural, mengalir, tidak kaku seperti robot, namun tetap akademis).
        
        Evaluasi data presentasi/tanya jawab berikut:
        [Pertanyaan 1]: ${pertanyaan_1}
        [Jawaban Mahasiswa 1]: ${jawaban_1}
        
        [Pertanyaan 2]: ${pertanyaan_2}
        [Jawaban Mahasiswa 2]: ${jawaban_2}
        
        [Pertanyaan 3]: ${pertanyaan_3}
        [Jawaban Mahasiswa 3]: ${jawaban_3}

        Kembalikan hasil HANYA dalam format JSON persis seperti struktur ini (tanpa markdown tambahan seperti \`\`\`json):
        {
          "qna_summary": {
            "skor_rata_rata": 85,
            "keunggulan": [
              "Poin keunggulan 1 dengan bahasa luwes", 
              "Poin keunggulan 2"
            ],
            "kelemahan": [
              "Poin kelemahan 1 yang konstruktif", 
              "Poin kelemahan 2"
            ],
            "strategi": [
              "Saran perbaikan aplikatif", 
              "Saran perbaikan 2"
            ]
          },
          "evaluasi_qna": [
            {
              "soal": "Tulis ulang intisari pertanyaan 1 secara singkat",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "Berikan 1-2 kalimat feedback selayaknya dosen berbicara langsung."
            },
            {
              "soal": "Tulis ulang intisari pertanyaan 2 secara singkat",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "Berikan 1-2 kalimat feedback selayaknya dosen berbicara langsung."
            },
            {
              "soal": "Tulis ulang intisari pertanyaan 3 secara singkat",
              "status": "Benar / Kurang Tepat / Salah",
              "feedback": "Berikan 1-2 kalimat feedback selayaknya dosen berbicara langsung."
            }
          ]
        }
        Catatan Penting: 
        - Isi 'skor_rata_rata' dengan angka integer 0-100 (Berdasarkan ketepatan dan rasionalitas jawaban).
        - JANGAN PERNAH menyertakan teks apapun di luar JSON.
        `;

        console.log("Meminta evaluasi QnA ke Gemini...");
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const result = await model.generateContent(prompt);
        let jawaban_teks = result.response.text().trim();

        // PEMBERSIH JSON TAHAP DEWA (Mengabaikan teks basa-basi AI)
        const jsonStart = jawaban_teks.indexOf('{');
        const jsonEnd = jawaban_teks.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1) {
            jawaban_teks = jawaban_teks.substring(jsonStart, jsonEnd + 1);
        }

        const hasil_evaluasi = JSON.parse(jawaban_teks);
        console.log("✅ Berhasil mengevaluasi jawaban!");

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

module.exports = router;